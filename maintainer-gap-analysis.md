# Maintainer-Facing Documentation Gap Analysis

## Current Gap

Redsync exposes a compact root API and several Redis client adapters, but users
must discover those surfaces by moving between the README, pkg.go.dev, and
individual source directories. The README Documentation section still links to
the legacy `godoc.org` URL over HTTP. It does not provide a project-specific,
navigable package map or make adapter compatibility easy to compare.

## What the Sourcey Site Adds

- A pinned root API page for `Redsync`, `Mutex`, lock lifecycle methods, options,
  and public error types.
- Separate package pages for the core `redis.Pool` and `redis.Conn` contracts.
- Dedicated pages for current and versioned go-redis adapters.
- Dedicated pages for Redigo, Rueidis, and Valkey adapters.
- Search, `llms.txt`, and direct links to the exact source commit.
- A reproducible `godoc.json` snapshot so the rendered documentation does not
  silently drift with a moving branch.

## Maintenance Cost

The proposed upstream change is intentionally small: update the README
Documentation link to the durable project-named site. The generated docs remain
in a separate documentation repository and can be rebuilt with one command
after releases. Upstream maintainers can be invited to the Read the Docs project
and repository without coupling the library release process to Sourcey.

## Remaining Maintainer Gaps

1. The README still points at legacy `godoc.org` over HTTP, so users do not get
   a project-specific package map from the repository home.
2. Adapter choice is spread across package directories; there is no maintained
   compatibility table that distinguishes current and versioned go-redis,
   Redigo, Rueidis, and Valkey entry points.
3. Lock correctness depends on timeout, retry, expiry, and extension choices,
   but the API reference has no task-oriented guide connecting those options
   to failure and recovery behavior.
4. The generated snapshot is pinned rather than release-aware. Maintainers need
   an explicit refresh policy or CI drift check when Redsync cuts a release or
   changes an exported declaration.

## Adoption Recommendation

PR #245 is an optional README link proposal and is still open and unmerged; it
must not be treated as adoption. Maintainers can evaluate the generated pages,
then decide whether to merge the link and take ownership of the Read the Docs
project. If they do not want a separate host, the same committed static output
can later move to a project-owned docs domain without changing the Sourcey
source adapter.
