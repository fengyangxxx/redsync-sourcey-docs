import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output =
  process.env.SOURCEY_HASH_OUTPUT ?? join(root, "evidence", "sha256-manifest.json");
const roots = [
  ".github/workflows",
  ".gitignore",
  ".readthedocs.yaml",
  "README.md",
  "package.json",
  "package-lock.json",
  "sourcey.config.ts",
  "godoc.json",
  "introduction.md",
  "reproduce.md",
  "hosting-decision.md",
  "maintainer-gap-analysis.md",
  "upstream-pr-rationale.md",
  "report.draft.md",
  "scripts",
  "source/redsync",
  "dist",
  "tests",
  "upstream",
  "validation-skill",
  "evidence/commands.local.txt",
  "evidence/hume-handoff.md",
  "evidence/inventory.json",
  "evidence/page-source-mappings.json",
  "evidence/evidence.draft.json",
];

async function collect(path) {
  const fullPath = join(root, path);
  const info = await stat(fullPath);
  if (info.isFile()) return [path];

  const result = [];
  for (const entry of await readdir(fullPath, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) result.push(...(await collect(child)));
    if (entry.isFile()) result.push(child);
  }
  return result;
}

const files = [];
for (const path of roots) files.push(...(await collect(path)));

const records = [];
for (const path of [...new Set(files)].sort()) {
  const bytes = await readFile(join(root, path));
  records.push({
    path: path.split(sep).join("/"),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

const manifest = {
  schema_version: "sha256-manifest/v1",
  repository: "https://github.com/go-redsync/redsync",
  commit: "79f6ba24a8bf41f35141de700d410a06bb27622f",
  files: records,
};

await writeFile(
  output,
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`sha256 manifest files=${records.length}`);
