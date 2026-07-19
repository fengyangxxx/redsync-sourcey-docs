import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createReceiptTreeArchive } from "../validation-skill/redsync-sourcey-validation/scripts/receipt-tree-archive.mjs";
import { resolveNpxInvocation } from "../scripts/npx-invocation.mjs";
import { reconstructReceiptDirectory } from "../scripts/runx-receipt-directory.mjs";
import { expectedHostedRunIdentity } from "../scripts/hosted-run-provenance.mjs";
import { materializeReceiptProof } from "../scripts/materialize-receipt-proof.mjs";
import { makeWorkspaceTemp } from "./workspace-temp.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const canonicalCheckout = "34e114876b0b11c390a56381ad16ebd13914f8d5";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function without(receipt, fields) {
  const copy = structuredClone(receipt);
  for (const field of fields) delete copy[field];
  return copy;
}

async function signedCiReceiptFixture() {
  const receipt = JSON.parse(await readFile(
    join(root, "tests", "fixtures", "runx-signed-receipt", "receipt.json"),
    "utf8",
  ));
  const seed = Buffer.alloc(32, 0x47);
  const privateDer = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed,
  ]);
  const privateKey = createPrivateKey({ key: privateDer, format: "der", type: "pkcs8" });
  const publicDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const publicKey = publicDer.subarray(publicDer.length - 32);
  receipt.issuer.type = "ci";
  receipt.issuer.public_key_sha256 = `sha256:${sha256(publicKey)}`;
  receipt.id = `sha256:${sha256(Buffer.from(canonicalJson(without(
    receipt,
    ["signature", "digest", "metadata", "id", "lineage"],
  ))))}`;
  receipt.digest = `sha256:${sha256(Buffer.from(canonicalJson(without(
    receipt,
    ["signature", "digest", "metadata"],
  ))))}`;
  receipt.signature = {
    alg: "Ed25519",
    value: `base64:${sign(null, Buffer.from(receipt.digest), privateKey).toString("base64url")}`,
  };
  return {
    receipt,
    key: {
      algorithm: "Ed25519",
      issuer_type: "ci",
      kid: receipt.issuer.kid,
      public_key_base64: publicKey.toString("base64"),
    },
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function command(executable, args) {
  const child = spawn(executable, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  return {
    exitCode,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

async function commandWithEnv(executable, args, env) {
  const child = spawn(executable, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  return { exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

async function verifierEnvironment(directory, suppliedKey) {
  const key = suppliedKey ?? JSON.parse(await readFile(
    join(root, "tests", "fixtures", "runx-signed-receipt", "verifier.json"),
    "utf8",
  ));
  return {
    key,
    env: {
      ...process.env,
      TEMP: directory,
      TMP: directory,
      npm_config_cache: join(root, "node_modules", ".npm-cache"),
      RUNX_RECEIPT_VERIFY_KID: key.kid,
      RUNX_RECEIPT_VERIFY_ED25519_PUBLIC_KEY_BASE64: key.public_key_base64,
    },
  };
}

async function invokeRunx(args, env) {
  const invocation = resolveNpxInvocation(["-y", "@runxhq/cli@0.7.1", ...args]);
  return commandWithEnv(invocation.executable, invocation.args, env);
}

function validVerifyResult(receiptId) {
  return {
    receipt_dir: "/work/receipts",
    signature_mode: "production",
    trees: [{
      root_receipt_id: receiptId,
      receipt_count: 1,
      parent_missing: null,
      valid: true,
      findings: [],
    }],
    unreadable_files: [],
    valid: true,
  };
}

function hostedFetch(record, { phase = "proof", apiStatus = 200, apiOverrides = {}, pageStatus = 200 } = {}) {
  const status = phase === "final" ? "completed" : "in_progress";
  const conclusion = phase === "final" ? "success" : null;
  return async (url) => {
    if (url === record.api_readback.url) {
      const body = Buffer.from(JSON.stringify({
        repository: { full_name: record.repository },
        path: record.workflow.path,
        head_sha: record.head.commit,
        head_branch: record.dispatch_ref,
        event: record.event,
        id: record.run.id,
        run_attempt: record.run.attempt,
        html_url: record.run.url,
        status,
        conclusion,
        ...apiOverrides,
      }));
      return {
        url,
        status: apiStatus,
        ok: apiStatus >= 200 && apiStatus < 300,
        redirected: false,
        headers: new Headers({ "content-type": "application/json" }),
        async arrayBuffer() { return body; },
      };
    }
    if (url === record.run.url) {
      const body = Buffer.from("public run");
      return {
        url,
        status: pageStatus,
        ok: pageStatus >= 200 && pageStatus < 300,
        redirected: false,
        headers: new Headers({ "content-type": "text/html" }),
        async arrayBuffer() { return body; },
      };
    }
    throw new Error(`unexpected hosted URL ${url}`);
  };
}

async function buildProofBundle() {
  const repositoryRoot = await makeWorkspaceTemp("redsync-v9-proof-root-");
  const directory = join(repositoryRoot, "deliveries", "shared-receipt");
  await mkdir(directory, { recursive: true });
  const { receipt, key } = await signedCiReceiptFixture();
  const receiptId = receipt.id;
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const receiptPath = `${receiptId.replace(":", "-")}.json`;
  const statusAudit = {
    status: "PASS",
    status_signals: [{ path: "$.status", value: "sealed" }],
    exit_code_signals: [{ path: "$.execution.exit_code", value: 0 }],
    boolean_signals: [],
    failure_signals: [],
  };
  const records = [{
    path: receiptPath,
    bytes: receiptBytes.length,
    sha256: sha256(receiptBytes),
    json_parse: "parsed",
    schema: receipt.schema,
    receipt_id: receiptId,
    status_audit: statusAudit,
  }];
  const receiptTree = {
    schema: "redsync.receipt_tree.v1",
    root_receipt_id: receiptId,
    root_receipt_ref: receiptId,
    root_receipt_path: receiptPath,
    file_count: 1,
    tree_sha256: sha256(Buffer.from(JSON.stringify(records))),
    receipt_status_audit: {
      schema: "redsync.receipt_status_audit.v1",
      overall_status: "PASS",
      parseable_json_count: 1,
      failed_json_count: 0,
      files: [{ path: receiptPath, ...statusAudit }],
    },
    files: records,
  };
  const packed = createReceiptTreeArchive({
    receiptTree,
    files: [{ path: receiptPath, content: receiptBytes }],
  });
  const evidence = {
    schema_version: "redsync.sourcey.governed_validation.v1",
    status: "PASS",
    live_pass: true,
    validation_mode: "live",
    checked_at: "2026-07-18T00:00:00.000Z",
    inputs: {
      public_url: "https://redsync-sourcey-docs.readthedocs.io/en/latest/",
      docs_repo_url: "https://github.com/fengyangxxx/redsync-sourcey-docs",
      docs_commit: "bc5585dae317d2fcbd48b3774ba10a27f2e585d6",
      target_repo_url: "https://github.com/go-redsync/redsync",
      target_commit: "79f6ba24a8bf41f35141de700d410a06bb27622f",
      upstream_pr_url: "https://github.com/go-redsync/redsync/pull/245",
      upstream_pr_head_commit: "f13cd302b903ae84fc21d914bbeb631a21bb9521",
      mappings_url: "https://raw.githubusercontent.com/fengyangxxx/redsync-sourcey-docs/bc5585dae317d2fcbd48b3774ba10a27f2e585d6/evidence/page-source-mappings.json",
      claimant_github_login: "fengyangxxx",
    },
    cli_version: { output: "runx-cli 0.7.1" },
    checks: [
      {
        id: "claimant_sourcey_star",
        status: "PASS",
        observed: {
          claimant: "fengyangxxx",
          repository: "sourcey/sourcey",
          url: "https://api.github.com/users/fengyangxxx/starred?per_page=100",
          http_status: 200,
          authentication: "none",
          matched_repository: "sourcey/sourcey",
        },
      },
      {
        id: "upstream_pr",
        status: "PASS",
        observed: {
          state: "open",
          merged_at: null,
          head_sha: "f13cd302b903ae84fc21d914bbeb631a21bb9521",
        },
      },
    ],
    summary_consistency: { status_matches_raw_failures: true, live_pass_matches_status: true },
    observations: ["one", "two", "three", "four", "five", "runx-cli 0.7.1"],
    evidence_items: [{ type: "raw_machine_evidence", url: "https://github.com/fengyangxxx/redsync-sourcey-docs/actions/runs/123456789" }],
    project_facts: {
      repository: "https://github.com/go-redsync/redsync",
      commit: "79f6ba24a8bf41f35141de700d410a06bb27622f",
      license: "BSD-3-Clause",
      sourcey_adapter: "godoc",
      sourcey_command: "sourcey godoc --module ./source/redsync --packages ./... --out godoc.json",
      package_count: 15,
      non_test_go_file_count: 19,
      exported_symbol_count: 110,
      generated_page_list: Array.from({ length: 20 }, (_, index) => `page-${index}.html`),
      public_host: {
        public_url: "https://redsync-sourcey-docs.readthedocs.io/en/latest/",
        target_owned: false,
        official: false,
      },
    },
  };
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  const transcriptBytes = Buffer.from("Redsync governed validation\nFINAL_STATUS PASS\n");
  const runnerOutput = {
    status: "PASS",
    live_pass: true,
    validation_mode: "live",
    validation_result: { status: "PASS", live_pass: true, blocked_checks: [] },
    evidence_json: evidence,
    transcript: transcriptBytes.toString("utf8"),
    artifacts: {
      evidence_json: {
        path: "artifacts/evidence.json",
        bytes: evidenceBytes.length,
        sha256: sha256(evidenceBytes),
      },
      transcript: {
        path: "artifacts/transcript.txt",
        bytes: transcriptBytes.length,
        sha256: sha256(transcriptBytes),
      },
    },
  };
  const raw = {
    schema: "runx.skill_run.v1",
    status: "sealed",
    receipt_id: receiptId,
    receipt,
    execution: { exit_code: 0, stdout: JSON.stringify(runnerOutput) },
  };
  const rawBytes = Buffer.from(`${JSON.stringify(raw, null, 2)}\n`);
  await writeFile(join(directory, "runx-version.txt"), "runx-cli 0.7.1\n");
  await writeFile(join(directory, "runx-raw-stdout.json"), rawBytes);
  await writeFile(join(directory, "evidence.json"), evidenceBytes);
  await writeFile(join(directory, "transcript.txt"), transcriptBytes);
  await writeJson(join(directory, "artifact-extraction.json"), {
    status: "PASS",
    receipt_id: receiptId,
    raw_run_sha256: sha256(rawBytes),
    runner_stdout_sha256: sha256(Buffer.from(raw.execution.stdout)),
    evidence_sha256: sha256(evidenceBytes),
    transcript_sha256: sha256(transcriptBytes),
  });
  await writeFile(join(directory, "root-receipt.json"), receiptBytes);
  await writeJson(join(directory, "root-receipt-ref.json"), {
    root_receipt_ref: receiptId,
    root_receipt_sha256: sha256(receiptBytes),
  });
  await writeJson(join(directory, "receipt-tree.json"), receiptTree);
  await writeFile(join(directory, "runx-receipts.archive.json"), packed.archiveBytes);
  await writeJson(join(directory, "receipt-archive-reconstruction.json"), {
    status: "PASS",
    root_receipt_id: receiptId,
    reconstructed_file_count: 1,
    reconstruction_mismatch_count: 0,
  });
  const receiptDirectory = join(directory, "real-receipts");
  await mkdir(receiptDirectory, { recursive: true });
  await writeFile(join(receiptDirectory, receiptPath), receiptBytes);
  const verify = await invokeRunx(
    ["verify", "--receipt-dir", receiptDirectory, "-j"],
    (await verifierEnvironment(directory, key)).env,
  );
  assert.equal(verify.exitCode, 0, verify.stderr.toString("utf8"));
  await writeFile(join(directory, "runx-verify.json"), verify.stdout);
  await writeJson(join(directory, "verification-public-key.json"), key);
  const expectedHostedRun = await expectedHostedRunIdentity(root);
  const runId = 123456789;
  const runUrl = `https://github.com/${expectedHostedRun.repository}/actions/runs/${runId}`;
  const hostedRun = {
    schema_version: "redsync.sourcey.github-hosted-run.v1",
    status: "PASS",
    issuer_scope: "github_actions_hosted_workflow",
    repository: expectedHostedRun.repository,
    workflow: { path: expectedHostedRun.workflow_path, sha256: expectedHostedRun.workflow_sha256 },
    head: { commit: expectedHostedRun.head_commit, tree: expectedHostedRun.head_tree },
    ref: expectedHostedRun.ref,
    dispatch_ref: expectedHostedRun.dispatch_ref,
    event: "workflow_dispatch",
    run: { id: runId, attempt: 1, url: runUrl },
    api_readback: {
      url: `https://api.github.com/repos/${expectedHostedRun.repository}/actions/runs/${runId}`,
      http_status: 200,
      authentication: "none",
      repository: expectedHostedRun.repository,
      workflow_path: expectedHostedRun.workflow_path,
      head_commit: expectedHostedRun.head_commit,
      head_branch: expectedHostedRun.dispatch_ref,
      event: "workflow_dispatch",
      run_id: runId,
      run_attempt: 1,
      run_url: runUrl,
      status: "in_progress",
      conclusion: null,
    },
    public_run_page: {
      url: runUrl,
      final_url: runUrl,
      http_status: 200,
      redirected: false,
      authentication: "none",
    },
  };
  await writeJson(join(directory, "hosted-run-provenance.json"), hostedRun);
  for (const name of [
    "runx-exit-code.txt",
    "artifact-extract-exit-code.txt",
    "root-receipt-resolution-exit-code.txt",
    "receipt-archive-pack-exit-code.txt",
    "receipt-archive-reconstruction-exit-code.txt",
    "runx-verify-exit-code.txt",
    "runx-verify-verdict-exit-code.txt",
    "hosted-run-provenance-exit-code.txt",
  ]) await writeFile(join(directory, name), "0\n");
  return {
    directory,
    receiptId,
    repositoryRoot,
    expectedHostedRun,
    proofFetch: hostedFetch(hostedRun),
    finalFetch: hostedFetch(hostedRun, { phase: "final" }),
    missingFetch: hostedFetch(hostedRun, { apiStatus: 404 }),
  };
}

test("every external GitHub Action ref is an exact 40-character lowercase commit", async () => {
  const { assertPinnedActionRefs } = await import("../scripts/github-action-ref.mjs");
  const workflow = await readFile(join(root, ".github/workflows/validate-sourcey-adoption.yml"), "utf8");
  assert.equal(assertPinnedActionRefs(workflow).length, 3);
  assert.match(workflow, new RegExp(`actions/checkout@${canonicalCheckout}(?:\\s|$)`));
  assert.throws(
    () => assertPinnedActionRefs(`steps:\n  - uses: actions/checkout@${"a".repeat(39)}\n`),
    /40-character/,
  );
  assert.throws(
    () => assertPinnedActionRefs(`steps:\n  - name: Checkout\n    uses: actions/checkout@${"a".repeat(41)}\n`),
    /40-character/,
  );
});

test("runx verification verdict requires the exact successful production shape", async () => {
  const { assertRunxVerifyVerdict } = await import("../scripts/runx-verify-verdict.mjs");
  const receiptId = `sha256:${"a".repeat(64)}`;
  assert.deepEqual(assertRunxVerifyVerdict(validVerifyResult(receiptId), receiptId), validVerifyResult(receiptId));
  for (const invalid of [
    {},
    { ...validVerifyResult(receiptId), valid: null },
    { ...validVerifyResult(receiptId), valid: false },
    { schema: "runx.verify.v1", ...validVerifyResult(receiptId) },
    { ...validVerifyResult(receiptId), unreadable_files: ["broken.json"] },
    { ...validVerifyResult(receiptId), trees: [{
      ...validVerifyResult(receiptId).trees[0],
      root_receipt_id: `sha256:${"b".repeat(64)}`,
    }] },
  ]) assert.throws(() => assertRunxVerifyVerdict(invalid, receiptId), /runx verify verdict/);
});

test("workflow and final delivery verification both parse the exact runx verdict", async () => {
  const workflow = await readFile(join(root, ".github/workflows/validate-sourcey-adoption.yml"), "utf8");
  const deliveryMaterializer = await readFile(join(root, "scripts/materialize-deliveries.mjs"), "utf8");
  const proofMaterializer = await readFile(join(root, "scripts/materialize-receipt-proof.mjs"), "utf8");
  const receiptDirectoryHelper = await readFile(join(root, "scripts/runx-receipt-directory.mjs"), "utf8");
  assert.match(workflow, /runx-verify-verdict\.mjs/);
  assert.match(workflow, /verify\s+\\?\s*\n?\s*--receipt-dir\s+"\$RUNX_RECEIPT_DIR"/);
  assert.doesNotMatch(workflow, /verify[\s\\]+--receipt\s+"\$VALIDATION_OUTPUT_DIR\/root-receipt\.json"/);
  assert.match(workflow, /runx-verify-verdict-exit-code\.txt/);
  assert.ok(workflow.indexOf("runx-verify-verdict.mjs") < workflow.indexOf("extract-runner-artifacts.mjs"));
  assert.match(deliveryMaterializer, /withReconstructedReceiptDirectory/);
  assert.match(receiptDirectoryHelper, /"verify", "--receipt-dir"/);
  assert.match(proofMaterializer, /parseRunxVerifyBytes\(verifyBytes, raw\.receipt_id\)/);
  assert.match(proofMaterializer, /runxVerifyReceiptDirectory/);
  assert.match(proofMaterializer, /mode: "receipt_directory"/);
});

test("real runx 0.7.1 receipt-directory verification passes and single-file output is rejected", async () => {
  const directory = await makeWorkspaceTemp("redsync-v6-real-runx-");
  const receiptDir = join(directory, "receipts");
  await mkdir(receiptDir, { recursive: true });
  const { receipt, key } = await signedCiReceiptFixture();
  const { env } = await verifierEnvironment(directory, key);
  const receiptId = receipt.id;
  const receiptPath = join(receiptDir, `${receiptId.replace(":", "-")}.json`);
  try {
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const directoryVerify = await invokeRunx(["verify", "--receipt-dir", receiptDir, "-j"], env);
    assert.equal(directoryVerify.exitCode, 0, directoryVerify.stderr.toString("utf8"));
    const result = JSON.parse(directoryVerify.stdout.toString("utf8"));
    const { assertRunxVerifyVerdict } = await import("../scripts/runx-verify-verdict.mjs");
    assertRunxVerifyVerdict(result, receiptId);

    const singleVerify = await invokeRunx([
      "verify", "--receipt", receiptPath, "-j",
    ], env);
    assert.equal(singleVerify.exitCode, 0, singleVerify.stderr.toString("utf8"));
    assert.throws(
      () => assertRunxVerifyVerdict(JSON.parse(singleVerify.stdout.toString("utf8")), receiptId),
      /runx verify verdict/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("receipt-directory reconstruction maps a logical colon filename without changing bytes", async () => {
  const { receipt } = await signedCiReceiptFixture();
  const content = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const logicalPath = `${receipt.id}.json`;
  const statusAudit = {
    status: "PASS",
    status_signals: [],
    exit_code_signals: [],
    boolean_signals: [],
    failure_signals: [],
  };
  const record = {
    path: logicalPath,
    bytes: content.length,
    sha256: sha256(content),
    json_parse: "parsed",
    schema: receipt.schema,
    receipt_id: receipt.id,
    status_audit: statusAudit,
  };
  const receiptTree = {
    schema: "redsync.receipt_tree.v1",
    root_receipt_id: receipt.id,
    root_receipt_ref: receipt.id,
    root_receipt_path: logicalPath,
    file_count: 1,
    tree_sha256: sha256(Buffer.from(JSON.stringify([record]))),
    receipt_status_audit: {
      schema: "redsync.receipt_status_audit.v1",
      overall_status: "PASS",
      parseable_json_count: 1,
      failed_json_count: 0,
      files: [{ path: logicalPath, ...statusAudit }],
    },
    files: [record],
  };
  const packed = createReceiptTreeArchive({
    receiptTree,
    files: [{ path: logicalPath, content }],
  });
  const directory = await makeWorkspaceTemp("redsync-v6-colon-reconstruct-");
  try {
    await reconstructReceiptDirectory({ archiveBytes: packed.archiveBytes, receiptTree, outputDir: directory });
    const reconstructed = await readFile(join(directory, `${receipt.id.replace(":", "-")}.json`));
    assert.ok(reconstructed.equals(content));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("current README commands use the governed runx 0.7.1 version", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  assert.match(readme, /@runxhq\/cli@0\.7\.1/);
  assert.doesNotMatch(readme, /@runxhq\/cli@0\.6\.14|pinned runx 0\.6\.14/i);
});

test("receipt proof materializer replays the complete actual signed receipt directory", async () => {
  const { directory, receiptId, proofFetch, expectedHostedRun } = await buildProofBundle();
  try {
    await materializeReceiptProof({ artifactDir: directory, fetchImpl: proofFetch, expectedHostedRun });
    const proof = JSON.parse(await readFile(join(directory, "receipt-proof.json"), "utf8"));
    assert.equal(proof.receipt_ref, receiptId);
    assert.equal(proof.verification.mode, "receipt_directory");
    assert.equal(proof.verification.replay_exit_code, 0);
    assert.match(proof.verification.replay_verdict_sha256, /^[0-9a-f]{64}$/);
    assert.equal(proof.issuer_scope, "github_actions_hosted_workflow");
    assert.equal(proof.hosted_run.workflow_path, ".github/workflows/validate-sourcey-adoption.yml");
    assert.equal(proof.extraction.status, "PASS");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("actual raw bundle materializes an internally consistent resolved four-artifact package", async () => {
  const { directory, receiptId, repositoryRoot, expectedHostedRun, proofFetch, finalFetch } = await buildProofBundle();
  await materializeReceiptProof({ artifactDir: directory, fetchImpl: proofFetch, expectedHostedRun });
  const outputRoot = join(repositoryRoot, "final-deliveries");
  const { materialize } = await import("../scripts/materialize-deliveries.mjs");
  await materialize({
    validationEvidencePath: join(directory, "evidence.json"),
    proofPath: join(directory, "receipt-proof.json"),
    outputRoot,
    repositoryRoot,
    expectedHostedRun,
    hostedFetch: finalFetch,
  });
  const base = join(outputRoot, "frantic-33");
  const acceptance = JSON.parse(await readFile(join(base, "acceptance.json"), "utf8"));
  const delivery = JSON.parse(await readFile(join(base, "delivery.json"), "utf8"));
  const evidence = JSON.parse(await readFile(join(base, "evidence.json"), "utf8"));
  const report = await readFile(join(base, "report.md"), "utf8");
  assert.equal(delivery.receipt_ref, receiptId);
  assert.equal(evidence.preparation_state, "governed_receipt_resolved_pending_final_qa");
  assert.equal(evidence.provenance_roles.docs_deployment_status, "deployed_and_live_validated");
  assert.equal(evidence.governed_receipt.status, "PASS");
  assert.equal(evidence.governed_receipt.final_delivery_authorization, false);
  assert.equal(acceptance.preparation_state, "governed_receipt_resolved_pending_final_qa");
  assert.ok(acceptance.criteria.every((criterion) => criterion.status === "PASS"));
  assert.match(report, /governed receipt is resolved/i);
  assert.doesNotMatch(report, /pending governed receipt/i);
});

test("nonexistent hosted run blocks proof and final packet materialization", async () => {
  const proofBlocked = await buildProofBundle();
  await assert.rejects(materializeReceiptProof({
    artifactDir: proofBlocked.directory,
    fetchImpl: proofBlocked.missingFetch,
    expectedHostedRun: proofBlocked.expectedHostedRun,
  }), /GitHub run API status/);
  await assert.rejects(access(join(proofBlocked.directory, "receipt-proof.json")), { code: "ENOENT" });

  const finalBlocked = await buildProofBundle();
  await materializeReceiptProof({
    artifactDir: finalBlocked.directory,
    fetchImpl: finalBlocked.proofFetch,
    expectedHostedRun: finalBlocked.expectedHostedRun,
  });
  const outputRoot = join(finalBlocked.repositoryRoot, "nonexistent-run-output");
  const { materialize } = await import("../scripts/materialize-deliveries.mjs");
  await assert.rejects(materialize({
    validationEvidencePath: join(finalBlocked.directory, "evidence.json"),
    proofPath: join(finalBlocked.directory, "receipt-proof.json"),
    outputRoot,
    repositoryRoot: finalBlocked.repositoryRoot,
    expectedHostedRun: finalBlocked.expectedHostedRun,
    hostedFetch: finalBlocked.missingFetch,
  }), /GitHub run API status/);
  await assert.rejects(access(join(outputRoot, "frantic-33", "delivery.json")), { code: "ENOENT" });
});

test("final loader rejects missing or drifted transcript, extraction, inputs, and hosted identity", async (context) => {
  async function runMutation(name, mutate) {
    await context.test(name, async () => {
      const bundle = await buildProofBundle();
      await materializeReceiptProof({
        artifactDir: bundle.directory,
        fetchImpl: bundle.proofFetch,
        expectedHostedRun: bundle.expectedHostedRun,
      });
      await mutate(bundle);
      const { materialize } = await import("../scripts/materialize-deliveries.mjs");
      await assert.rejects(materialize({
        validationEvidencePath: join(bundle.directory, "evidence.json"),
        proofPath: join(bundle.directory, "receipt-proof.json"),
        outputRoot: join(bundle.repositoryRoot, "rejected-output"),
        repositoryRoot: bundle.repositoryRoot,
        expectedHostedRun: bundle.expectedHostedRun,
        hostedFetch: bundle.finalFetch,
      }));
      await assert.rejects(access(join(bundle.repositoryRoot, "rejected-output", "frantic-33", "delivery.json")), { code: "ENOENT" });
    });
  }

  await runMutation("missing transcript", ({ directory }) => rm(join(directory, "transcript.txt")));
  await runMutation("tampered transcript", ({ directory }) => writeFile(join(directory, "transcript.txt"), "tampered\n"));
  await runMutation("swapped transcript bytes", async ({ directory }) => {
    const evidence = await readFile(join(directory, "evidence.json"));
    await writeFile(join(directory, "transcript.txt"), evidence);
    const proof = JSON.parse(await readFile(join(directory, "receipt-proof.json"), "utf8"));
    proof.validation.transcript_sha256 = sha256(evidence);
    await writeJson(join(directory, "receipt-proof.json"), proof);
  });
  await runMutation("extraction drift", async ({ directory }) => {
    const extractionPath = join(directory, "artifact-extraction.json");
    const extraction = JSON.parse(await readFile(extractionPath, "utf8"));
    extraction.runner_stdout_sha256 = "f".repeat(64);
    await writeJson(extractionPath, extraction);
    const proof = JSON.parse(await readFile(join(directory, "receipt-proof.json"), "utf8"));
    proof.extraction.sha256 = sha256(await readFile(extractionPath));
    await writeJson(join(directory, "receipt-proof.json"), proof);
  });
  await runMutation("wrong immutable mappings", async ({ directory }) => {
    const proof = JSON.parse(await readFile(join(directory, "receipt-proof.json"), "utf8"));
    proof.inputs.mappings_url = proof.inputs.mappings_url.replace(/bc5585[0-9a-f]+/, "a".repeat(40));
    await writeJson(join(directory, "receipt-proof.json"), proof);
  });
  await runMutation("unrelated hosted workflow", async ({ directory }) => {
    const hostedPath = join(directory, "hosted-run-provenance.json");
    const hosted = JSON.parse(await readFile(hostedPath, "utf8"));
    hosted.workflow.path = ".github/workflows/unrelated.yml";
    await writeJson(hostedPath, hosted);
    const proof = JSON.parse(await readFile(join(directory, "receipt-proof.json"), "utf8"));
    proof.hosted_run.sha256 = sha256(await readFile(hostedPath));
    await writeJson(join(directory, "receipt-proof.json"), proof);
  });
});

test("receipt proof materializer rejects indeterminate or failed verification without output", async (context) => {
  async function runMutation(name, mutate) {
    await context.test(name, async () => {
      const { directory, proofFetch, expectedHostedRun } = await buildProofBundle();
      try {
        await mutate(directory);
        await assert.rejects(materializeReceiptProof({
          artifactDir: directory,
          fetchImpl: proofFetch,
          expectedHostedRun,
        }), undefined, `${name} unexpectedly accepted`);
        await assert.rejects(access(join(directory, "receipt-proof.json")), { code: "ENOENT" });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
  await runMutation("empty verify JSON", (directory) => writeJson(join(directory, "runx-verify.json"), {}));
  await runMutation("null verify verdict", async (directory) => {
    const value = JSON.parse(await readFile(join(directory, "runx-verify.json"), "utf8"));
    value.valid = null;
    await writeJson(join(directory, "runx-verify.json"), value);
  });
  await runMutation("false verify verdict", async (directory) => {
    const value = JSON.parse(await readFile(join(directory, "runx-verify.json"), "utf8"));
    value.valid = false;
    await writeJson(join(directory, "runx-verify.json"), value);
  });
  await runMutation("wrong verify schema", async (directory) => {
    const value = JSON.parse(await readFile(join(directory, "runx-verify.json"), "utf8"));
    value.schema = "runx.verify.v1";
    await writeJson(join(directory, "runx-verify.json"), value);
  });
  await runMutation("hand-authored receipt count drift", async (directory) => {
    const value = JSON.parse(await readFile(join(directory, "runx-verify.json"), "utf8"));
    value.trees[0].receipt_count += 1;
    await writeJson(join(directory, "runx-verify.json"), value);
  });
  await runMutation("nonzero verify exit", (directory) => writeFile(join(directory, "runx-verify-exit-code.txt"), "1\n"));
});
