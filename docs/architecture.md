# nmdealclaw architecture

## Thesis

`nmdealclaw` is a task-first AI workspace with pluggable runtimes and optional visible multi-agent control.

## Layers

1. `apps/*` presents the user experience.
2. `packages/core` owns task, run, artifact, transcript, and recovery orchestration.
3. `packages/protocol` defines stable internal contracts.
4. `packages/adapter-*` translate backend-specific transports into internal events.

## Durability rule

`nmdealclaw` owns long-horizon durability.

Implemented locally:
- task metadata persistence
- transcript persistence
- artifact persistence
- weighted recovery synthesis from preserved local state

So if the old NullClaw remote task no longer exists, the workspace still survives and can start a new remote turn from a compact, scored recovery summary rather than a raw transcript dump.
