# Reproduce the Documentation

Requirements:

- Node.js 22 or newer
- npm
- Go, only when regenerating `godoc.json` from source

Run from the repository root:

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

The governed CLI command is deliberately pinned:

```text
npx -y @runxhq/cli@0.6.14 --version
```

Expected literal output:

```text
runx-cli 0.6.14
```

`npm run snapshot` executes Sourcey's `godoc` adapter against
`source/redsync`. `npm run build` consumes the committed `godoc.json` in
snapshot mode, so Read the Docs does not need a Go toolchain to reproduce the
static HTML. The snapshot wrapper uses a writable OS temporary Go build cache
and `GOFLAGS=-buildvcs=false`; disabling VCS stamping avoids irrelevant errors
from copied example packages while source identity remains pinned separately.
`SOURCEY_GODOC_OUTPUT` can override the default `godoc.json` destination in a
restricted build sandbox; it does not change the Sourcey adapter or source.
