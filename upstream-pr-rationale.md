# Upstream Adoption Sequence and PR Rationale

This page records the maintainer rationale and required phase ordering. It does
not claim that an upstream PR or public documentation URL already exists in
this commit.

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

The PR is opened only after the initial public documentation deployment. Its
body must link the then-current verified public site rather than predict a URL.
Before opening the PR, the following package facts are checked:

- Source commit: `79f6ba24a8bf41f35141de700d410a06bb27622f`
- Sourcey-generated pages: `21` total, including `15` API package pages
- Five page-to-source checks: `evidence/page-source-mappings.json`

No library code or runtime dependency changes are included.

After the PR exists, governed live validation checks the public pages, pinned
source mappings, and exact PR state/head. Receipt, notary, evidence, and report
links are generated afterward and added in a later immutable commit.
