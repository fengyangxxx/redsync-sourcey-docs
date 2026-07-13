# Frantic #113 - Redsync Sourcey Adoption Report (Draft)

## Status

This is a local implementation draft. It is not a final delivery payload.
External publication, upstream contribution, immutable URLs, and the governed
receipt remain explicit placeholders until the main agent completes and
verifies those actions.

## Target

- Repository: `https://github.com/go-redsync/redsync`
- Commit: `79f6ba24a8bf41f35141de700d410a06bb27622f`
- Module: `github.com/go-redsync/redsync/v4`
- Sourcey: `3.6.3`, `godoc()` adapter
- Governed CLI version evidence: `runx-cli 0.6.14`

## Generated Documentation

The package runs Sourcey's Go introspector against the real pinned module,
commits the resulting `godoc.json`, and builds a navigable static site from that
snapshot. The site covers the root distributed-lock API, core Redis contracts,
and the go-redis, Redigo, Rueidis, and Valkey adapter packages.

Measured local output:

- Sourcey adapter: exit 0, schema 1, 15 packages, 0 diagnostics
- Static site: 21 Sourcey pages and 28 Sourcey output files, plus one
  `go-api/index.html` compatibility redirect for the tab link emitted by
  Sourcey 3.6.3
- Source inventory: 15 packages, 19 non-test Go files, 110 exported symbols
- Exact page/source checks: 5

Machine evidence:

- Package/API/symbol inventory: `evidence/inventory.json`
- Five exact page-to-source mappings: `evidence/page-source-mappings.json`
- Byte hashes: `evidence/sha256-manifest.json`
- Raw local commands: `evidence/commands.local.txt`
- Reproduction steps: `README.md` and `reproduce.md`

## Focused Test Results

- `go test -c -mod=readonly .`: exit 0 (root package compile-only)
- `go test -mod=readonly ./redis/...`: exit 0 for the core Redis contracts and
  all adapter packages
- `go test -mod=readonly ./...`: exit 1 because the upstream root package
  `TestMain` launches `redis-server`, which is not installed on the current
  PATH. The remaining 14 packages passed or had no tests. This environment
  dependency is intentionally reported rather than summarized as all-green.

## Adoption Path

- Planned public site: `PLACEHOLDER_PUBLIC_URL`
- Public site state: `PLACEHOLDER_PUBLIC_URL_STATE`
- Open upstream PR: `PLACEHOLDER_OPEN_PR_URL`
- PR state: `PLACEHOLDER_OPEN_PR_STATE`
- PR head: `PLACEHOLDER_OPEN_PR_HEAD_COMMIT`

The maintainer-facing rationale is in `upstream-pr-rationale.md`; the exact
README-only proposal is in `upstream/README-sourcey-docs.patch`. The proposal
replaces the legacy HTTP godoc.org link with the project-named Read the Docs
site and offers maintainers ownership of the docs project.

## Provenance and Regression Controls

This work is generated after claim from Redsync source at the pinned commit. It
does not reuse go-chi or scafld pages, evidence, or target claims. The public URL
must be a newly deployed worker-authored site whose bytes match this package,
and the upstream PR must expose the contribution diff and open state. URL 200
alone is not sufficient.

## Governed Receipt and Immutable Evidence

- Receipt: `PLACEHOLDER_GOVERNED_RECEIPT_REF`
- Receipt evidence: `PLACEHOLDER_IMMUTABLE_RECEIPT_URL`
- Evidence JSON: `PLACEHOLDER_IMMUTABLE_EVIDENCE_URL`
- Final report: `PLACEHOLDER_IMMUTABLE_REPORT_URL`
- Inventory: `PLACEHOLDER_IMMUTABLE_INVENTORY_URL`
- Mappings: `PLACEHOLDER_IMMUTABLE_MAPPINGS_URL`
- Command transcript: `PLACEHOLDER_IMMUTABLE_COMMAND_TRANSCRIPT_URL`

Every placeholder must be replaced with fresh exact evidence before Nietzsche
final QA. Any artifact change after that QA invalidates the PASS.
