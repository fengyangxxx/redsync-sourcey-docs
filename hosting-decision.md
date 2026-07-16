# Hosting Decision

Read the Docs is the selected hosting service at
`https://redsync-sourcey-docs.readthedocs.io/en/latest/`. The project already
serves an earlier revision, but this source commit does not claim that the
post-claim candidate has been pushed, built, or deployed.

Read the Docs provides a durable, project-named documentation service rather
than a personal GitHub Pages site, tunnel, or deploy-preview URL. After the
project exists, upstream maintainers can be invited and operational control can
be transferred if the Redsync maintainers choose to adopt the documentation.
Until that happens, this remains claimant-authored community documentation; it
must not be presented as target-owned or official.

The repository commits the generated Sourcey snapshot and static output.
`.readthedocs.yaml` installs the pinned dependencies, rebuilds the static site
from `godoc.json`, and copies `dist/` to `$READTHEDOCS_OUTPUT/html/`.

Phase-aware status:

- Static site: regenerated and locally verified for the candidate commit.
- Candidate publication: pending an independently approved push and fresh Read
  the Docs build; the earlier deployment is not candidate evidence.
- Upstream PR: `https://github.com/go-redsync/redsync/pull/245` is open and
  unmerged. It is an optional README link proposal, not adoption.
- Governed live validation: run only after both the site and PR exist.
- Immutable receipt, evidence, and report links: recorded in a later commit
  after validation and notary steps produce those artifacts.
