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
because they are created after this run and its receipt. Local fixture runs can
write `evidence.json` and `transcript.txt` under `output_dir`. Governed network
runs use `artifact_mode=stdout-only`; after the receipt tree and signature pass,
the workflow extracts the byte-bound artifacts from runx's captured stdout.
Every check is `PASS` or `BLOCKED`.
Idempotent GETs use at most four attempts; only network errors, HTTP 429, and
HTTP 5xx are retried with bounded deterministic backoff. Every attempt is
recorded. Failures exit nonzero; exhausted retries are failures and remain
visible in both artifacts and stdout.

The cli-tool declares `profile=network`, `network=true`, and
`require_enforcement=true`. On Linux, runx must resolve Bubblewrap and records
that runtime enforcer in the signed receipt; declared-policy-only or direct
execution is not allowed. The ephemeral Ubuntu runner records the AppArmor
user-namespace setting before and after any one-boot change, installs and
versions Bubblewrap, and passes a minimal user-namespace probe before runx.
The workflow copies its pinned setup-node runtime to the audited
`/usr/local/bin/runx-node` path mounted by Bubblewrap and probes that exact
executable inside the namespace.
The operator-context digest approval remains separate from sandbox escalation;
this skill neither declares nor self-approves an unrestricted escalation.
