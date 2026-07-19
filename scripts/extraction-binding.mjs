import assert from "node:assert/strict";
import { createHash } from "node:crypto";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function assertExtractionBinding({ extraction, raw, rawBytes, evidence, transcript }) {
  assert.equal(extraction?.status, "PASS", "extraction status");
  assert.match(extraction?.receipt_id ?? "", /^sha256:[0-9a-f]{64}$/, "extraction receipt id");
  assert.equal(extraction.receipt_id, raw?.receipt_id, "extraction receipt id");
  assert.equal(extraction.raw_run_sha256, sha256(rawBytes), "extraction raw run hash");
  assert.equal(
    extraction.runner_stdout_sha256,
    sha256(Buffer.from(raw?.execution?.stdout ?? "")),
    "extraction runner stdout hash",
  );
  assert.equal(extraction.evidence_sha256, sha256(evidence), "extraction evidence hash");
  assert.equal(extraction.transcript_sha256, sha256(transcript), "extraction transcript hash");
  const output = JSON.parse(raw.execution.stdout);
  const stdoutEvidence = Buffer.from(`${JSON.stringify(output.evidence_json, null, 2)}\n`);
  const stdoutTranscript = Buffer.from(output.transcript ?? "");
  assert.ok(stdoutEvidence.equals(evidence), "raw runner stdout evidence bytes");
  assert.ok(stdoutTranscript.equals(transcript), "raw runner stdout transcript bytes");
  assert.deepEqual(output.artifacts?.evidence_json, {
    path: "artifacts/evidence.json",
    bytes: evidence.length,
    sha256: sha256(evidence),
  }, "raw runner evidence metadata");
  assert.deepEqual(output.artifacts?.transcript, {
    path: "artifacts/transcript.txt",
    bytes: transcript.length,
    sha256: sha256(transcript),
  }, "raw runner transcript metadata");
  return extraction;
}
