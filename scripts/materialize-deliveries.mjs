import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reconstructReceiptTreeArchive } from "../validation-skill/redsync-sourcey-validation/scripts/receipt-tree-archive.mjs";
import {
  assertEquivalentReceiptDirectoryVerdicts,
  receiptDirectoryVerdictIdentity,
  runxVerifyReceiptDirectory,
  withReconstructedReceiptDirectory,
} from "./runx-receipt-directory.mjs";
import { parseRunxVerifyBytes } from "./runx-verify-verdict.mjs";
import { assertExtractionBinding } from "./extraction-binding.mjs";
import {
  expectedHostedRunIdentity,
  observeHostedRunProvenance,
} from "./hosted-run-provenance.mjs";

export const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const exact = {
  docsCommit: "bc5585dae317d2fcbd48b3774ba10a27f2e585d6",
  targetCommit: "79f6ba24a8bf41f35141de700d410a06bb27622f",
  prUrl: "https://github.com/go-redsync/redsync/pull/245",
  prHead: "f13cd302b903ae84fc21d914bbeb631a21bb9521",
  publicUrl: "https://redsync-sourcey-docs.readthedocs.io/en/latest/",
  docsRepoUrl: "https://github.com/fengyangxxx/redsync-sourcey-docs",
  targetRepoUrl: "https://github.com/go-redsync/redsync",
  mappingsUrl: "https://raw.githubusercontent.com/fengyangxxx/redsync-sourcey-docs/bc5585dae317d2fcbd48b3774ba10a27f2e585d6/evidence/page-source-mappings.json",
  starUrl: "https://api.github.com/users/fengyangxxx/starred?per_page=100",
  runxVersion: "runx-cli 0.7.1",
};
const platformLiveState = {
  work_status: null,
  available: null,
  active: null,
  snapshot_status: "unresolved_preclaim",
};
const claimContext = {
  state: "unclaimed",
  claim_id: null,
  claimed_at: null,
  claimed_at_local: null,
  deliver_deadline_at: null,
  deliver_deadline_at_local: null,
  required_before_dispatch: true,
};
const publication = {
  repository: "https://github.com/fengyangxxx/redsync-sourcey-docs",
  destination_ref: "refs/heads/fix/frantic33-governed-receipt-v11",
  expected_pre_push_state: "branch_absent",
  workflow: ".github/workflows/validate-sourcey-adoption.yml",
  dispatch_ref: "fix/frantic33-governed-receipt-v11",
};
const preparationEvidencePath = "evidence/evidence.draft.json";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function resolveRepoPath(path, repositoryRoot = repoRoot) {
  assert.equal(isAbsolute(path), false, `artifact path must be repository-relative: ${path}`);
  const resolved = resolve(repositoryRoot, path);
  const rel = relative(repositoryRoot, resolved);
  assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel), `artifact path escapes repository: ${path}`);
  return resolved;
}

export function assertExactGovernedInputs(inputs) {
  const expected = {
    public_url: exact.publicUrl,
    docs_repo_url: exact.docsRepoUrl,
    docs_commit: exact.docsCommit,
    target_repo_url: exact.targetRepoUrl,
    target_commit: exact.targetCommit,
    upstream_pr_url: exact.prUrl,
    upstream_pr_head_commit: exact.prHead,
    mappings_url: exact.mappingsUrl,
    claimant_github_login: "fengyangxxx",
  };
  for (const [field, value] of Object.entries(expected)) {
    assert.equal(inputs?.[field], value, field);
  }
  return inputs;
}

export function assertExactMachineEvidence(evidence) {
  assert.equal(evidence.schema_version, "redsync.sourcey.governed_validation.v1");
  assert.equal(evidence.status, "PASS");
  assert.equal(evidence.live_pass, true);
  assert.equal(evidence.validation_mode, "live");
  assertExactGovernedInputs(evidence.inputs);
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

export async function loadPreparationEvidence() {
  const bytes = await readFile(resolveRepoPath(preparationEvidencePath));
  const draft = JSON.parse(bytes.toString("utf8"));
  assert.equal(draft.target.commit, exact.targetCommit);
  assert.equal(draft.target.license, "BSD-3-Clause");
  assert.equal(draft.provenance_roles.docs_commit, exact.docsCommit);
  assert.equal(draft.provenance_roles.workflow_candidate_ref, publication.destination_ref);
  return {
    kind: "preparation",
    bytes,
    evidence: {
      observations: draft.observations,
      evidence_items: draft.evidence_items,
      project_facts: {
        repository: draft.target.repository,
        commit: draft.target.commit,
        license: draft.target.license,
        sourcey_adapter: draft.sourcey.adapter,
        sourcey_command: draft.sourcey.command,
        package_count: draft.generated_docs.source_package_count,
        non_test_go_file_count: draft.generated_docs.non_test_go_file_count,
        exported_symbol_count: draft.generated_docs.exported_symbol_count,
        generated_page_list: draft.generated_docs.html_page_list,
        public_host: draft.public_host,
      },
    },
  };
}

export async function loadVerifiedProof(proofPath, options = {}) {
  const repositoryRoot = options.repositoryRoot ?? repoRoot;
  const expectedHostedRun = options.expectedHostedRun ?? await expectedHostedRunIdentity(repositoryRoot);
  const proofBytes = await readFile(resolve(proofPath));
  const proof = JSON.parse(proofBytes.toString("utf8"));
  if (
    proof.schema_version !== "redsync.sourcey.governed-receipt-proof.v1" ||
    proof.status !== "PASS" ||
    proof.issuer_scope !== "github_actions_hosted_workflow" ||
    proof.final_delivery_authorization !== false ||
    proof.validation?.status !== "PASS" ||
    proof.validation?.live_pass !== true ||
    proof.validation?.mode !== "live" ||
    proof.runx?.status !== "sealed" ||
    proof.runx?.exit_code !== 0 ||
    proof.runx?.version_output !== exact.runxVersion ||
    proof.verification?.exit_code !== 0 ||
    proof.verification?.valid !== true ||
    proof.verification?.mode !== "receipt_directory" ||
    JSON.stringify(proof.verification?.command) !== JSON.stringify([
      "runx-cli@0.7.1", "verify", "--receipt-dir", "<reconstructed-receipt-dir>", "-j",
    ]) ||
    proof.verification?.replay_exit_code !== 0 ||
    !/^[0-9a-f]{64}$/.test(proof.verification?.replay_verdict_sha256 ?? "") ||
    proof.receipt_tree?.status !== "PASS" ||
    proof.receipt_tree?.failed_json_count !== 0 ||
    proof.archive?.status !== "PASS" ||
    proof.archive?.reconstruction_mismatch_count !== 0 ||
    !/^sha256:[0-9a-f]{64}$/.test(proof.receipt_ref ?? "")
  ) {
    throw new Error("receipt proof is not genuinely verified");
  }
  assertExactGovernedInputs(proof.inputs);
  assert.equal(proof.validation.evidence_path, "deliveries/shared-receipt/evidence.json");
  assert.equal(proof.validation.transcript_path, "deliveries/shared-receipt/transcript.txt");
  assert.equal(proof.runx.raw_path, "deliveries/shared-receipt/runx-raw-stdout.json");
  assert.equal(proof.extraction.path, "deliveries/shared-receipt/artifact-extraction.json");
  assert.equal(proof.hosted_run.path, "deliveries/shared-receipt/hosted-run-provenance.json");
  assert.equal(proof.receipt_tree.path, "deliveries/shared-receipt/receipt-tree.json");
  assert.equal(proof.archive.path, "deliveries/shared-receipt/runx-receipts.archive.json");
  assert.equal(proof.verification.output_path, "deliveries/shared-receipt/runx-verify.json");
  assert.equal(proof.verification.public_key_path, "deliveries/shared-receipt/verification-public-key.json");

  const hostedBytes = await readFile(resolveRepoPath(proof.hosted_run.path, repositoryRoot));
  assert.equal(sha256(hostedBytes), proof.hosted_run.sha256);
  const hostedRun = JSON.parse(hostedBytes.toString("utf8"));
  const hostedObservation = await observeHostedRunProvenance(hostedRun, expectedHostedRun, {
    phase: "final",
    fetchImpl: options.hostedFetch,
  });
  assert.deepEqual({
    repository: proof.hosted_run.repository,
    workflow_path: proof.hosted_run.workflow_path,
    workflow_sha256: proof.hosted_run.workflow_sha256,
    head_commit: proof.hosted_run.head_commit,
    head_tree: proof.hosted_run.head_tree,
    ref: proof.hosted_run.ref,
    event: proof.hosted_run.event,
    run_id: proof.hosted_run.run_id,
    run_attempt: proof.hosted_run.run_attempt,
    run_url: proof.hosted_run.run_url,
  }, {
    repository: hostedRun.repository,
    workflow_path: hostedRun.workflow.path,
    workflow_sha256: hostedRun.workflow.sha256,
    head_commit: hostedRun.head.commit,
    head_tree: hostedRun.head.tree,
    ref: hostedRun.ref,
    event: hostedRun.event,
    run_id: hostedRun.run.id,
    run_attempt: hostedRun.run.attempt,
    run_url: hostedRun.run.url,
  });
  assert.deepEqual(proof.hosted_run.proof_observation, {
    api_url: hostedRun.api_readback.url,
    api_status: "in_progress",
    api_conclusion: null,
    public_run_url: hostedRun.public_run_page.url,
    public_run_http_status: 200,
  });

  const evidenceBytes = await readFile(resolveRepoPath(proof.validation.evidence_path, repositoryRoot));
  const evidence = JSON.parse(evidenceBytes.toString("utf8"));
  assert.equal(sha256(evidenceBytes), proof.validation.evidence_sha256);
  assertExactMachineEvidence(evidence);

  const transcriptBytes = await readFile(resolveRepoPath(proof.validation.transcript_path, repositoryRoot));
  assert.equal(sha256(transcriptBytes), proof.validation.transcript_sha256);
  const rawBytes = await readFile(resolveRepoPath(proof.runx.raw_path, repositoryRoot));
  const raw = JSON.parse(rawBytes.toString("utf8"));
  assert.equal(sha256(rawBytes), proof.runx.raw_sha256);
  assert.equal(raw.status, "sealed");
  assert.equal(raw.receipt_id, proof.receipt_ref);
  assert.equal(raw.execution?.exit_code, 0);

  const extractionBytes = await readFile(resolveRepoPath(proof.extraction.path, repositoryRoot));
  assert.equal(sha256(extractionBytes), proof.extraction.sha256);
  const extraction = JSON.parse(extractionBytes.toString("utf8"));
  assertExtractionBinding({
    extraction,
    raw,
    rawBytes,
    evidence: evidenceBytes,
    transcript: transcriptBytes,
  });
  assert.deepEqual({
    status: proof.extraction.status,
    receipt_id: proof.extraction.receipt_id,
    raw_run_sha256: proof.extraction.raw_run_sha256,
    runner_stdout_sha256: proof.extraction.runner_stdout_sha256,
    evidence_sha256: proof.extraction.evidence_sha256,
    transcript_sha256: proof.extraction.transcript_sha256,
  }, extraction);

  const tree = JSON.parse(await readFile(resolveRepoPath(proof.receipt_tree.path, repositoryRoot), "utf8"));
  assert.equal(tree.tree_sha256, proof.receipt_tree.tree_sha256);
  assert.equal(tree.root_receipt_id, proof.receipt_ref);
  assert.equal(tree.receipt_status_audit.overall_status, "PASS");
  assert.equal(tree.receipt_status_audit.failed_json_count, 0);
  const archiveBytes = await readFile(resolveRepoPath(proof.archive.path, repositoryRoot));
  assert.equal(sha256(archiveBytes), proof.archive.sha256);
  const reconstructed = reconstructReceiptTreeArchive({ archiveBytes, receiptTree: tree });
  assert.equal(reconstructed.result.status, "PASS");
  assert.equal(reconstructed.result.reconstructed_file_count, proof.archive.reconstructed_file_count);
  assert.equal(reconstructed.result.root_receipt_id, proof.receipt_ref);

  const key = JSON.parse(await readFile(resolveRepoPath(proof.verification.public_key_path, repositoryRoot), "utf8"));
  assert.equal(key.algorithm, "Ed25519");
  assert.equal(key.issuer_type, "ci");
  const rootReference = JSON.parse(
    await readFile(resolveRepoPath("deliveries/shared-receipt/root-receipt-ref.json", repositoryRoot), "utf8"),
  );
  assert.equal(rootReference.root_receipt_ref, proof.receipt_ref);
  const recordedVerifyBytes = await readFile(resolveRepoPath(proof.verification.output_path, repositoryRoot));
  assert.equal(sha256(recordedVerifyBytes), proof.verification.output_sha256);
  const recordedVerify = parseRunxVerifyBytes(recordedVerifyBytes, proof.receipt_ref);
  const freshVerify = await withReconstructedReceiptDirectory({
    archiveBytes,
    receiptTree: tree,
    workspaceRoot: repositoryRoot,
  }, async (receiptDir) => runxVerifyReceiptDirectory({ receiptDir, key, cwd: repositoryRoot }));
  if (freshVerify.exitCode !== 0) {
    throw new Error(`receipt proof cryptographic verification failed: ${freshVerify.stderr.toString("utf8").trim()}`);
  }
  const freshVerdict = parseRunxVerifyBytes(freshVerify.stdout, proof.receipt_ref);
  assertEquivalentReceiptDirectoryVerdicts(recordedVerify, freshVerdict, proof.receipt_ref);
  assert.equal(
    sha256(Buffer.from(JSON.stringify(receiptDirectoryVerdictIdentity(freshVerdict)))),
    proof.verification.replay_verdict_sha256,
  );
  return { proof, proofBytes, evidence, hostedObservation };
}

export function buildCiWorkflowInputs() {
  return {
    schema_version: "frantic.sourcey.linux-ci-inputs.v1",
    status: "BLOCKED_UNTIL_DISPATCHED_AND_VERIFIED",
    workflow: ".github/workflows/validate-sourcey-adoption.yml",
    publication,
    claim_context: claimContext,
    runx_version_output: exact.runxVersion,
    receipt_issuer_type: "ci",
    final_delivery_authorization: false,
    inputs: {
      public_url: exact.publicUrl,
      docs_repo_url: exact.docsRepoUrl,
      docs_commit: exact.docsCommit,
      target_repo_url: exact.targetRepoUrl,
      target_commit: exact.targetCommit,
      upstream_pr_url: exact.prUrl,
      upstream_pr_head_commit: exact.prHead,
      mappings_url: exact.mappingsUrl,
      claimant_github_login: "fengyangxxx",
    },
    required_outputs: [
      "evidence.json",
      "transcript.txt",
      "artifact-extraction.json",
      "hosted-run-provenance.json",
      "runx-raw-stdout.json",
      "root-receipt.json",
      "root-receipt-ref.json",
      "receipt-tree.json",
      "receipt-status-audit.json",
      "runx-receipts.archive.json",
      "receipt-archive-reconstruction.json",
      "runx-verify.json",
    ],
    final_materialization_command: "node scripts/materialize-deliveries.mjs --validation-evidence <governed-artifact>/evidence.json --receipt-proof deliveries/shared-receipt/receipt-proof.json",
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
    preparation_state: resolved
      ? "governed_receipt_resolved_pending_final_qa"
      : "preclaim_pending_fresh_claim_and_governed_receipt",
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

This claim-neutral preparation package documents claimant-authored project-named community documentation. The ReadTheDocs site is not target-owned or official. PR 245 is open and unmerged; it is not adoption, endorsement, or maintainer acceptance.

No live claim, deadline, work status, or slot availability is asserted by these static bytes. A fresh board snapshot and exact future claim/deadline capture are required before governed dispatch. ${resolved ? "The governed receipt is resolved; final delivery authorization remains false pending independent Dirac QA." : "Final delivery authorization remains false pending governed receipt and independent Dirac QA."}

## Verified Scope

- Redsync is pinned at \`${exact.targetCommit}\` under BSD-3-Clause.
- Sourcey 3.6.3 uses the \`godoc\` adapter and the exact command \`sourcey godoc --module ./source/redsync --packages ./... --out godoc.json\`.
- The snapshot covers 15 packages, 19 non-test Go files, and 110 exported symbols.
- The governed run requires D's public ReadTheDocs narratives and five generated-page/source mappings to match the immutable D bytes anonymously before it can pass.
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
- Docs publication commit: \`${exact.docsCommit}\`; it must be on public main with exact Read the Docs metadata and anonymous byte-identical readback before workflow dispatch.
- Workflow candidate role: workflow/receipt tooling only; it is never itself a Read the Docs deployment input.
- Optional proposal: ${exact.prUrl}
- Reviewed publication destination: ${publication.repository} at \`${publication.destination_ref}\`; expected pre-push state is branch absent.
- Governed workflow: \`${publication.workflow}\`, dispatch ref \`${publication.dispatch_ref}\`.
- Final delivery authorization: \`false\`.
- Exact claim identity and deadline remain in the local workflow handoff rather than this public report; final QA, guarded submission, and delivery authorization remain pending.
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
    preparation_state: resolved
      ? "governed_receipt_resolved_pending_final_qa"
      : "preclaim_pending_fresh_claim_and_governed_receipt",
    platform_live_state: platformLiveState,
    outbound_publication_plan: {
      ...publication,
      final_delivery_authorization: false,
    },
    provenance_roles: {
      docs_commit: exact.docsCommit,
      docs_deployment_status: resolved
        ? "deployed_and_live_validated"
        : "required_before_workflow_dispatch",
      workflow_candidate_ref: publication.destination_ref,
      workflow_candidate_role: "workflow/receipt tooling only",
      workflow_candidate_requires_readthedocs_deployment: false,
    },
    summary: resolved
      ? "Claimant-authored ReadTheDocs community publication for pinned Redsync was validated with Sourcey and runx-cli 0.7.1 across complete package coverage; the governed receipt is resolved while the honest non-official, non-adopted boundary and independent final-QA gate remain explicit."
      : "Claimant-authored ReadTheDocs community publication for pinned Redsync is prepared for Sourcey and runx-cli 0.7.1 validation across complete package coverage while preserving the honest non-official and non-adopted boundary; Linux CI receipt sealing remains explicit.",
    observations: machineEvidence.observations,
    evidence_items: [
      ...machineEvidence.evidence_items,
      {
        type: context.validation.kind === "preparation" ? "preparation_evidence" : "live_machine_validation",
        local_ref: context.validation.kind === "preparation"
          ? preparationEvidencePath
          : "<governed-artifact>/evidence.json",
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
    validation_evidence: {
      status: context.validation.kind === "preparation" ? "unresolved" : "verified",
      path: context.validation.kind === "preparation"
        ? preparationEvidencePath
        : "<governed-artifact>/evidence.json",
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

export async function materialize({
  validationEvidencePath,
  proofPath,
  outputRoot,
  repositoryRoot = repoRoot,
  expectedHostedRun,
  hostedFetch,
}) {
  if (proofPath && !validationEvidencePath) {
    throw new Error("receipt proof requires exact governed validation evidence");
  }
  const validation = validationEvidencePath
    ? { ...(await loadValidationEvidence(validationEvidencePath)), kind: "live" }
    : await loadPreparationEvidence();
  const verified = proofPath
    ? await loadVerifiedProof(proofPath, { repositoryRoot, expectedHostedRun, hostedFetch })
    : null;
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
  const validationEvidencePath = flags["--validation-evidence"];
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
