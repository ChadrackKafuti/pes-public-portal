"""`python -m cb_governance` — one ingest run (settings via GOV_* env vars)."""

from .runner import run

if __name__ == "__main__":
    run()
