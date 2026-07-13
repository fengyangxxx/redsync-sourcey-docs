import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceyCli = join(root, "node_modules", "sourcey", "dist", "cli.js");
const output = process.env.SOURCEY_BUILD_OUTPUT ?? "dist";
const outputPath = isAbsolute(output) ? output : join(root, output);

const args = [sourceyCli, "build", "--output", output];
console.log(`sourcey build --output ${output}`);

const result = spawnSync(process.execPath, args, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status === 0) {
  const phaseAwareOutputs = [
    "index.html",
    "introduction.html",
    "reproduce.html",
    "hosting-decision.html",
    "maintainer-gap-analysis.html",
    "upstream-pr-rationale.html",
    "search-index.json",
    "llms.txt",
    "llms-full.txt",
  ];
  let normalized = 0;
  for (const path of phaseAwareOutputs) {
    const fullPath = join(outputPath, path);
    const bytes = readFileSync(fullPath);
    if (bytes.at(-1) !== 0x0a) {
      appendFileSync(fullPath, "\n");
      normalized += 1;
    }
  }
  console.log(`text output normalization: appended LF to ${normalized} files`);

  const redirect = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0; url=../go-api.html">
  <link rel="canonical" href="../go-api.html">
  <title>Redsync Go API</title>
</head>
<body><p><a href="../go-api.html">Continue to the Redsync Go API</a></p></body>
</html>
`;
  mkdirSync(join(outputPath, "go-api"), { recursive: true });
  writeFileSync(join(outputPath, "go-api", "index.html"), redirect);
  console.log("navigation compatibility: go-api/index.html -> ../go-api.html");
}
process.exitCode = result.status ?? 1;
