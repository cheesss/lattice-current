#!/usr/bin/env python3
"""Shared runtime helpers for Python batch scripts."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable


def load_optional_env_file(file_path: str = ".env.local") -> None:
    path = Path(file_path)
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


def first_defined_env(keys: Iterable[str]) -> str:
    for key in keys:
        value = str(os.getenv(key, "")).strip()
        if value:
            return value
    return ""


def resolve_nas_pg_config(overrides: dict | None = None) -> dict:
    overrides = overrides or {}
    host = str(
        overrides.get("host")
        or first_defined_env(["INTEL_PG_HOST", "NAS_PG_HOST", "PG_HOST"])
        or "192.168.0.76"
    ).strip()
    port = int(
        overrides.get("port")
        or first_defined_env(["INTEL_PG_PORT", "NAS_PG_PORT", "PG_PORT"])
        or 5433
    )
    dbname = str(
        overrides.get("dbname")
        or first_defined_env(["INTEL_PG_DATABASE", "NAS_PG_DATABASE", "PG_DATABASE", "PGDATABASE"])
        or "lattice"
    ).strip()
    user = str(
        overrides.get("user")
        or first_defined_env(["INTEL_PG_USER", "NAS_PG_USER", "PG_USER", "PGUSER"])
        or "postgres"
    ).strip()
    password = str(
        overrides.get("password")
        or first_defined_env(["INTEL_PG_PASSWORD", "NAS_PG_PASSWORD", "PG_PASSWORD", "PGPASSWORD"])
    ).strip()

    if not password:
        raise RuntimeError(
            "Missing PostgreSQL password. Set INTEL_PG_PASSWORD, NAS_PG_PASSWORD, PG_PASSWORD, or PGPASSWORD."
        )

    return {
        "host": host,
        "port": port,
        "dbname": dbname,
        "user": user,
        "password": password,
    }
