# Redsync Sourcey Docs

This package builds Sourcey API documentation for
[`go-redsync/redsync`](https://github.com/go-redsync/redsync) from pinned commit
`79f6ba24a8bf41f35141de700d410a06bb27622f`.

The source snapshot was copied from that commit after the Frantic #113 claim.
Sourcey generates `godoc.json` from the real Go module and then renders the
committed snapshot into a static site. Snapshot mode lets Read the Docs rebuild
the site with Node alone while preserving the exact Go API bytes audited
locally. The snapshot wrapper sets `GOFLAGS=-buildvcs=false` because the copied
source intentionally excludes `.git`; the exact source commit is recorded in
`.source-pin.json` and every generated source URL.

Sourcey emits the wall-clock build time in `godoc.json.generated_at`. The
snapshot wrapper deterministically normalizes that field to the immutable
source commit's real committer timestamp recorded in `.source-pin.json`,
converted to UTC (`2026-07-02T06:37:50Z`). This is a source-provenance time
basis, not a claim about when a rebuild ran; command transcripts record actual
execution times separately.

## Reproduce

```powershell
npm ci
npm run verify:runx-version
npm run snapshot
npm run inventory
npm run build
npm run mappings
npm run hashes
npm test
```

`verify:runx-version` is pinned to `@runxhq/cli@0.6.14`. The older PATH
installation must not be used for governed evidence.

## Package Shape

- `source/redsync/`: pinned source snapshot plus `.source-pin.json`.
- `sourcey.config.ts`: Sourcey 3.6.3 `godoc()` configuration.
- `godoc.json`: generated Sourcey Go API snapshot.
- `dist/`: navigable static site.
- `pinned-source-coverage.md`: public inventory and immutable byte-proof scope
  for the post-claim publication candidate.
- `evidence/inventory.json`: package, file, and exported-symbol inventory.
- `evidence/page-source-mappings.json`: five exact immutable-page and pinned
  repository-LF source checks.
- `evidence/evidence.draft.json`: local evidence draft with external fields
  explicitly left as placeholders.
- `report.draft.md`: local delivery report draft.
- `upstream/`: maintainer-facing README patch and PR rationale inputs.
- `validation-skill/redsync-sourcey-validation/`: governed live validator with
  an executable runx runner, machine evidence JSON, and raw transcript output.
- `.github/workflows/validate-sourcey-adoption.yml`: manual-only Linux runner
  for the final live inputs and an ephemeral, verified runx receipt.

The committed `source/redsync` snapshot blobs retain their original CRLF
representation. Mapping generation does not hash those checkout bytes
directly: it computes canonical repository-LF bytes, rejects bare CR, and
requires both the fixed upstream GitHub raw SHA-256 and pinned Git blob SHA-1.
The root `.gitattributes` is a policy for future text normalization; it is not
evidence that the existing snapshot blobs or every checkout are LF.

This directory contains no publication receipt and makes no claim that the
current commit is deployed. The Read the Docs project and upstream PR #245
exist, but the PR is open and unmerged; it is an optional link proposal, not
proof of upstream adoption.

## Governed adoption validation

After publication and upstream PR creation, run the validator with immutable
values replacing the angle-bracket metavariables in this non-executable
example:

```powershell
npx -y @runxhq/cli@0.6.14 skill .\validation-skill\redsync-sourcey-validation default `
  -i 'public_url=<verified-public-url>' `
  -i 'docs_repo_url=<docs-repository-url>' `
  -i 'docs_commit=<docs-commit>' `
  -i target_repo_url=https://github.com/go-redsync/redsync `
  -i target_commit=79f6ba24a8bf41f35141de700d410a06bb27622f `
  -i 'upstream_pr_url=<open-upstream-pr-url>' `
  -i 'upstream_pr_head_commit=<upstream-pr-head-commit>' `
  -i 'mappings_url=<immutable-mappings-url>' `
  -i validation_mode=live `
  -i 'output_dir=<local-output-directory>' -j
```

The runner checks the public documentation, immutable documentation commit,
five API page/source mappings, pinned target source, and upstream PR fields.
For every mapped page it first hashes the immutable raw `dist` file, then
requires the public Read the Docs response to reduce to those exact bytes after
removing one recognized addon fragment immediately before `</head>`. The
fragment's project, version, resolver path, status, byte count, and hash are
recorded; missing, duplicate, unknown, or additional drift is blocked. A
blocked check exits nonzero; `evidence.json` and `transcript.txt` retain every
raw failure. It does not fetch a final evidence/report or require a receipt
reference inside the validated docs commit: those artifacts can only be made
after this validation creates its receipt. Placeholder scanning covers runtime
inputs and explicit public or immutable non-draft docs, site, mapping, source,
and PR-body surfaces. GitHub commit API metadata and patch bodies are not
delivery surfaces and are excluded, so allowed draft patches cannot mask or
create a final-artifact result. Idempotent public GETs use at most four
auditable attempts: only network errors, HTTP 429, and HTTP 5xx are retried
with deterministic backoff; other HTTP 4xx responses fail immediately. Every
attempt remains in evidence and transcript output, and exhaustion is BLOCKED.
Fixture mode is test-only and always reports `live_pass: false`.

The GitHub Actions workflow is intentionally limited to manual
`workflow_dispatch`. It uses no repository secrets, creates a fresh signing
seed without printing or uploading it, labels the receipt issuer as `ci`, runs
the same skill in live mode, extracts the exact root `receipt_id` from runx raw
JSON, requires one matching stored root receipt, verifies that receipt, and
uploads its id/ref, exact JSON, and the complete receipt-store file/hash tree
with raw verify outputs. Any parse, uniqueness, missing-file, validation, or
verify failure exits nonzero. It has not been dispatched by Hume and is not
evidence of hosted authority.

After the workflow artifact is downloaded, the main agent performs hosted
notary publication separately with pinned runx 0.6.14 and its existing login.
The workflow never receives a token or login secret. Final evidence and report
are then created in a later commit and explicitly reference the already
validated docs commit, root receipt, verification output, and notary result.

Sourcey 3.6.3 emits the Go API landing page as `go-api.html` while its tab link
targets `go-api/index.html`. The build wrapper adds a minimal redirect at that
target so desktop and mobile tab navigation do not lead to a missing file.
