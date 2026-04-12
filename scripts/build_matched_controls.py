#!/usr/bin/env python3
"""build_matched_controls.py - Matched controls + uplift (Python)"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from incremental_event_engine import step5_controls, PG_CONFIG
import psycopg2, argparse

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    conn = psycopg2.connect(**PG_CONFIG)
    step5_controls(conn, args.dry_run)
    conn.close()
    print("Done.")

if __name__ == "__main__":
    main()
