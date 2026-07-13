# Hume implementation handoff: Frantic #113

## Scope and state

- Work directory: `F:\work\ai_work\get_money\work\frantic113-redsync`
- Claim: `817adb29-a5d5-493d-8a1d-9f7cb6911b86`
- Pinned target: `go-redsync/redsync@79f6ba24a8bf41f35141de700d410a06bb27622f`
- Local hard deadline: `2026-07-14 06:27:57.468 +08`
- Hume performed local implementation, tests, and evidence preparation only.
- Hume did not scan, claim, open or submit a PR, publish docs, or call a Frantic delivery API.

## Deliverable files

- Reproducible configuration: `package.json`, `package-lock.json`, `sourcey.config.ts`, `.readthedocs.yaml`
- Pinned inputs: `source/redsync/`, `source/redsync/.source-pin.json`, `godoc.json`
- Generated site: `dist/`
- Maintainer docs: `maintainer-gap-analysis.md`, `upstream-pr-rationale.md`, `upstream/README-sourcey-docs.patch`
- Evidence: `evidence/inventory.json`, `evidence/page-source-mappings.json`, `evidence/evidence.draft.json`, `evidence/commands.local.txt`, `evidence/sha256-manifest.json`
- Draft report: `report.draft.md`
- Implementation and checks: `scripts/`, `tests/package.test.mjs`, `tests/validation-skill.test.mjs`
- Governed validator: `validation-skill/redsync-sourcey-validation/X.yaml`, `validation-skill/redsync-sourcey-validation/SKILL.md`, `validation-skill/redsync-sourcey-validation/scripts/run.mjs`
- Manual Linux receipt path: `.github/workflows/validate-sourcey-adoption.yml` (authored and tested statically; not dispatched)
- Root receipt resolver: `validation-skill/redsync-sourcey-validation/scripts/extract-root-receipt.mjs`

## Commands and results

| Check | Result |
| --- | --- |
| `npx -y @runxhq/cli@0.6.14 --version` | exit 0; `runx-cli 0.6.14` |
| `npm run snapshot` | exit 0; real `sourcey godoc` adapter; schema 1; module correct; 15 packages; 0 diagnostics |
| `npm run build` | exit 0; 21 Sourcey pages; 28 Sourcey files plus one navigation redirect; 29 packaged files |
| Source copy identity | 41 tracked files; SHA-256 mismatches 0; no extras except `.source-pin.json` |
| Static internal-link check | 23 HTML files; unresolved local `href/src` targets 0 |
| `npm run inventory` | exit 0; 15 packages; 19 non-test Go files; 110 exported symbols |
| `npm run mappings` | exit 0; exactly five generated-page to pinned-source mappings |
| `go test -c -mod=readonly .` | exit 0 |
| `go test -mod=readonly ./redis/...` | exit 0 |
| `go test -mod=readonly ./...` | exit 1; environment blocker described below |
| `quick_validate.py validation-skill/redsync-sourcey-validation` | exit 0; `Skill is valid!` |
| `npx -y @runxhq/cli@0.6.14 skill inspect validation-skill/redsync-sourcey-validation -j` | exit 0; skill status `ok`; version `0.1.0`; default runner present |
| `node --test --test-concurrency=1 tests/validation-skill.test.mjs` | exit 0; 7 passed; circular-dependency removal, manual workflow, fixture isolation, exact root selection, duplicate/missing root, and malformed raw JSON verified |
| Pinned runx governed Windows fixture | runner produced `FIXTURE_PASS` with 13/13 checks and 27 HTTP checks; outer runx exit 1 because receipt persistence failed with `os error 87` |
| `npm test` | exit 0; 20 passed; 0 failed; 0 skipped; final hash coverage recorded in `sha256-manifest.json` |

## Known blocker

The full upstream Go test starts the root package `TestMain`, which executes `redis-server`. The executable is not installed on `PATH`, so the command stops with `panic: exec: "redis-server": executable file not found in %PATH%`. The root package compiles and the Redis contract/adapter package checks pass. The draft evidence records the full run as `BLOCKED_ENVIRONMENT`, never as a pass.

Pinned `runx-cli 0.6.14` also has a Windows receipt-store blocker in this
environment. The governed fixture runner completed and wrote
`artifacts/evidence.json` plus `artifacts/transcript.txt`, but runx then exited
1 with `receipt store is unreadable: 参数错误。 (os error 87)`. The preserved
fixture artifacts are under
`C:\Users\ADMINI~1\AppData\Local\Temp\frantic113-governed-fixture-20260714021639`:
`evidence.json` is 37,816 bytes with SHA-256
`030064705b2193193c74df2e1326ebf77629894ed611019b0e849b473aa2ef47`, and
`transcript.txt` is 24,029 bytes with SHA-256
`0fa94fa25f9c02dd3a5066314621e95431565d9279aa8aeb43efb3cf6b45a06d`.
These are fixture-only (`live_pass=false`) and are not final receipt evidence.
The manual Ubuntu workflow is the prepared path for a fresh live receipt after
publication; Hume did not publish or dispatch it.

## Main-agent live receipt sequence

1. Dispatch the manual workflow only after all eight live inputs are immutable.
2. The workflow validates only `sourcey.config.ts`, `godoc.json`,
   `dist/index.html`, immutable `page-source-mappings.json`, the live site,
   pinned source, and upstream PR. It does not require final evidence/report.
3. `extract-root-receipt.mjs` parses top-level `receipt_id`, requires the
   embedded `receipt.id` to match, locates exactly one semantically identical
   stored root receipt, and records every receipt-store file with SHA-256 plus
   a deterministic tree hash.
4. The workflow verifies the copied exact root receipt with pinned runx and
   uploads root id/ref/JSON, receipt tree, and verify stdout/stderr/exit.
5. The main agent downloads the root receipt, performs hosted notary publication
   separately with existing runx login, and only then creates final evidence
   and report in a later commit referencing the validated docs commit.

The workflow has no token/secret input and performs no hosted notary publish.

## Main-agent completion fields

These remain deliberately unresolved only in the clearly named draft evidence
and report files:

- Read the Docs project/import state and final `public_url`
- Open upstream PR URL, state, and immutable head commit
- Immutable URLs for evidence, report, inventory, mappings, and command transcript
- Governed receipt reference and immutable receipt URL
- Final public-host verification, PR staging QA, Nietzsche final QA, and guarded delivery

Any replacement of a placeholder or generated artifact changes the reviewed bytes. Regenerate the SHA-256 manifest and rerun final QA after all public and PR fields are fixed.

## Workflow-dispatch repair

- The repair tree is based directly on parentless publication root
  `6fdcaf606f05115fd1ad07dde43c7d5b0186766b`; it does not include the older
  local `de79dce0e6846010070dec9781c8a8cfddd4800e` history.
- Mapping generation hashes `dist` as raw bytes and canonicalizes mapped Go
  source to strict repository LF bytes. Tests bind all five source hashes to
  the pinned GitHub raw values and all five page hashes to tracked `dist`.
- Live page proof now fetches both immutable raw docs and public RTD pages. It
  removes exactly one fully identified RTD addon immediately before
  `</head>`, records its count/bytes/hash/identity, and requires the remaining
  public bytes to equal the immutable raw page. Missing, duplicate, or
  tampered injection fixtures are blocked.
- Placeholder validation scans runtime inputs and explicit public/immutable
  non-draft artifacts. GitHub commit metadata and patch bodies are excluded;
  a fixture includes an allowed draft patch while separate public, immutable,
  and input fixtures prove fail-closed behavior.
- The workflow remains manual-only, live-only, secret-free, pinned to runx
  0.6.14 and pinned actions, fail-closed on exact root extraction/verification,
  and always uploads raw artifacts.
- A separate read-only check against the currently served five RTD pages and
  the local byte-exact `6fdcaf` files passed 5/5: HTTP 200, one recognized
  addon per page, and canonical bytes equal immutable bytes. Addon sizes were
  354-365 bytes. This check did not invoke runx or create a receipt.
- A direct full live runner probe remained honestly BLOCKED when GitHub Raw
  requests failed intermittently before the old public mappings loaded. That
  diagnostic created no governed receipt and is not final evidence.

## Publication QA placeholder repair

- Public `hosting-decision.md` and `upstream-pr-rationale.md` now describe the
  actual phase order without claiming an unpublished URL, PR, receipt, or
  evidence artifact.
- README command values are clearly labeled angle-bracket metavariables rather
  than unresolved final values.
- Validator and test fixtures construct the unresolved-token sentinel at
  runtime, preserving fail-closed behavior without leaking a static final-value
  token into normal package content.
- Sourcey 3.6.3 rebuilt 21 pages and 29 packaged files. The derived HTML,
  search index, and LLM text outputs were refreshed from the repaired sources.
- The package test performs a fresh isolated rebuild and requires all 29
  committed `dist` files to match the rebuilt bytes exactly.
- A tracked-file scan allows unresolved final-value tokens only in
  `evidence/evidence.draft.json` and `report.draft.md`; a package test enforces
  that rule.
