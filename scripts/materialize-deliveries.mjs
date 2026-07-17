import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reconstructReceiptTreeArchive } from "../validation-skill/redsync-sourcey-validation/scripts/receipt-tree-archive.mjs";
import { resolveNpxInvocation } from "./npx-invocation.mjs";

export const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const exact = {
  docsCommit: "2b58caa8d60147df494ce995f3777944a400b9a9",
  targetCommit: "79f6ba24a8bf41f35141de700d410a06bb27622f",
  prUrl: "https://github.com/go-redsync/redsync/pull/245",
  prHead: "f13cd302b903ae84fc21d914bbeb631a21bb9521",
  publicUrl: "https://redsync-sourcey-docs.readthedocs.io/en/latest/",
  starUrl: "https://api.github.com/users/fengyangxxx/starred?per_page=100",
  runxVersion: "runx-cli 0.7.1",
};
const platformLiveState = {
  work_status: "delivered",
  capacity: 1,
  occupied: 1,
  available: 0,
  active: 0,
  delivered: 1,
};
const publication = {
  repository: "https://github.com/fengyangxxx/redsync-sourcey-docs",
  destination_ref: "refs/heads/fix/frantic33-governed-receipt-v3",
  expected_pre_push_state: "branch_absent",
  workflow: ".github/workflows/validate-sourcey-adoption.yml",
  dispatch_ref: "fix/frantic33-governed-receipt-v3",
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function resolveRepoPath(path) {
  assert.equal(isAbsolute(path), false, `artifact path must be repository-relative: ${path}`);
  const resolved = resolve(repoRoot, path);
  const rel = relative(repoRoot, resolved);
  assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel), `artifact path escapes repository: ${path}`);
  return resolved;
}

async function runxVerify(rootReceiptPath, key) {
  const env = {
    ...process.env,
    npm_config_cache: join(repoRoot, "node_modules", ".npm-cache"),
    RUNX_RECEIPT_VERIFY_KID: key.kid,
    RUNX_RECEIPT_VERIFY_ED25519_PUBLIC_KEY_BASE64: key.public_key_base64,
  };
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
  delete env.RUNX_TOKEN;
  const invocation = resolveNpxInvocation([
    "-y", "@runxhq/cli@0.7.1", "verify", "--receipt", rootReceiptPath, "-j",
  ]);
  const child = spawn(invocation.executable, invocation.args, {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: invocation.shell,
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolveExit, reject) => {
    child.on("error", reject);
    child.on("close", resolveExit);
  });
  return { exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

function assertExactMachineEvidence(evidence) {
  assert.equal(evidence.schema_version, "redsync.sourcey.governed_validation.v1");
  assert.equal(evidence.status, "PASS");
  assert.equal(evidence.live_pass, true);
  assert.equal(evidence.validation_mode, "live");
  assert.equal(evidence.inputs.docs_commit, exact.docsCommit);
  assert.equal(evidence.inputs.target_commit, exact.targetCommit);
  assert.equal(evidence.inputs.upstream_pr_url, exact.prUrl);
  assert.equal(evidence.inputs.upstream_pr_head_commit, exact.prHead);
  assert.equal(evidence.inputs.claimant_github_login, "fengyangxxx");
  assert.equal(evidence.cli_version.output, exact.runxVersion);
  const star = evidence.checks.find((check) => check.id === "claimant_sourcey_star");
  assert.equal(star?.status, "PASS");
  assert.deepEqual(
    {
      claimant: star?.observed.claimant,
      repository: star?.observed.repository,
      url: star?.observed.url,
      http_status: star?.observed.http_status,
      authentication: star?.observed.authentication,
      matched_repository: star?.observed.matched_repository,
    },
    {
      claimant: "fengyangxxx",
      repository: "sourcey/sourcey",
      url: exact.starUrl,
      http_status: 200,
      authentication: "none",
      matched_repository: "sourcey/sourcey",
    },
  );
  const pr = evidence.checks.find((check) => check.id === "upstream_pr");
  assert.equal(pr?.status, "PASS");
  assert.equal(pr?.observed.state, "open");
  assert.equal(pr?.observed.merged_at, null);
  assert.equal(pr?.observed.head_sha, exact.prHead);
  assert.equal(evidence.summary_consistency?.status_matches_raw_failures, true);
  assert.equal(evidence.summary_consistency?.live_pass_matches_status, true);
}

export async function loadValidationEvidence(evidencePath) {
  const bytes = await readFile(resolve(evidencePath));
  const evidence = JSON.parse(bytes.toString("utf8"));
  assertExactMachineEvidence(evidence);
  return { evidence, bytes };
}

export async function loadVerifiedProof(proofPath) {
  const proofBytes = await readFile(resolve(proofPath));
  const proof = JSON.parse(proofBytes.toString("utf8"));
  if (
    proof.schema_version !== "redsync.sourcey.governed-receipt-proof.v1" ||
    proof.status !== "PASS" ||
    proof.issuer_scope !== "ephemeral_ci_preparation" ||
    proof.final_delivery_authorization !== false ||
    proof.validation?.status !== "PASS" ||
    proof.validation?.live_pass !== true ||
    proof.validation?.mode !== "live" ||
    proof.runx?.status !== "sealed" ||
    proof.runx?.exit_code !== 0 ||
    proof.runx?.version_output !== exact.runxVersion ||
    proof.verification?.exit_code !== 0 ||
    proof.verification?.valid !== true ||
    proof.receipt_tree?.status !== "PASS" ||
    proof.receipt_tree?.failed_json_count !== 0 ||
    proof.archive?.status !== "PASS" ||
    proof.archive?.reconstruction_mismatch_count !== 0 ||
    !/^sha256:[0-9a-f]{64}$/.test(proof.receipt_ref ?? "")
  ) {
    throw new Error("receipt proof is not genuinely verified");
  }
  assert.equal(proof.inputs.docs_commit, exact.docsCommit);
  assert.equal(proof.inputs.target_commit, exact.targetCommit);
  assert.equal(proof.inputs.upstream_pr_url, exact.prUrl);
  assert.equal(proof.inputs.upstream_pr_head_commit, exact.prHead);

  const evidenceBytes = await readFile(resolveRepoPath(proof.validation.evidence_path));
  const evidence = JSON.parse(evidenceBytes.toString("utf8"));
  assert.equal(sha256(evidenceBytes), proof.validation.evidence_sha256);
  assertExactMachineEvidence(evidence);

  const rawBytes = await readFile(resolveRepoPath(proof.runx.raw_path));
  const raw = JSON.parse(rawBytes.toString("utf8"));
  assert.equal(sha256(rawBytes), proof.runx.raw_sha256);
  assert.equal(raw.status, "sealed");
  assert.equal(raw.receipt_id, proof.receipt_ref);

  const tree = JSON.parse(await readFile(resolveRepoPath(proof.receipt_tree.path), "utf8"));
  assert.equal(tree.tree_sha256, proof.receipt_tree.tree_sha256);
  assert.equal(tree.root_receipt_id, proof.receipt_ref);
  assert.equal(tree.receipt_status_audit.overall_status, "PASS");
  assert.equal(tree.receipt_status_audit.failed_json_count, 0);
  const archiveBytes = await readFile(resolveRepoPath(proof.archive.path));
  assert.equal(sha256(archiveBytes), proof.archive.sha256);
  const reconstructed = reconstructReceiptTreeArchive({ archiveBytes, receiptTree: tree });
  assert.equal(reconstructed.result.status, "PASS");
  assert.equal(reconstructed.result.reconstructed_file_count, proof.archive.reconstructed_file_count);
  assert.equal(reconstructed.result.root_receipt_id, proof.receipt_ref);

  const key = JSON.parse(await readFile(resolveRepoPath(proof.verification.public_key_path), "utf8"));
  const rootReference = JSON.parse(
    await readFile(resolveRepoPath("deliveries/shared-receipt/root-receipt-ref.json"), "utf8"),
  );
  assert.equal(rootReference.root_receipt_ref, proof.receipt_ref);
  const freshVerify = await runxVerify(
    resolveRepoPath("deliveries/shared-receipt/root-receipt.json"),
    key,
  );
  if (freshVerify.exitCode !== 0) {
    throw new Error(`receipt proof cryptographic verification failed: ${freshVerify.stderr.toString("utf8").trim()}`);
  }
  return { proof, proofBytes, evidence };
}

export function buildCiWorkflowInputs() {
  return {
    schema_version: "frantic.sourcey.linux-ci-inputs.v1",
    status: "BLOCKED_UNTIL_DISPATCHED_AND_VERIFIED",
    workflow: ".github/workflows/validate-sourcey-adoption.yml",
    publication,
    runx_version_output: exact.runxVersion,
    receipt_issuer_type: "ci",
    final_delivery_authorization: false,
    inputs: {
      public_url: exact.publicUrl,
      docs_repo_url: "https://github.com/fengyangxxx/redsync-sourcey-docs",
      docs_commit: exact.docsCommit,
      target_repo_url: "https://github.com/go-redsync/redsync",
      target_commit: exact.targetCommit,
      upstream_pr_url: exact.prUrl,
      upstream_pr_head_commit: exact.prHead,
      mappings_url: `https://raw.githubusercontent.com/fengyangxxx/redsync-sourcey-docs/${exact.docsCommit}/evidence/page-source-mappings.json`,
      claimant_github_login: "fengyangxxx",
    },
    required_outputs: [
      "evidence.json",
      "transcript.txt",
      "runx-raw-stdout.json",
      "root-receipt.json",
      "root-receipt-ref.json",
      "receipt-tree.json",
      "receipt-status-audit.json",
      "runx-receipts.archive.json",
      "receipt-archive-reconstruction.json",
      "runx-verify.json",
    ],
    final_materialization_command: "node scripts/materialize-deliveries.mjs --validation-evidence deliveries/shared-validation/evidence.json --receipt-proof deliveries/shared-receipt/receipt-proof.json",
    blocker: {
      code: "linux_ci_receipt_required",
      detail: "Native Windows runx 0.6.14 cannot persist colon receipt filenames; 0.7.1 writes a safe filename but the native store reread still fails. A successful Linux CI run, archive reconstruction, and independent runx verify are mandatory.",
      native_windows_attempts: [
        {
          runx_version_output: "runx-cli 0.6.14",
          status: "BLOCKED",
          error: "receipt store is unreadable (os error 87)",
          raw_sha256: "ca84470db9a2d8b71d9f0e94a0d0523c395a6b4897ec2fa6640774faeda0c594",
          evidence_sha256: "6b6fc1ee7cfd200acd9aef68234a7c071030b794a084ec358c66c14e0de0bd17",
          receipt_ref: null,
        },
        {
          runx_version_output: "runx-cli 0.7.1",
          status: "BLOCKED",
          error: "receipt store is unreadable (os error 5)",
          raw_sha256: "9c732347527191128f1db3bca03b7b135f386c61cf9894d9a9acf763aaae06a2",
          evidence_sha256: "84c2564941effd9cc802947874048331a425961c11511f3c5e9725a1295bea51",
          receipt_ref: null,
        },
      ],
    },
  };
}

function acceptance(task, resolved) {
  assert.equal(task, 33);
  const criteria = [
    ["runx_version", "Literal runx-cli 0.7.1 satisfies the required >=0.6.13 CLI floor."],
    ["third_party_oss", "Redsync is maintained third-party BSD-3-Clause OSS at an immutable commit."],
    ["project_depth", "The pinned project covers 15 packages, 19 non-test Go files, and 110 exported symbols."],
    ["public_sourcey_site", "The anonymous ReadTheDocs home and generated API pages pass live content checks."],
    ["durable_host_boundary", "The project-named community ReadTheDocs home has public source and an honest non-official boundary."],
    ["source_generated_items", "The Sourcey output contains at least 20 generated documentation pages."],
    ["evidence_content", "Evidence records exact repository, commit, license, adapter, command, config, pages, and coverage."],
    ["governed_receipt", "A sealed runx receipt is verified and its complete tree reconstructs byte-for-byte."],
    ["maintainer_gap_report", "The report gives concrete source-linked gaps useful to Redsync maintainers."],
  ];
  return {
    schema_version: "frantic.delivery-preparation.acceptance.v1",
    task,
    posting_id: "p-8b91e1ac8c",
    preparation_state: "claim_neutral",
    criteria: criteria.map(([id, requirement]) => ({
      id,
      requirement,
      status: !resolved && id === "governed_receipt" ? "BLOCKED" : "PASS",
      ...(!resolved && id === "governed_receipt" ? { blocker: "linux_ci_receipt_required" } : {}),
    })),
  };
}

function report(task, resolved) {
  assert.equal(task, 33);
  const heading = "# Frantic 33 Redsync Sourcey Preparation Report";
  const receiptLine = resolved
    ? "- Linux CI produced a sealed receipt; its complete tree was archived, reconstructed byte-for-byte, and independently verified."
    : "- Linux CI receipt capture remains mandatory; native Windows receipt-store failures are recorded and no receipt reference is claimed.";
  return `${heading}

This claim-neutral package documents claimant-authored project-named community documentation. The ReadTheDocs site is not target-owned or official. PR 245 is open and unmerged; it is not adoption, endorsement, or maintainer acceptance.

Current task state is \`work_status=delivered\`, \`occupied=1\`, \`available=0\`, and \`active=0\`. No active claim or final delivery authorization is represented by this package.

## Verified Scope

- Redsync is pinned at \`${exact.targetCommit}\` under BSD-3-Clause.
- Sourcey 3.6.3 uses the \`godoc\` adapter and the exact command \`sourcey godoc --module ./source/redsync --packages ./... --out godoc.json\`.
- The snapshot covers 15 packages, 19 non-test Go files, and 110 exported symbols.
- The public ReadTheDocs home and five generated-page/source byte mappings passed live anonymous checks.
- \`runx-cli 0.7.1\` is the literal pinned CLI output and satisfies the required version floor.
- The anonymous GitHub starred-repository list contains exact \`sourcey/sourcey\` for \`fengyangxxx\` with no Authorization header.
${receiptLine}

## Maintainer-Facing Gaps

### Gap 1: Legacy reference entry point

The pinned README still points readers to a legacy godoc URL. A maintained package index would give users one current path to all adapters and lifecycle APIs.

### Gap 2: Adapter discovery

The Redis interface and go-redis, Redigo, Rueidis, and Valkey adapters are spread across separate source directories. Upstream still lacks a concise adapter-selection guide.

### Gap 3: Lock lifecycle guidance

Retry, expiry, drift, timeout, fail-fast, unlock, extend, and validity behavior span \`redsync.go\` and \`mutex.go\`. A task-oriented correctness and recovery guide remains useful maintainer work.

### Gap 4: Refresh policy

The documentation is intentionally pinned. An upstream release-aware rebuild or exported-symbol drift check would prevent future Redsync releases from silently outgrowing the reference.

## Boundary

- Public home: ${exact.publicUrl}
- Public source: https://github.com/fengyangxxx/redsync-sourcey-docs
- Optional proposal: ${exact.prUrl}
- Reviewed publication destination: ${publication.repository} at \`${publication.destination_ref}\`; expected pre-push state is branch absent.
- Governed workflow: \`${publication.workflow}\`, dispatch ref \`${publication.dispatch_ref}\`.
- Final delivery authorization: \`false\`.
- Final Frantic claim identity, final QA, guarded submission, and delivery authorization are external to these static bytes.
`;
}

export function buildTaskFiles(task, context) {
  if (task !== 33) {
    throw new Error("Redsync is already the Frantic 33 target and cannot satisfy Frantic 113 new-ground acceptance");
  }
  const resolved = Boolean(context.verified);
  const machineEvidence = context.verified?.evidence ?? context.validation.evidence;
  const proof = context.verified?.proof;
  const proofBytes = context.verified?.proofBytes;
  const facts = machineEvidence.project_facts;
  const postingId = "p-8b91e1ac8c";
  const receiptRef = proof?.receipt_ref ?? null;
  const evidence = {
    schema_version: "frantic.delivery-preparation.evidence.v1",
    task,
    posting_id: postingId,
    preparation_state: "claim_neutral",
    platform_live_state: platformLiveState,
    outbound_publication_plan: {
      ...publication,
      final_delivery_authorization: false,
    },
    summary: "Claimant-authored ReadTheDocs community publication for pinned Redsync, validated with Sourcey and runx-cli 0.7.1 across complete package coverage while preserving the honest non-official and non-adopted boundary; Linux CI receipt sealing remains explicit.",
    observations: machineEvidence.observations,
    evidence_items: [
      ...machineEvidence.evidence_items,
      {
        type: "live_machine_validation",
        local_ref: "deliveries/shared-validation/evidence.json",
        sha256: sha256(context.validation.bytes),
      },
      {
        type: resolved ? "sealed_receipt" : "receipt_gate",
        local_ref: "deliveries/shared-receipt/receipt-proof.json",
        status: resolved ? "PASS" : "BLOCKED",
      },
    ],
    target: {
      repository: facts.repository,
      commit: facts.commit,
      license: facts.license,
    },
    sourcey: {
      version: "3.6.3",
      adapter: facts.sourcey_adapter,
      command: facts.sourcey_command,
      config: "sourcey.config.ts",
    },
    coverage: {
      package_count: facts.package_count,
      non_test_go_file_count: facts.non_test_go_file_count,
      exported_symbols: facts.exported_symbol_count,
      generated_pages: facts.generated_page_list,
    },
    public_host: facts.public_host,
    governed_receipt: resolved
      ? {
          status: "PASS",
          receipt_ref: receiptRef,
          proof_path: "deliveries/shared-receipt/receipt-proof.json",
          proof_sha256: sha256(proofBytes),
          archive_sha256: proof.archive.sha256,
          final_delivery_authorization: false,
        }
      : {
          status: "BLOCKED",
          receipt_ref: null,
          proof_path: "deliveries/shared-receipt/receipt-proof.json",
          proof_sha256: null,
          archive_sha256: null,
          blocker: "linux_ci_receipt_required",
          final_delivery_authorization: false,
        },
  };
  const base = `deliveries/frantic-${task}`;
  const files = new Map([
    ["acceptance.json", jsonBytes(acceptance(task, resolved))],
    ["delivery.json", jsonBytes({
      public_url: exact.publicUrl,
      evidence_json: `${base}/evidence.json`,
      receipt_ref: receiptRef,
      report: `${base}/report.md`,
    })],
    ["evidence.json", jsonBytes(evidence)],
    ["report.md", Buffer.from(report(task, resolved))],
  ]);
  files.set("manifest.json", jsonBytes({
    schema_version: "frantic.delivery-preparation.manifest.v1",
    task,
    posting_id: postingId,
    shared_validation: {
      path: "deliveries/shared-validation/evidence.json",
      sha256: sha256(context.validation.bytes),
    },
    shared_receipt: {
      status: resolved ? "verified" : "unresolved",
      proof_path: "deliveries/shared-receipt/receipt-proof.json",
      proof_sha256: proofBytes ? sha256(proofBytes) : null,
    },
    ci_workflow_inputs: {
      path: "deliveries/linux-ci-inputs.json",
      sha256: sha256(context.ciInputBytes),
    },
    files: [...files].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) })),
  }));
  return files;
}

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

export async function materialize({ validationEvidencePath, proofPath, outputRoot }) {
  const validation = await loadValidationEvidence(validationEvidencePath);
  const verified = proofPath ? await loadVerifiedProof(proofPath) : null;
  const ciInputBytes = jsonBytes(buildCiWorkflowInputs());
  await mkdir(outputRoot, { recursive: true });
  await writeFile(join(outputRoot, "linux-ci-inputs.json"), ciInputBytes);
  const context = { validation, verified, ciInputBytes };
  const directory = join(outputRoot, "frantic-33");
  await mkdir(directory, { recursive: true });
  for (const [path, bytes] of buildTaskFiles(33, context)) {
    await writeFile(join(directory, path), bytes);
  }
  return context;
}

async function main() {
  const flags = args(process.argv.slice(2));
  const validationEvidencePath = flags["--validation-evidence"]
    ?? join(repoRoot, "deliveries", "shared-validation", "evidence.json");
  const proofPath = flags["--receipt-proof"];
  const outputRoot = flags["--output-root"] ?? join(repoRoot, "deliveries");
  const context = await materialize({ validationEvidencePath, proofPath, outputRoot });
  process.stdout.write(context.verified
    ? `PREPARATION_MATERIALIZED receipt_ref=${context.verified.proof.receipt_ref}\n`
    : "PREPARATION_TEMPLATES_MATERIALIZED receipt_ref=unresolved linux_ci_required\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
