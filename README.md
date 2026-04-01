# nmdealclaw

Task-first AI workspace scaffold with pluggable runtimes and visible multi-agent control.

## What is included

- `packages/protocol` — neutral internal contracts for tasks, runs, artifacts, events, and runtime adapters
- `packages/core` — workspace store, event bus, task service, on-disk persistence, and weighted recovery synthesis
- `packages/adapter-nullclaw` — first real backend path using NullClaw pairing + exact A2A streaming mapping
- `packages/adapter-openclaw` — starter OpenClaw adapter
- `packages/adapter-hiclaw` — starter HiClaw adapter
- `apps/web` — minimal browser-side starter
- `apps/desktop` — minimal desktop/CLI-side starter
- `docs` — architecture, protocol, and fork-boundary documents

## Recovery synthesis

Recovery is no longer just a raw transcript replay or a flat event grouping pass.

`packages/core` now uses a weighted recovery synthesizer that:
- extracts semantically useful lines from transcript events
- classifies them into stable facts, decisions, outputs, and open issues
- scores them with signal bonuses
- de-duplicates normalized lines
- keeps only the strongest bounded set per bucket
- keeps a short recent tail separately

This is still not an LLM summarizer, but it is materially stronger than the earlier event-only compactor.
