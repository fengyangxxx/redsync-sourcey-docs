# Frantic 33 Redsync Sourcey Preparation Report

This claim-neutral package documents claimant-authored project-named community documentation. The ReadTheDocs site is not target-owned or official. PR 245 is open and unmerged; it is not adoption, endorsement, or maintainer acceptance.

Current task state is `work_status=delivered`, `occupied=1`, `available=0`, and `active=0`. No active claim or final delivery authorization is represented by this package.

## Verified Scope

- Redsync is pinned at `79f6ba24a8bf41f35141de700d410a06bb27622f` under BSD-3-Clause.
- Sourcey 3.6.3 uses the `godoc` adapter and the exact command `sourcey godoc --module ./source/redsync --packages ./... --out godoc.json`.
- The snapshot covers 15 packages, 19 non-test Go files, and 110 exported symbols.
- The public ReadTheDocs home and five generated-page/source byte mappings passed live anonymous checks.
- `runx-cli 0.7.1` is the literal pinned CLI output and satisfies the required version floor.
- The anonymous GitHub starred-repository list contains exact `sourcey/sourcey` for `fengyangxxx` with no Authorization header.
- Linux CI receipt capture remains mandatory; native Windows receipt-store failures are recorded and no receipt reference is claimed.

## Maintainer-Facing Gaps

### Gap 1: Legacy reference entry point

The pinned README still points readers to a legacy godoc URL. A maintained package index would give users one current path to all adapters and lifecycle APIs.

### Gap 2: Adapter discovery

The Redis interface and go-redis, Redigo, Rueidis, and Valkey adapters are spread across separate source directories. Upstream still lacks a concise adapter-selection guide.

### Gap 3: Lock lifecycle guidance

Retry, expiry, drift, timeout, fail-fast, unlock, extend, and validity behavior span `redsync.go` and `mutex.go`. A task-oriented correctness and recovery guide remains useful maintainer work.

### Gap 4: Refresh policy

The documentation is intentionally pinned. An upstream release-aware rebuild or exported-symbol drift check would prevent future Redsync releases from silently outgrowing the reference.

## Boundary

- Public home: https://redsync-sourcey-docs.readthedocs.io/en/latest/
- Public source: https://github.com/fengyangxxx/redsync-sourcey-docs
- Optional proposal: https://github.com/go-redsync/redsync/pull/245
- Reviewed publication destination: https://github.com/fengyangxxx/redsync-sourcey-docs at `refs/heads/fix/frantic33-governed-receipt-v2`; expected pre-push state is branch absent.
- Governed workflow: `.github/workflows/validate-sourcey-adoption.yml`, dispatch ref `fix/frantic33-governed-receipt-v2`.
- Final delivery authorization: `false`.
- Final Frantic claim identity, final QA, guarded submission, and delivery authorization are external to these static bytes.
