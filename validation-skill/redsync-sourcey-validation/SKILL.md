---
name: redsync-sourcey-validation
description: Run governed machine validation for a published go-redsync/redsync Sourcey documentation adoption package, including immutable docs, five page/source mappings, and the upstream pull request.
---

# Redsync Sourcey validation

Run the deterministic network runner with all eight required immutable inputs.
Use `live` mode for delivery evidence. Use `fixture` only for local parser and
HTTP logic tests; fixture mode always records `live_pass=false` and can never
emit a live `PASS`.

The runner checks the exact governed CLI version, the published Sourcey home
and API pages, the immutable Sourcey config/godoc/dist/mappings files, five
pinned source files, and the open upstream PR fields. Final evidence/report
files are intentionally not inputs because they are created after this run and
its receipt. The runner writes `evidence.json` and
`transcript.txt` under `output_dir`. Every check is `PASS` or `BLOCKED`.
Failures exit nonzero and remain visible in both artifacts and stdout.
