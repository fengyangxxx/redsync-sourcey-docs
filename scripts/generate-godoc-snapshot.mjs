import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const goCache = join(root, ".cache", "go-build");
const sourceyCli = join(root, "node_modules", "sourcey", "dist", "cli.js");
const goFlags = [process.env.GOFLAGS, "-buildvcs=false"].filter(Boolean).join(" ");
const output = process.env.SOURCEY_GODOC_OUTPUT ?? "godoc.json";
const outputPath = isAbsolute(output) ? output : join(root, output);

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
if (result.status === 0) {
  const pin = JSON.parse(
    readFileSync(join(root, "source", "redsync", ".source-pin.json"), "utf8"),
  );
  if (pin.godoc_generated_at_policy !== "source_commit_committed_at_utc") {
    throw new Error("unsupported godoc generated_at policy");
  }
  const sourceCommitTime = new Date(pin.source_commit_committed_at);
  if (Number.isNaN(sourceCommitTime.valueOf())) {
    throw new Error("source pin has an invalid source_commit_committed_at");
  }
  const normalizedGeneratedAt = sourceCommitTime
    .toISOString()
    .replace(/\.000Z$/, "Z");
  const snapshot = JSON.parse(readFileSync(outputPath, "utf8"));
  snapshot.generated_at = normalizedGeneratedAt;
  writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `normalized generated_at=${normalizedGeneratedAt} basis=source_commit_committed_at`,
  );
}
process.exitCode = result.status ?? 1;
