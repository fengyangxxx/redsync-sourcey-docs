# Hosting Decision

Read the Docs is the selected hosting service. The project slug and public URL
are established during the publication phase; this source commit does not
claim that an import or public deployment has already completed.

Read the Docs provides a durable, project-named documentation service rather
than a personal GitHub Pages site, tunnel, or deploy-preview URL. After the
project exists, upstream maintainers can be invited and operational control can
be transferred if the Redsync maintainers choose to adopt the documentation.

The repository commits the generated Sourcey snapshot and static output.
`.readthedocs.yaml` installs the pinned dependencies, rebuilds the static site
from `godoc.json`, and copies `dist/` to `$READTHEDOCS_OUTPUT/html/`.

Phase-aware status:

- Static site: built and locally verified.
- Initial publication: performed after this package is committed and imported.
- Upstream adoption PR: opened only after the public site exists and can be
  linked and reviewed by maintainers.
- Governed live validation: run only after both the site and PR exist.
- Immutable receipt, evidence, and report links: recorded in a later commit
  after validation and notary steps produce those artifacts.
