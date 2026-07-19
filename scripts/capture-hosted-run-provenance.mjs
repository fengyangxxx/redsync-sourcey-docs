import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expectedHostedRunIdentity,
  readHostedRunProvenance,
} from "./hosted-run-provenance.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));

function outputPath(argv) {
  if (argv.length !== 2 || argv[0] !== "--output") throw new Error("--output is required");
  return resolve(argv[1]);
}

async function main() {
  const output = outputPath(process.argv.slice(2));
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  const expected = await expectedHostedRunIdentity(repoRoot);
  assert.equal(process.env.GITHUB_REPOSITORY, expected.repository);
  assert.equal(process.env.GITHUB_SHA, expected.head_commit);
  assert.equal(process.env.GITHUB_REF, expected.ref);
  assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
  const runId = Number(process.env.GITHUB_RUN_ID);
  const attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  const value = await readHostedRunProvenance({
    expected,
    runId,
    runAttempt: attempt,
    phase: "proof",
  });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`);
  process.stdout.write(`HOSTED_RUN_PROVENANCE_PASS ${value.run.url}\n`);
}

main().catch((error) => {
  process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
