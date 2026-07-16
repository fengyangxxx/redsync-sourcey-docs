import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = join(root, "evidence", "local-live-validation");
const manifestPath = join(evidenceDir, "manifest.json");
const files = [
  "evidence.json",
  "transcript.txt",
  "runner-stdout.json",
  "runner-stderr.txt",
  "runx-version.txt",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const bytesByName = new Map();
for (const name of files) bytesByName.set(name, await readFile(join(evidenceDir, name)));
const evidence = JSON.parse(bytesByName.get("evidence.json").toString("utf8"));
const runner = JSON.parse(bytesByName.get("runner-stdout.json").toString("utf8"));
const transcript = bytesByName.get("transcript.txt").toString("utf8");
const stderr = bytesByName.get("runner-stderr.txt").toString("utf8");
const version = bytesByName.get("runx-version.txt").toString("utf8").trim();

for (const [name, bytes] of bytesByName) {
  const content = bytes.toString("utf8");
  assert.doesNotMatch(
    content,
    /(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\/(?:home|Users|tmp|var\/folders)\/)/,
    name,
  );
  assert.doesNotMatch(content, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, name);
}

assert.equal(version, "runx-cli 0.6.14");
assert.equal(evidence.status, "PASS");
assert.equal(evidence.live_pass, true);
assert.equal(evidence.validation_mode, "live");
assert.equal(evidence.cli_version.output, version);
assert.equal(evidence.cli_version.source, "captured_outer_command");
assert.equal(evidence.inputs.output_dir, "artifacts");
assert.equal(evidence.transcript_artifact.path, "artifacts/transcript.txt");
assert.equal(evidence.raw_failure_count, 0);
assert.ok(evidence.checks.length >= 15);
assert.ok(evidence.checks.every((check) => check.status === "PASS"));
assert.ok(evidence.http_checks.length >= 25);
assert.ok(evidence.http_checks.every((check) => check.http_status === 200));
assert.ok(evidence.http_checks.every((check) => check.final_outcome === "response_ok"));
assert.equal(evidence.summary_consistency.status_matches_raw_failures, true);
assert.equal(evidence.summary_consistency.live_pass_matches_status, true);
assert.deepEqual(evidence.summary_consistency.blocked_check_ids, []);
assert.deepEqual(runner.evidence_json, evidence);
assert.equal(runner.status, evidence.status);
assert.deepEqual(runner.checks, evidence.checks);
assert.deepEqual(runner.observations, evidence.observations);
assert.deepEqual(runner.project_facts, evidence.project_facts);
assert.match(transcript, /CLI_VERSION_OUTPUT runx-cli 0\.6\.14/);
assert.match(transcript, /FINAL_STATUS PASS/);
assert.match(transcript, /LIVE_PASS true/);
assert.match(transcript, /BLOCKED_COUNT 0/);
assert.doesNotMatch(transcript, /CHECK \S+ BLOCKED/);
assert.equal(stderr, "");
assert.equal(evidence.project_facts.license, "BSD-3-Clause");
assert.equal(evidence.project_facts.sourcey_adapter, "godoc");
assert.equal(evidence.project_facts.exported_symbol_count, 110);
assert.ok(evidence.project_facts.generated_page_list.length >= 20);
assert.ok(evidence.observations.length >= 6);
assert.ok(evidence.evidence_items.some((item) => item.type === "independent_raw_transcript"));
assert.equal(evidence.project_facts.public_host.official, false);
assert.equal(evidence.project_facts.public_host.target_owned, false);
assert.equal(evidence.project_facts.upstream_pr.adoption, false);
assert.equal(evidence.project_facts.upstream_pr.endorsement, false);
for (const item of evidence.http_checks.filter((check) => /_commit_api$/.test(check.label))) {
  const selected = JSON.parse(item.checked_text);
  assert.deepEqual(Object.keys(selected), ["sha", "files"]);
  assert.ok(selected.files.every((file) => Object.keys(file).length === 1 && "filename" in file));
}

for (const forbiddenRun of ["29385064167", "29386361713"]) {
  for (const [name, bytes] of bytesByName) {
    assert.doesNotMatch(bytes.toString("utf8"), new RegExp(forbiddenRun), name);
  }
}

const records = files.map((name) => {
  const bytes = bytesByName.get(name);
  return { path: name, bytes: bytes.length, sha256: sha256(bytes) };
});
const expectedManifest = {
  schema: "redsync.local_live_validation_manifest.v1",
  validated_docs_commit: evidence.inputs.docs_commit,
  checked_at: evidence.checked_at,
  status: evidence.status,
  files: records,
};

if (process.argv.includes("--write-manifest")) {
  await writeFile(manifestPath, `${JSON.stringify(expectedManifest, null, 2)}\n`);
} else {
  const actualManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(actualManifest, expectedManifest);
}

process.stdout.write(
  `${JSON.stringify({ status: "PASS", files: records.length, checked_at: evidence.checked_at })}\n`,
);
