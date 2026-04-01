# nmdealclaw protocol

## Durability rule

The runtime is not the source of truth for long-term workspace state.
`packages/core` persists:

- `task.json`
- `transcript.ndjson`
- text artifacts in `artifacts/`

## Recovery rule

If remote reconciliation fails completely, `packages/core` builds a bounded recovery prompt from the local transcript and starts a fresh remote run instead of pretending the old remote task still exists.

The recovery synthesizer now:
- extracts candidate lines from transcript content
- classifies them into semantic buckets
- scores and de-duplicates them
- keeps only bounded top results
- preserves a short recent tail
