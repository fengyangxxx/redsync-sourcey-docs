import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeWorkspaceTemp } from "./workspace-temp.mjs";

const root = new URL("../", import.meta.url);
const expectedArtifactNames = ["evidence_json", "public_url", "receipt_ref", "report"];
const forbiddenStaticTokens = [
  "817adb29-a5d5-493d-8a1d-9f7cb6911b86",
  "2026-07-17T00:14:58.021Z",
  "2026-07-13T22:27:57.468Z",
];

async function text(path) {
  return readFile(new URL(path, root), "utf8");
}

async function json(path) {
  return JSON.parse(await text(path));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function bulletCount(markdown) {
  return markdown.match(/^\s*-\s+\S/gm)?.length ?? 0;
}

async function runMaterializer(args) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../scripts/materialize-deliveries.mjs", import.meta.url)), ...args],
    { cwd: fileURLToPath(root), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  return { exitCode, stdout, stderr };
}

async function runVerifier(task, args = []) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../scripts/verify-delivery-preparation.mjs", import.meta.url)), "--task", String(task), ...args],
    { cwd: fileURLToPath(root), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  return { exitCode, stdout, stderr };
}

async function assertManifest(task) {
  const base = `deliveries/frantic-${task}/`;
  const manifest = await json(`${base}manifest.json`);
  assert.equal(manifest.schema_version, "frantic.delivery-preparation.manifest.v1");
  assert.equal(manifest.task, task);
  assert.deepEqual(
    manifest.files.map((item) => item.path),
    ["acceptance.json", "delivery.json", "evidence.json", "report.md"],
  );
  for (const entry of manifest.files) {
    const bytes = Buffer.from(await text(`${base}${entry.path}`));
    assert.equal(entry.bytes, bytes.length, entry.path);
    assert.equal(entry.sha256, sha256(bytes), entry.path);
  }
  assert.equal(manifest.validation_evidence.status, "unresolved");
  assert.equal(manifest.validation_evidence.path, "evidence/evidence.draft.json");
  const validationBytes = Buffer.from(await text(manifest.validation_evidence.path));
  assert.equal(manifest.validation_evidence.sha256, sha256(validationBytes));
  assert.equal(manifest.shared_receipt.status, "unresolved");
  assert.equal(manifest.shared_receipt.proof_path, "deliveries/shared-receipt/receipt-proof.json");
  assert.equal(manifest.shared_receipt.proof_sha256, null);
  assert.equal(manifest.ci_workflow_inputs.path, "deliveries/linux-ci-inputs.json");
  const ciBytes = Buffer.from(await text(manifest.ci_workflow_inputs.path));
  assert.equal(manifest.ci_workflow_inputs.sha256, sha256(ciBytes));
}

function assertUnresolvedReceiptBinding(acceptance, evidence, delivery, blockedCriterion) {
  assert.equal(acceptance.criteria.find((item) => item.id === blockedCriterion)?.status, "BLOCKED");
  assert.equal(evidence.governed_receipt.status, "BLOCKED");
  assert.equal(evidence.governed_receipt.receipt_ref, null);
  assert.equal(evidence.governed_receipt.proof_path, "deliveries/shared-receipt/receipt-proof.json");
  assert.equal(evidence.governed_receipt.proof_sha256, null);
  assert.equal(evidence.governed_receipt.blocker, "linux_ci_receipt_required");
  assert.equal(evidence.governed_receipt.final_delivery_authorization, false);
  assert.equal(delivery.receipt_ref, null);
}

async function assertPublicClaimMetadataExcluded(task) {
  const base = `deliveries/frantic-${task}/`;
  const combined = await Promise.all(
    ["acceptance.json", "delivery.json", "evidence.json", "report.md", "manifest.json"]
      .map((name) => text(`${base}${name}`)),
  ).then((parts) => parts.join("\n"));
  for (const token of forbiddenStaticTokens) assert.doesNotMatch(combined, new RegExp(token));
  assert.doesNotMatch(combined, /PLACEHOLDER_|\bTODO\b|\bTBD\b/i);
  assert.doesNotMatch(combined, /"(?:claim_id|claimId|claimed_at|fuse_expires_at|deliver_deadline_at)"\s*:/i);
  assert.doesNotMatch(combined, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
}

test("Frantic 33 package maps all nine criteria into a claim-neutral four-artifact payload", async () => {
  const base = "deliveries/frantic-33/";
  const acceptance = await json(`${base}acceptance.json`);
  const evidence = await json(`${base}evidence.json`);
  const report = await text(`${base}report.md`);
  const delivery = await json(`${base}delivery.json`);
  const ciInputs = await json("deliveries/linux-ci-inputs.json");

  assert.equal(acceptance.task, 33);
  assert.equal(acceptance.posting_id, "p-8b91e1ac8c");
  assert.deepEqual(
    acceptance.criteria.map((item) => item.id),
    [
      "runx_version",
      "third_party_oss",
      "project_depth",
      "public_sourcey_site",
      "durable_host_boundary",
      "source_generated_items",
      "evidence_content",
      "governed_receipt",
      "maintainer_gap_report",
    ],
  );
  assert.equal(evidence.task, 33);
  assert.equal(evidence.posting_id, "p-8b91e1ac8c");
  assert.equal(evidence.preparation_state, "preclaim_pending_fresh_claim_and_governed_receipt");
  assert.deepEqual(evidence.platform_live_state, {
    work_status: null,
    available: null,
    active: null,
    snapshot_status: "unresolved_preclaim",
  });
  assert.deepEqual(evidence.provenance_roles, {
    docs_commit: "bc5585dae317d2fcbd48b3774ba10a27f2e585d6",
    docs_deployment_status: "required_before_workflow_dispatch",
    workflow_candidate_ref: "refs/heads/fix/frantic33-governed-receipt-v11",
    workflow_candidate_role: "workflow/receipt tooling only",
    workflow_candidate_requires_readthedocs_deployment: false,
  });
  assert.ok(evidence.summary.length >= 80);
  assert.ok(evidence.observations.length >= 6);
  assert.ok(evidence.evidence_items.length >= 6);
  assert.ok(evidence.observations.includes("runx-cli 0.7.1"));
  assert.match(
    acceptance.criteria.find((item) => item.id === "runx_version")?.requirement ?? "",
    />=0\.6\.13/,
  );
  assert.equal(evidence.target.commit, "79f6ba24a8bf41f35141de700d410a06bb27622f");
  assert.equal(evidence.target.license, "BSD-3-Clause");
  assert.ok(evidence.coverage.exported_symbols >= 20);
  assert.ok(evidence.coverage.generated_pages.length >= 20);
  assert.ok(bulletCount(report) >= 6, `report bullets=${bulletCount(report)}`);
  assert.match(report, /Maintainer-Facing Gaps/i);
  assert.ok((report.match(/^### Gap /gm) ?? []).length >= 3);
  assert.deepEqual(Object.keys(delivery).sort(), expectedArtifactNames);
  assert.equal(delivery.public_url, "https://redsync-sourcey-docs.readthedocs.io/en/latest/");
  assert.equal(delivery.evidence_json, "deliveries/frantic-33/evidence.json");
  assert.equal(delivery.report, "deliveries/frantic-33/report.md");
  assertUnresolvedReceiptBinding(acceptance, evidence, delivery, "governed_receipt");
  assert.match(report, /Linux CI/i);
  assert.doesNotMatch(report, /produced a sealed receipt/i);
  assert.deepEqual(ciInputs.publication, {
    repository: "https://github.com/fengyangxxx/redsync-sourcey-docs",
    destination_ref: "refs/heads/fix/frantic33-governed-receipt-v11",
    expected_pre_push_state: "branch_absent",
    workflow: ".github/workflows/validate-sourcey-adoption.yml",
    dispatch_ref: "fix/frantic33-governed-receipt-v11",
  });
  assert.equal(ciInputs.final_delivery_authorization, false);
  assert.deepEqual(ciInputs.claim_context, {
    state: "unclaimed",
    claim_id: null,
    claimed_at: null,
    claimed_at_local: null,
    deliver_deadline_at: null,
    deliver_deadline_at_local: null,
    required_before_dispatch: true,
  });
  await assertManifest(33);
  await assertPublicClaimMetadataExcluded(33);
});

test("Redsync preparation cannot materialize or verify a Frantic 113 package", async () => {
  const { buildTaskFiles } = await import("../scripts/materialize-deliveries.mjs");
  assert.throws(
    () => buildTaskFiles(113, {}),
    /Redsync is already the Frantic 33 target and cannot satisfy Frantic 113 new-ground acceptance/,
  );

  const directory = await makeWorkspaceTemp("redsync-no-frantic-113-");
  const outputRoot = join(directory, "deliveries");
  const result = await runMaterializer(["--output-root", outputRoot]);
  assert.equal(result.exitCode, 0, result.stderr);
  await assert.rejects(readFile(join(outputRoot, "frantic-113", "delivery.json")), /ENOENT/);

  const verification = await runVerifier(113, ["--output-root", outputRoot]);
  assert.notEqual(verification.exitCode, 0);
  assert.match(
    verification.stderr,
    /Redsync preparation supports only Frantic 33; task 113 requires a new target workspace/,
  );
});

test("package scripts expose deterministic Frantic 33 materialization only", async () => {
  const packageJson = await json("package.json");
  assert.equal(packageJson.scripts["prepare:deliveries"], "node scripts/materialize-deliveries.mjs");
  assert.equal(packageJson.scripts["materialize:receipt-proof"], "node scripts/materialize-receipt-proof.mjs");
  assert.equal(
    packageJson.scripts["verify:delivery:33"],
    "node scripts/verify-delivery-preparation.mjs --task 33",
  );
  assert.equal(packageJson.scripts["verify:delivery:113"], undefined);
  assert.match(packageJson.scripts.test, /tests\/delivery-preparation\.test\.mjs/);
});

test("materializer fails closed on a shape-valid but unverified receipt", async () => {
  const directory = await makeWorkspaceTemp("redsync-fake-receipt-");
  const proofPath = join(directory, "receipt-proof.json");
  const outputRoot = join(directory, "deliveries");
  await writeFile(proofPath, `${JSON.stringify({
    schema_version: "redsync.sourcey.governed-receipt-proof.v1",
    status: "PASS",
    receipt_ref: `sha256:${"a".repeat(64)}`,
    validation: { status: "PASS", live_pass: true, mode: "live" },
    runx: { status: "sealed", exit_code: 0, version_output: "runx-cli 0.7.1" },
    verification: { exit_code: 0, valid: false },
  }, null, 2)}\n`);

  const result = await runMaterializer([
    "--receipt-proof", proofPath,
    "--output-root", outputRoot,
  ]);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /BLOCKED: receipt proof requires exact governed validation evidence/);
  await assert.rejects(readFile(join(outputRoot, "frantic-33", "delivery.json")), /ENOENT/);
  await assert.rejects(readFile(join(outputRoot, "frantic-113", "delivery.json")), /ENOENT/);
});

test("missing receipt proof generates only unresolved templates and verifiers remain blocked", async () => {
  const directory = await makeWorkspaceTemp("redsync-missing-receipt-");
  const outputRoot = join(directory, "deliveries");
  const result = await runMaterializer(["--output-root", outputRoot]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /PREPARATION_TEMPLATES_MATERIALIZED receipt_ref=unresolved/);
  const delivery = JSON.parse(await readFile(join(outputRoot, "frantic-33", "delivery.json"), "utf8"));
  assert.equal(delivery.receipt_ref, null);
  await assert.rejects(readFile(join(outputRoot, "frantic-113", "delivery.json")), /ENOENT/);

  const verification = await runVerifier(33, ["--output-root", outputRoot]);
  assert.notEqual(verification.exitCode, 0);
  assert.match(verification.stderr, /PREPARATION_BLOCKED task=33 receipt_ref=unresolved linux_ci_required/);
});

test("Windows npx invocation preserves every argument through npx-cli.js", async () => {
  const { operatorContextApprovalArgs, resolveNpxInvocation } = await import("../scripts/npx-invocation.mjs");
  const versionInvocation = resolveNpxInvocation(
    ["-y", "@runxhq/cli@0.7.1", "--version"],
    { platform: "win32", execPath: "F:\\Program Files\\nodejs\\node.exe" },
  );
  assert.deepEqual(versionInvocation.args.slice(1), [
    "-y",
    "@runxhq/cli@0.7.1",
    "--version",
  ]);
  const original = [
    "-y",
    "@runxhq/cli@0.7.1",
    "skill",
    "-i",
    "runx_version_output=runx-cli 0.7.1",
  ];
  const invocation = resolveNpxInvocation(original, {
    platform: "win32",
    execPath: "F:\\Program Files\\nodejs\\node.exe",
  });
  assert.equal(invocation.executable, "F:\\Program Files\\nodejs\\node.exe");
  assert.equal(
    invocation.args[0],
    "F:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js",
  );
  assert.deepEqual(invocation.args.slice(1), original);
  assert.equal(invocation.shell, false);
});

test("operator-context approval accepts any nonzero exit and binds the exact digest", async () => {
  const { operatorContextApprovalArgs } = await import("../scripts/npx-invocation.mjs");
  const digest = `sha256:${"b".repeat(64)}`;
  const otherDigest = `sha256:${"c".repeat(64)}`;
  const approvalResponse = Buffer.from(JSON.stringify({
      status: "needs_operator_approval",
      digest,
      approval_flag: `--approve-operator-context ${digest}`,
  }));
  assert.deepEqual(operatorContextApprovalArgs(1, approvalResponse), ["--approve-operator-context", digest]);
  assert.deepEqual(operatorContextApprovalArgs(2, approvalResponse), ["--approve-operator-context", digest]);
  assert.throws(
    () => operatorContextApprovalArgs(0, approvalResponse),
    /invalid operator-context approval response/,
  );
  assert.throws(
    () => operatorContextApprovalArgs(1, Buffer.from(JSON.stringify({
      status: "needs_operator_approval",
      digest: "sha256:not-a-digest",
    }))),
    /invalid operator-context approval response/,
  );
  assert.throws(
    () => operatorContextApprovalArgs(1, Buffer.from(JSON.stringify({
      status: "needs_operator_approval",
      digest,
      approval_flag: `--approve-operator-context ${otherDigest}`,
    }))),
    /invalid operator-context approval response/,
  );
});

test("local capture uses the workflow-supported production receipt issuer", async () => {
  const capture = await text("scripts/capture-governed-receipt.mjs");
  assert.match(capture, /RUNX_RECEIPT_SIGN_ISSUER_TYPE:\s*"ci"/);
  assert.match(capture, /issuer_type:\s*"ci"/);
  assert.doesNotMatch(capture, /issuer_type:\s*"local"|RUNX_RECEIPT_SIGN_ISSUER_TYPE:\s*"local"/);
});

test("native Windows capture is disabled and Linux CI remains the receipt path", async () => {
  const capture = await text("scripts/capture-governed-receipt.mjs");
  assert.match(capture, /process\.platform === "win32"/);
  assert.match(capture, /native Windows receipt capture is unsupported; use the governed Linux CI workflow/);
});
