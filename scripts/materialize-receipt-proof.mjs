import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { reconstructReceiptTreeArchive } from "../validation-skill/redsync-sourcey-validation/scripts/receipt-tree-archive.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function args(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) {
      throw new Error(`invalid argument pair at ${argv[index] ?? "<end>"}`);
    }
    values[argv[index]] = argv[index + 1];
  }
  if (!values["--artifact-dir"]) throw new Error("--artifact-dir is required");
  return values;
}

async function bytes(directory, name) {
  return readFile(join(directory, name));
}

async function json(directory, name) {
  return JSON.parse((await bytes(directory, name)).toString("utf8"));
}

async function requireZero(directory, name) {
  const value = (await bytes(directory, name)).toString("utf8").trim();
  if (value !== "0") throw new Error(`${name} must contain exact exit code 0, observed ${JSON.stringify(value)}`);
}

async function main() {
  const flags = args(process.argv.slice(2));
  const directory = resolve(flags["--artifact-dir"]);
  for (const exitFile of [
    "runx-exit-code.txt",
    "artifact-copy-exit-code.txt",
    "root-receipt-resolution-exit-code.txt",
    "receipt-archive-pack-exit-code.txt",
    "receipt-archive-reconstruction-exit-code.txt",
    "runx-verify-exit-code.txt",
  ]) await requireZero(directory, exitFile);

  const versionOutput = (await bytes(directory, "runx-version.txt")).toString("utf8").trim();
  assert.equal(versionOutput, "runx-cli 0.7.1");
  const rawBytes = await bytes(directory, "runx-raw-stdout.json");
  const raw = JSON.parse(rawBytes.toString("utf8"));
  if (raw.schema !== "runx.skill_run.v1" || raw.status !== "sealed") {
    throw new Error("runx raw output is not an exact sealed skill run");
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(raw.receipt_id ?? "")) {
    throw new Error("runx raw output has no exact root receipt id");
  }
  if (raw.receipt?.schema !== "runx.receipt.v1" || raw.receipt?.id !== raw.receipt_id) {
    throw new Error("runx raw embedded receipt does not match its receipt id");
  }

  const evidenceBytes = await bytes(directory, "evidence.json");
  const evidence = JSON.parse(evidenceBytes.toString("utf8"));
  if (evidence.status !== "PASS" || evidence.live_pass !== true || evidence.validation_mode !== "live") {
    throw new Error("live validation evidence is not PASS");
  }
  assert.equal(evidence.cli_version.output, versionOutput);
  const star = evidence.checks.find((check) => check.id === "claimant_sourcey_star");
  assert.equal(star?.status, "PASS");
  assert.equal(star?.observed.authentication, "none");
  assert.equal(star?.observed.matched_repository, "sourcey/sourcey");

  const rootReference = await json(directory, "root-receipt-ref.json");
  assert.equal(rootReference.root_receipt_ref, raw.receipt_id);
  const rootBytes = await bytes(directory, "root-receipt.json");
  assert.equal(sha256(rootBytes), rootReference.root_receipt_sha256);
  assert.deepEqual(JSON.parse(rootBytes.toString("utf8")), raw.receipt);

  const receiptTree = await json(directory, "receipt-tree.json");
  assert.equal(receiptTree.root_receipt_id, raw.receipt_id);
  if (receiptTree.receipt_status_audit.overall_status !== "PASS") {
    throw new Error("receipt_status_audit overall status is not PASS");
  }
  assert.equal(receiptTree.receipt_status_audit.failed_json_count, 0);
  assert.ok(receiptTree.receipt_status_audit.parseable_json_count >= 1);

  const archiveBytes = await bytes(directory, "runx-receipts.archive.json");
  const reconstructed = reconstructReceiptTreeArchive({ archiveBytes, receiptTree });
  assert.equal(reconstructed.result.status, "PASS");
  assert.equal(reconstructed.result.root_receipt_id, raw.receipt_id);
  assert.equal(reconstructed.result.reconstructed_file_count, receiptTree.file_count);
  const recordedReconstruction = await json(directory, "receipt-archive-reconstruction.json");
  assert.equal(recordedReconstruction.status, "PASS");
  assert.equal(recordedReconstruction.root_receipt_id, raw.receipt_id);
  assert.equal(recordedReconstruction.reconstructed_file_count, receiptTree.file_count);

  const verifyBytes = await bytes(directory, "runx-verify.json");
  const verification = JSON.parse(verifyBytes.toString("utf8"));
  const verificationText = JSON.stringify(verification).toLowerCase();
  if (
    verification.valid === false ||
    /"status":"(?:blocked|error|failed|failure|invalid)"/.test(verificationText)
  ) {
    throw new Error("runx verify output contains a failure signal");
  }
  const publicKey = await json(directory, "verification-public-key.json");
  assert.equal(publicKey.algorithm, "Ed25519");
  assert.equal(publicKey.issuer_type, "ci");
  assert.match(publicKey.public_key_base64, /^[A-Za-z0-9+/]+={0,2}$/);

  const transcriptBytes = await bytes(directory, "transcript.txt");
  const proof = {
    schema_version: "redsync.sourcey.governed-receipt-proof.v1",
    status: "PASS",
    receipt_ref: raw.receipt_id,
    issuer_scope: "ephemeral_ci_preparation",
    final_delivery_authorization: false,
    inputs: {
      docs_commit: evidence.inputs.docs_commit,
      target_commit: evidence.inputs.target_commit,
      upstream_pr_url: evidence.inputs.upstream_pr_url,
      upstream_pr_head_commit: evidence.inputs.upstream_pr_head_commit,
    },
    validation: {
      status: evidence.status,
      live_pass: evidence.live_pass,
      mode: evidence.validation_mode,
      checked_at: evidence.checked_at,
      evidence_path: "deliveries/shared-receipt/evidence.json",
      evidence_sha256: sha256(evidenceBytes),
      transcript_path: "deliveries/shared-receipt/transcript.txt",
      transcript_sha256: sha256(transcriptBytes),
    },
    runx: {
      status: raw.status,
      exit_code: 0,
      version_output: versionOutput,
      raw_path: "deliveries/shared-receipt/runx-raw-stdout.json",
      raw_sha256: sha256(rawBytes),
    },
    verification: {
      exit_code: 0,
      valid: true,
      output_path: "deliveries/shared-receipt/runx-verify.json",
      output_sha256: sha256(verifyBytes),
      public_key_path: "deliveries/shared-receipt/verification-public-key.json",
    },
    receipt_tree: {
      status: receiptTree.receipt_status_audit.overall_status,
      path: "deliveries/shared-receipt/receipt-tree.json",
      tree_sha256: receiptTree.tree_sha256,
      file_count: receiptTree.file_count,
      parseable_json_count: receiptTree.receipt_status_audit.parseable_json_count,
      failed_json_count: receiptTree.receipt_status_audit.failed_json_count,
    },
    archive: {
      status: reconstructed.result.status,
      path: "deliveries/shared-receipt/runx-receipts.archive.json",
      sha256: sha256(archiveBytes),
      reconstructed_file_count: reconstructed.result.reconstructed_file_count,
      reconstruction_mismatch_count: 0,
    },
    star: star.observed,
  };
  await writeFile(join(directory, "receipt-proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
  process.stdout.write(`RECEIPT_PROOF_MATERIALIZED ${proof.receipt_ref}\n`);
}

main().catch((error) => {
  process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
