# Optional Upstream Proposal Sequence and PR Rationale

This page records the maintainer rationale and required phase ordering. The
optional link proposal is
`https://github.com/go-redsync/redsync/pull/245`. It is currently open and
unmerged, so it is not proof that Redsync maintainers adopted this site.

## Suggested Title

`docs: link generated API documentation`

## Suggested Body Content

This change replaces the legacy `godoc.org` Documentation link with a
project-named Read the Docs site generated from Redsync source by Sourcey.

The initial site is pinned to commit
`79f6ba24a8bf41f35141de700d410a06bb27622f` and covers the root locking API,
Redis interfaces, and go-redis, Redigo, Rueidis, and Valkey adapter packages.
It includes search and exact source links. The build is reproducible from a
committed `godoc.json` snapshot with Sourcey 3.6.3.

The documentation project is intended to be transferable. Once the Read the
Docs project and backing repository exist, Redsync maintainers can be invited
so the project can own future rebuilds or move the static output to a
project-controlled host.

The PR was opened against an earlier public documentation deployment. A fresh
post-claim docs commit and Read the Docs build must be independently verified;
the PR must not be described as adoption unless maintainers merge it. The
following package facts remain pinned:

- Source commit: `79f6ba24a8bf41f35141de700d410a06bb27622f`
- Sourcey-generated HTML pages: `23`, including `15` API package pages; one
  additional `go-api/index.html` compatibility redirect makes `24` packaged
  HTML files
- Five page-to-source checks: `evidence/page-source-mappings.json`

No library code or runtime dependency changes are included.

Governed live validation checks the freshly deployed public pages, pinned
source mappings, and exact PR state/head. Receipt, notary, evidence, and report
links are generated afterward and added in a later immutable commit. Until
then, PR #245 remains only an optional link proposal.
