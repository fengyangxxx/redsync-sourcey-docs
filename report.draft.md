# Frantic #33 - Redsync Sourcey Community Documentation Report (QA Candidate)

## Status And Boundary

This is a claim-neutral replacement publication candidate. The current task
state is `work_status=delivered`, `capacity=1`, `occupied=1`, `available=0`,
`active=0`, and `delivered=1`. Its source snapshot was prepared earlier under
fy's task-specific pre-claim-work override. It is not a Frantic delivery payload,
and final delivery authorization is `false`.
The site is claimant-authored, project-named community documentation hosted on
Read the Docs; it is not target-owned or official. The upstream PR is open and
unmerged and is only an optional README link proposal, never adoption,
endorsement, or maintainer acceptance.

## Target And Generation

- Repository: `https://github.com/go-redsync/redsync`.
- Pinned commit: `79f6ba24a8bf41f35141de700d410a06bb27622f`.
- License: `BSD-3-Clause`, verified from the pinned [`LICENSE`](https://raw.githubusercontent.com/go-redsync/redsync/79f6ba24a8bf41f35141de700d410a06bb27622f/LICENSE).
- Sourcey: `3.6.3`, `godoc` adapter, configured in `sourcey.config.ts`.
- Exact command: `sourcey godoc --module ./source/redsync --packages ./... --out godoc.json`.
- Exact CLI observation: `runx-cli 0.7.1`, satisfying the required `>=0.6.13` floor.
- Snapshot: schema `1`, 15 packages, zero diagnostics.
- Coverage: 15 packages, 19 non-test Go files, and 110 exported symbols.
- Static output: 23 Sourcey-generated HTML pages plus one navigation
  compatibility redirect, for 24 HTML pages and 30 packaged files.
- Exact byte/source checks: five generated pages map to pinned source line,
  repository-LF SHA-256, and Git blob SHA-1 records.

The complete HTML list is recorded in `evidence/evidence.draft.json`; the raw
inventory and byte manifest are `evidence/inventory.json` and
`evidence/sha256-manifest.json`.

## Maintainer-Facing Gaps

1. **Legacy reference link.** The pinned Redsync README still links to
   `http://godoc.org/github.com/go-redsync/redsync` at
   [`README.md#L20-L22`](https://github.com/go-redsync/redsync/blob/79f6ba24a8bf41f35141de700d410a06bb27622f/README.md#L20-L22).
   The generated community site replaces that single legacy entry point with a
   navigable package map while preserving exact pinned source links.
2. **Adapter discovery is fragmented.** The public interfaces begin at
   [`redis/redis.go#L9-L26`](https://github.com/go-redsync/redsync/blob/79f6ba24a8bf41f35141de700d410a06bb27622f/redis/redis.go#L9-L26),
   while go-redis, Redigo, Rueidis, and Valkey implementations live in separate
   directories. The 15-page API list makes those variants comparable without
   browsing the source tree manually.
3. **Lock-option behavior lacks task guidance.** Expiry, retries, drift,
   timeout, fail-fast, and pool shuffling are declared across
   [`redsync.go#L67-L155`](https://github.com/go-redsync/redsync/blob/79f6ba24a8bf41f35141de700d410a06bb27622f/redsync.go#L67-L155),
   while lifecycle methods such as `Lock`, `Unlock`, `Extend`, and `Valid` are
   spread across
   [`mutex.go#L55-L196`](https://github.com/go-redsync/redsync/blob/79f6ba24a8bf41f35141de700d410a06bb27622f/mutex.go#L55-L196).
   The API reference exposes every symbol, but maintainers still need a
   task-oriented correctness and recovery guide.
4. **Refresh policy is missing.** The generated snapshot is intentionally
   pinned. A release-aware rebuild or exported-symbol drift check is still
   needed so future Redsync releases cannot silently outgrow the documentation.

These gaps and their generated-page counterparts are also published in
`maintainer-gap-analysis.md`.

## Independent Machine Proof

- Direct live validator result: `evidence/local-live-validation/evidence.json`.
- Raw HTTP/check transcript: `evidence/local-live-validation/transcript.txt`.
- Raw validator stdout/stderr: `evidence/local-live-validation/runner-stdout.json`
  and `runner-stderr.txt`.
- Machine-proof hashes: `evidence/local-live-validation/manifest.json`.
- Receipt archive contract: each original receipt path, byte length, SHA-256,
  and exact base64 bytes is stored in `runx-receipts.archive.json`; extraction
  must reproduce the complete tree before workflow success.
- Receipt status contract: raw `runx.skill_run.v1` status must be exactly
  `sealed`; every parseable stored receipt JSON is audited for failed states,
  false success flags, and nonzero exit codes before archive packaging.
- Summary/raw consistency: a PASS is impossible when any raw check is BLOCKED,
  any subprocess exit is nonzero, receipt reconstruction fails, or receipt
  verification fails.

All prior failed workflow runs and their receipts are excluded. Only the next
successful governed Linux CI run may supply final receipt evidence.

## Public Host And Provenance

- Public home: `https://redsync-sourcey-docs.readthedocs.io/en/latest/`.
- Public source: `https://github.com/fengyangxxx/redsync-sourcey-docs`.
- Current deployment: Read the Docs build `33625834` at commit
  `2b58caa8d60147df494ce995f3777944a400b9a9`; this is the replacement
  candidate's exact public parent, not proof that the new candidate is deployed.
- Required publication proof: a fresh replacement source commit, a successful
  Read the Docs build tied to that exact commit, and anonymous page/hash
  readback.
- PR `https://github.com/go-redsync/redsync/pull/245` is open and unmerged at
  head `f13cd302b903ae84fc21d914bbeb631a21bb9521`; it is optional proposal evidence
  only.

## External-Only Remaining Steps

The exact outbound publication plan is repository
`https://github.com/fengyangxxx/redsync-sourcey-docs`, destination ref
`refs/heads/fix/frantic33-governed-receipt-v3`, expected pre-push state branch
absent, workflow `.github/workflows/validate-sourcey-adoption.yml`, and dispatch
ref `fix/frantic33-governed-receipt-v3`.

1. Obtain Dirac outbound-publication QA for this exact replacement commit,
   fresh-check that the destination branch is absent, then push only the
   reviewed commit.
2. Confirm a fresh Read the Docs build deploys that exact commit.
3. Dispatch the governed workflow exactly once with the immutable values listed
   below; require a successful run, one archive artifact, exact reconstruction,
   root receipt verification, and clean raw output.
4. Materialize the successful workflow outputs into immutable evidence URLs,
   replace the null external fields in `evidence/evidence.draft.json`, and run
   complete Dirac line-by-line final QA.
5. Keep final delivery authorization `false`. A guarded Frantic delivery is
   possible only if the platform later exposes a valid claim or delivery path,
   fresh fields are recorded, and separate final QA passes on the exact bytes.

No push, workflow dispatch, Read the Docs publication, PR mutation, or Frantic
delivery has been performed by this local implementation step.
