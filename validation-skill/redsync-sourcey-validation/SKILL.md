---
name: redsync-sourcey-validation
description: Validate a claimant-authored go-redsync/redsync Sourcey community documentation publication, immutable source coverage, and an optional unmerged upstream link proposal.
---

# Redsync Sourcey validation

Run the deterministic network runner with all nine required immutable inputs.
Use `live` mode for delivery evidence. Use `fixture` only for local parser and
HTTP logic tests; fixture mode always records `live_pass=false` and can never
emit a live `PASS`.

The runner checks the literal outer `runx --version` output, the published Sourcey home
and API pages, the immutable Sourcey config/godoc/dist/mappings files, five
pinned source files, and the open upstream PR fields. The PR is checked only as
an optional proposal and is never treated as adoption, endorsement, or maintainer
acceptance. Each mapped public API
page must canonicalize to its byte-exact immutable raw page by removing exactly
one recognized Read the Docs addon immediately before `</head>`; all removed
fragment identity and hash fields are recorded. Placeholder checks cover only
runtime inputs and explicit public/immutable non-draft artifacts, never commit
API patch metadata. Final evidence/report files are intentionally not inputs
because they are created after this run and its receipt. The runner writes `evidence.json` and
`transcript.txt` under `output_dir`. Every check is `PASS` or `BLOCKED`.
Idempotent GETs use at most four attempts; only network errors, HTTP 429, and
HTTP 5xx are retried with bounded deterministic backoff. Every attempt is
recorded. Failures exit nonzero; exhausted retries are failures and remain
visible in both artifacts and stdout.
