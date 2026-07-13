import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const goCache = join(tmpdir(), "redsync-sourcey-go-build");
const sourceyCli = join(root, "node_modules", "sourcey", "dist", "cli.js");
const goFlags = [process.env.GOFLAGS, "-buildvcs=false"].filter(Boolean).join(" ");
const output = process.env.SOURCEY_GODOC_OUTPUT ?? "godoc.json";

mkdirSync(goCache, { recursive: true });

const args = [
  sourceyCli,
  "godoc",
  "--module",
  "./source/redsync",
  "--packages",
  "./...",
  "--out",
  output,
];

console.log(`GOCACHE=${goCache}`);
console.log(`GOFLAGS=${goFlags}`);
console.log(`sourcey godoc --module ./source/redsync --packages ./... --out ${output}`);

const result = spawnSync(process.execPath, args, {
  cwd: root,
  env: { ...process.env, GOCACHE: goCache, GOFLAGS: goFlags },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
