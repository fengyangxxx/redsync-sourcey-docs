# Hume implementation handoff: Frantic #33 fallback candidate

## Scope and state

- Active claim: `f0ca226c-f865-4365-aa65-a57b9a027abb`
- Claimed at: `2026-07-15T00:09:22.169Z`
- Delivery deadline: `2026-07-15T05:09:22.169Z`
- Candidate base: `3cc959e4dfaca912130c8d14ba45b73bfe222267`
- Local branch: `docs/sourcey-snapshot-coverage`
- Pinned target: `go-redsync/redsync@79f6ba24a8bf41f35141de700d410a06bb27622f`
- Intended public surface: `https://redsync-sourcey-docs.readthedocs.io/en/latest/`

Hume prepared and tested this candidate locally. Hume did not push, trigger a
Read the Docs build, dispatch a workflow, create a receipt, edit the upstream
pull request, or call a Frantic delivery API.

## Substantive post-claim change

The candidate adds `pinned-source-coverage.md` to the Sourcey navigation and
regenerates the static site. The new public page records the BSD-3-Clause source
pin, 15 packages, 19 non-test Go files, 110 exported declarations, and the five
byte-exact page-to-source proof fields. Hosting and rationale pages now state
that an earlier deployment cannot prove the candidate bytes are live.

The target source snapshot and commit pin are unchanged. The full Sourcey
adapter pipeline was rerun after the claim; the result contains 22 Sourcey
pages and 30 packaged `dist` files, including the bounded Go API navigation
redirect.

## Adoption boundary

`https://github.com/go-redsync/redsync/pull/245` is open and unmerged. It is an
optional README link proposal, not evidence of adoption. No report or evidence
may describe it as maintainer acceptance unless its state changes and that
change is independently verified.

## Local checks

- Pinned runx CLI: `runx-cli 0.6.14`.
- Sourcey godoc adapter: 15 packages, zero diagnostics.
- Inventory: 15 packages, 19 non-test Go files, 110 exported symbols.
- Page/source mappings: exactly five, each bound to generated HTML SHA-256,
  canonical repository-LF source SHA-256, and pinned Git blob SHA-1.
- Isolated Sourcey rebuild: all 30 committed `dist` files byte-identical.
- Package and validator tests: 29 passed, zero failed or skipped.
- Validation skill inspection: pinned CLI reports status `ok`; fixture runs are
  test-only and never claim a live pass.

## Proposed publication sequence

1. Independent Nietzsche QA reviews the exact local commit and outbound action.
2. After PASS only, fast-forward the public docs repository from the stated
   base to this exact candidate commit; do not force-push or regenerate bytes.
3. Wait for a fresh Read the Docs build tied to that commit and verify the
   public page bytes through the bounded canonicalizer.
4. Run the manual governed live workflow with exact immutable inputs, resolve
   and verify the exact root receipt, then perform hosted notary publication
   separately.
5. Create final evidence and report in a later immutable commit, run final
   Nietzsche QA, and use the guarded Frantic delivery path before the deadline.

The current public site may still serve the pre-candidate revision. It is not
valid evidence for this candidate until a fresh deployment is visible.

## Superseding workflow and reproducibility repair

Two prior push-associated workflow records failed before creating any job. The
repair removes `runner.temp` from job-level `env`; the first bash step derives
both temporary directories from `$RUNNER_TEMP`, writes them to `$GITHUB_ENV`,
and creates them before later steps use them. Manual-only triggering, pinned
actions and runx 0.6.14, ephemeral signing, exact root receipt extraction,
verification, fail-closed exits, and always-upload behavior are unchanged.

Sourcey's adapter emits a wall-clock `generated_at`, which made a fresh
snapshot and its manifest record dirty despite identical API semantics. The
wrapper now normalizes only that field to the immutable target commit's real
committer timestamp from `.source-pin.json`, converted to UTC. Documentation
states that this is the source-time provenance basis, not rebuild wall-clock
time. A regression test copies the package into an isolated Git repository,
runs the complete documented preparation command, and requires zero Git diff
for the snapshot, inventory, mappings, manifest, and complete static site.
