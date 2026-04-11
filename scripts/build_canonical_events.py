#!/usr/bin/env python3
"""Python-first canonical event builder."""

from __future__ import annotations

import argparse
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable

try:
    import numpy as np
except ImportError:
    print("numpy is required. Install dependencies from scripts/requirements-compute.txt")
    sys.exit(1)

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor, execute_values
except ImportError:
    print("psycopg2-binary is required. Install dependencies from scripts/requirements-compute.txt")
    sys.exit(1)

try:
    from sklearn.cluster import AgglomerativeClustering
except ImportError:
    print("scikit-learn is required. Install dependencies from scripts/requirements-compute.txt")
    sys.exit(1)

from _python_runtime import load_optional_env_file, resolve_nas_pg_config


DEFAULT_SIMILARITY_THRESHOLD = 0.7
DEFAULT_MAX_GROUP_FOR_FULL_COMPARISON = 80
DEFAULT_FLUSH_SIZE = 500


@dataclass
class CanonicalEventRow:
    event_date: str
    theme: str
    title: str
    source_count: int
    source_diversity: float
    article_count: int
    avg_embedding: str | None
    article_ids: list[int]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build canonical events with Python compute.")
    parser.add_argument("--threshold", type=float, default=DEFAULT_SIMILARITY_THRESHOLD)
    parser.add_argument("--max-group-size", type=int, default=DEFAULT_MAX_GROUP_FOR_FULL_COMPARISON)
    parser.add_argument("--flush-size", type=int, default=DEFAULT_FLUSH_SIZE)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def parse_vector(value: str | list[float] | None) -> np.ndarray | None:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip().removeprefix("[").removesuffix("]")
        if not stripped:
            return None
        return np.fromstring(stripped, sep=",", dtype=np.float32)
    if isinstance(value, list):
        return np.asarray(value, dtype=np.float32)
    return None


def l2_normalize(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms = np.where(norms > 1e-10, norms, 1e-10)
    return matrix / norms


def cluster_embeddings(embeddings: list[np.ndarray], similarity_threshold: float) -> list[list[int]]:
    matrix = np.asarray(embeddings, dtype=np.float32)
    if matrix.shape[0] <= 1:
        return [[0]]

    normalized = l2_normalize(matrix)
    distance_threshold = max(0.0, 1.0 - similarity_threshold)
    model = AgglomerativeClustering(
        n_clusters=None,
        metric="cosine",
        linkage="average",
        distance_threshold=distance_threshold,
    )
    labels = model.fit_predict(normalized)
    groups: dict[int, list[int]] = defaultdict(list)
    for index, label in enumerate(labels.tolist()):
        groups[int(label)].append(index)
    return list(groups.values())


def average_embedding(embeddings: Iterable[np.ndarray]) -> str | None:
    emb_list = [embedding for embedding in embeddings if embedding is not None]
    if not emb_list:
        return None
    avg = np.mean(np.vstack(emb_list), axis=0, dtype=np.float64)
    return "[" + ",".join(str(float(value)) for value in avg.tolist()) + "]"


def flush_batch(conn, batch_rows: list[CanonicalEventRow]) -> tuple[int, int]:
    if not batch_rows:
        return 0, 0

    total_events = 0
    total_articles = 0
    with conn:
        with conn.cursor() as cur:
            for row in batch_rows:
                cur.execute(
                    """
                    INSERT INTO canonical_events (
                      event_date, theme, representative_title, source_count,
                      source_diversity, article_count, avg_embedding
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        row.event_date,
                        row.theme,
                        row.title,
                        row.source_count,
                        row.source_diversity,
                        row.article_count,
                        row.avg_embedding,
                    ),
                )
                event_id = cur.fetchone()[0]
                execute_values(
                    cur,
                    """
                    INSERT INTO article_event_map (article_id, canonical_event_id)
                    VALUES %s
                    ON CONFLICT DO NOTHING
                    """,
                    [(article_id, event_id) for article_id in row.article_ids],
                )
                total_events += 1
                total_articles += len(row.article_ids)

    return total_events, total_articles


def main() -> None:
    args = parse_args()
    load_optional_env_file()
    conn = psycopg2.connect(**resolve_nas_pg_config())

    print(f"build_canonical_events.py -> threshold={args.threshold}")
    started_at = time.perf_counter()

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        if args.dry_run:
            print("Dry run enabled; database writes are skipped.")
        else:
            cur.execute("DELETE FROM article_event_map")
            cur.execute("DELETE FROM canonical_events")
            conn.commit()
            print("Cleared existing data")

        cur.execute(
            """
            SELECT DATE(published_at) AS event_date, theme, COUNT(*) AS cnt,
                   array_agg(id ORDER BY id) AS article_ids
            FROM articles
            WHERE theme IS NOT NULL AND theme != 'unknown'
            GROUP BY DATE(published_at), theme
            ORDER BY cnt ASC
            """
        )
        groups = cur.fetchall()

    print(f"Processing {len(groups)} groups...")

    batch_rows: list[CanonicalEventRow] = []
    total_events = 0
    total_articles = 0

    for group_index, group in enumerate(groups, start=1):
        article_ids = group["article_ids"] or []
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if len(article_ids) == 1:
                cur.execute(
                    "SELECT id, title, source FROM articles WHERE id = %s",
                    (article_ids[0],),
                )
                article = cur.fetchone()
                if article:
                    batch_rows.append(
                        CanonicalEventRow(
                            event_date=str(group["event_date"]),
                            theme=group["theme"],
                            title=article["title"],
                            source_count=1,
                            source_diversity=1.0,
                            article_count=1,
                            avg_embedding=None,
                            article_ids=[article["id"]],
                        )
                    )
            else:
                cur.execute(
                    """
                    SELECT id, title, source, embedding::text AS embedding
                    FROM articles
                    WHERE id = ANY(%s)
                    ORDER BY id
                    """,
                    (article_ids,),
                )
                rows = cur.fetchall()

                embeddings = [parse_vector(row["embedding"]) for row in rows]
                has_all_embeddings = all(embedding is not None and embedding.shape[0] == 768 for embedding in embeddings)

                if not has_all_embeddings or len(rows) > args.max_group_size:
                    clusters = [list(range(len(rows)))]
                else:
                    clusters = cluster_embeddings(embeddings, args.threshold)

                for cluster_indices in clusters:
                    cluster_rows = [rows[index] for index in cluster_indices]
                    sources = {row["source"] for row in cluster_rows if row.get("source")}
                    longest_title = max(cluster_rows, key=lambda row: len(row.get("title") or ""))["title"]
                    batch_rows.append(
                        CanonicalEventRow(
                            event_date=str(group["event_date"]),
                            theme=group["theme"],
                            title=longest_title,
                            source_count=len(sources),
                            source_diversity=round(len(sources) / max(1, len(cluster_rows)), 3),
                            article_count=len(cluster_rows),
                            avg_embedding=average_embedding(embeddings[index] for index in cluster_indices),
                            article_ids=[row["id"] for row in cluster_rows],
                        )
                    )

        if len(batch_rows) >= args.flush_size:
            if args.dry_run:
                total_events += len(batch_rows)
                total_articles += sum(len(row.article_ids) for row in batch_rows)
                batch_rows = []
            else:
                added_events, added_articles = flush_batch(conn, batch_rows)
                total_events += added_events
                total_articles += added_articles
                batch_rows = []

        if group_index % 500 == 0:
            elapsed = max(time.perf_counter() - started_at, 0.1)
            rate = group_index / elapsed
            remaining_seconds = int((len(groups) - group_index) / max(rate, 1e-6))
            print(
                f"  {group_index}/{len(groups)} groups ({total_events} events) -> "
                f"{elapsed:.1f}s elapsed, ~{remaining_seconds}s remaining"
            )

    if batch_rows:
        if args.dry_run:
            total_events += len(batch_rows)
            total_articles += sum(len(row.article_ids) for row in batch_rows)
        else:
            added_events, added_articles = flush_batch(conn, batch_rows)
            total_events += added_events
            total_articles += added_articles

    if not args.dry_run:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE labeled_outcomes lo
                    SET canonical_event_id = aem.canonical_event_id
                    FROM article_event_map aem
                    WHERE lo.article_id = aem.article_id
                      AND lo.canonical_event_id IS NULL
                    """
                )
                linked_rows = int(cur.rowcount or 0)
        print(f"\nLinked {linked_rows} labeled_outcomes rows")

    elapsed = time.perf_counter() - started_at
    compression = total_articles / max(total_events, 1)
    print(f"\nDone in {elapsed:.1f}s")
    print(f"{total_articles} articles -> {total_events} events ({compression:.1f}x compression)")

    conn.close()


if __name__ == "__main__":
    main()
