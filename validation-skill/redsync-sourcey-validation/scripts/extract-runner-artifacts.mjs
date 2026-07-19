import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

function blocked(message) {
  throw new Error(`BLOCKED: ${message}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireArtifactMetadata(actual, expected, label) {
  if (
    actual?.path !== expected.path ||
    actual?.bytes !== expected.bytes ||
    actual?.sha256 !== expected.sha256
  ) {
    blocked(`${label} metadata does not bind the exact runner stdout bytes`);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      "run-json": { type: "string" },
      "output-dir": { type: "string" },
    },
    strict: true,
  });
  if (!values["run-json"] || !values["output-dir"]) {
    blocked("--run-json and --output-dir are required");
  }

  let raw;
  try {
    raw = JSON.parse(await readFile(values["run-json"], "utf8"));
  } catch (error) {
    blocked(`runx raw JSON is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (raw.schema !== "runx.skill_run.v1" || raw.status !== "sealed") {
    blocked("runx raw result must be an exact sealed skill run");
  }
  if (raw.execution?.exit_code !== 0) {
    blocked(`runx execution exit code must be 0, observed ${raw.execution?.exit_code ?? "missing"}`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(raw.receipt_id ?? "")) {
    blocked("runx raw result has no exact root receipt id");
  }
  if (raw.receipt?.id !== raw.receipt_id) {
    blocked("embedded root receipt id does not match the run result");
  }

  let output;
  try {
    output = JSON.parse(raw.execution.stdout);
  } catch (error) {
    blocked(`runner stdout is not one JSON object: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (
    output.status !== "PASS" ||
    output.live_pass !== true ||
    output.validation_mode !== "live" ||
    output.validation_result?.status !== "PASS" ||
    output.validation_result?.live_pass !== true ||
    output.validation_result?.blocked_checks?.length !== 0
  ) {
    blocked("runner stdout is not an internally consistent live PASS");
  }
  if (
    output.evidence_json?.status !== "PASS" ||
    output.evidence_json?.live_pass !== true ||
    output.evidence_json?.validation_mode !== "live"
  ) {
    blocked("runner stdout has no exact live PASS evidence object");
  }
  if (typeof output.transcript !== "string" || !output.transcript.endsWith("\n")) {
    blocked("runner stdout has no complete newline-terminated transcript");
  }

  const evidenceText = `${JSON.stringify(output.evidence_json, null, 2)}\n`;
  const transcriptText = output.transcript;
  requireArtifactMetadata(output.artifacts?.evidence_json, {
    path: "artifacts/evidence.json",
    bytes: Buffer.byteLength(evidenceText),
    sha256: sha256(evidenceText),
  }, "evidence.json");
  requireArtifactMetadata(output.artifacts?.transcript, {
    path: "artifacts/transcript.txt",
    bytes: Buffer.byteLength(transcriptText),
    sha256: sha256(transcriptText),
  }, "transcript.txt");

  await mkdir(values["output-dir"], { recursive: true });
  await writeFile(join(values["output-dir"], "evidence.json"), evidenceText);
  await writeFile(join(values["output-dir"], "transcript.txt"), transcriptText);
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    receipt_id: raw.receipt_id,
    raw_run_sha256: sha256(await readFile(values["run-json"])),
    runner_stdout_sha256: sha256(Buffer.from(raw.execution.stdout)),
    evidence_sha256: sha256(evidenceText),
    transcript_sha256: sha256(transcriptText),
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
