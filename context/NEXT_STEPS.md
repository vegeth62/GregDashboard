# Next Steps

## Recommended First Engineering Task

Unify all market and volume file paths so that:

- pollers write to one canonical location
- API routes read from that same location
- local dev and production behavior are predictable

## After That

1. Clean up text encoding issues in docs and UI.
2. Replace or harden the `python3` spawn path on Windows for finance input.
3. Decide whether derived metrics should also be persisted to Supabase.
4. Refresh the top-level project documentation from current code.

## Questions Already Answered By Code

- Main app framework: Next.js App Router
- Market source: IBKR TWS via local Python poller
- Volume source: IBKR TWS via separate local Python poller
- Cloud store: optional Supabase, not complete source of truth
- Finance persistence: local CSV
