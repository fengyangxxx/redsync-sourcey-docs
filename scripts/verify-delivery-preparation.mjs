import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildCiWorkflowInputs,
  buildTaskFiles,
  loadPreparationEvidence,
  loadValidationEvidence,
  loadVerifiedProof,
  repoRoot,
} from "./materialize-deliveries.mjs";

function args(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) {
      throw new Error(`invalid argument pair at ${argv[index] ?? "<end>"}`);
    }
    parsed[argv[index]] = argv[index + 1];
  }
  return parsed;
}

const flags = args(process.argv.slice(2));
const task = Number(flags["--task"]);
if (task !== 33) {
  throw new Error("Redsync preparation supports only Frantic 33; task 113 requires a new target workspace");
}

const outputRoot = flags["--output-root"] ?? join(repoRoot, "deliveries");
const validationEvidencePath = flags["--validation-evidence"];
const validation = validationEvidencePath
  ? { ...(await loadValidationEvidence(validationEvidencePath)), kind: "live" }
  : await loadPreparationEvidence();
const verified = flags["--receipt-proof"]
  ? await loadVerifiedProof(flags["--receipt-proof"])
  : null;
const ciInputBytes = Buffer.from(`${JSON.stringify(buildCiWorkflowInputs(), null, 2)}\n`);
assert.deepEqual(await readFile(join(outputRoot, "linux-ci-inputs.json")), ciInputBytes);

const expected = buildTaskFiles(task, { validation, verified, ciInputBytes });
for (const [path, bytes] of expected) {
  assert.deepEqual(
    await readFile(join(outputRoot, `frantic-${task}`, path)),
    bytes,
    path,
  );
}

if (!verified) {
  process.stderr.write(`PREPARATION_BLOCKED task=${task} receipt_ref=unresolved linux_ci_required\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`PREPARATION_PASS task=${task} receipt_ref=${verified.proof.receipt_ref}\n`);
}
