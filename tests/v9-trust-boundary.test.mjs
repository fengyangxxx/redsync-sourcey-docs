import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { repoRoot } from "./workspace-temp.mjs";

const docsCommit = "bc5585dae317d2fcbd48b3774ba10a27f2e585d6";
const exactInputs = {
  public_url: "https://redsync-sourcey-docs.readthedocs.io/en/latest/",
  docs_repo_url: "https://github.com/fengyangxxx/redsync-sourcey-docs",
  docs_commit: docsCommit,
  target_repo_url: "https://github.com/go-redsync/redsync",
  target_commit: "79f6ba24a8bf41f35141de700d410a06bb27622f",
  upstream_pr_url: "https://github.com/go-redsync/redsync/pull/245",
  upstream_pr_head_commit: "f13cd302b903ae84fc21d914bbeb631a21bb9521",
  mappings_url: `https://raw.githubusercontent.com/fengyangxxx/redsync-sourcey-docs/${docsCommit}/evidence/page-source-mappings.json`,
  claimant_github_login: "fengyangxxx",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("exact governed inputs reject host, repository, mutable, query, fragment, and swapped substitutions", async () => {
  const { assertExactGovernedInputs } = await import("../scripts/materialize-deliveries.mjs");
  assert.doesNotThrow(() => assertExactGovernedInputs(exactInputs));
  const mutations = [
    ["public_url", "https://example.com/en/latest/"],
    ["docs_repo_url", exactInputs.target_repo_url],
    ["target_repo_url", exactInputs.docs_repo_url],
    ["mappings_url", "https://raw.githubusercontent.com/fengyangxxx/redsync-sourcey-docs/main/evidence/page-source-mappings.json"],
    ["mappings_url", `${exactInputs.mappings_url}?raw=1`],
    ["mappings_url", `${exactInputs.mappings_url}#latest`],
    ["public_url", "http://redsync-sourcey-docs.readthedocs.io/en/latest/"],
  ];
  for (const [field, value] of mutations) {
    assert.throws(
      () => assertExactGovernedInputs({ ...exactInputs, [field]: value }),
      new RegExp(field),
    );
  }
});

test("hosted provenance binds the exact public workflow run identity", async () => {
  const { assertHostedRunProvenance } = await import("../scripts/hosted-run-provenance.mjs");
  const expected = {
    repository: "fengyangxxx/redsync-sourcey-docs",
    workflow_path: ".github/workflows/validate-sourcey-adoption.yml",
    workflow_sha256: "a".repeat(64),
    head_commit: "b".repeat(40),
    head_tree: "c".repeat(40),
    ref: "refs/heads/fix/frantic33-governed-receipt-v11",
    dispatch_ref: "fix/frantic33-governed-receipt-v11",
  };
  const runId = 123456789;
  const runUrl = `https://github.com/${expected.repository}/actions/runs/${runId}`;
  const provenance = {
    schema_version: "redsync.sourcey.github-hosted-run.v1",
    status: "PASS",
    issuer_scope: "github_actions_hosted_workflow",
    repository: expected.repository,
    workflow: { path: expected.workflow_path, sha256: expected.workflow_sha256 },
    head: { commit: expected.head_commit, tree: expected.head_tree },
    ref: expected.ref,
    dispatch_ref: expected.dispatch_ref,
    event: "workflow_dispatch",
    run: { id: runId, attempt: 1, url: runUrl },
    api_readback: {
      url: `https://api.github.com/repos/${expected.repository}/actions/runs/${runId}`,
      http_status: 200,
      authentication: "none",
      repository: expected.repository,
      workflow_path: expected.workflow_path,
      head_commit: expected.head_commit,
      head_branch: expected.dispatch_ref,
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
  assert.doesNotThrow(() => assertHostedRunProvenance(provenance, expected));
  const mutations = [
    ["local capture", (value) => { value.issuer_scope = "local_declared_policy_nonfinal"; }],
    ["unrelated workflow", (value) => { value.workflow.path = ".github/workflows/other.yml"; }],
    ["wrong head", (value) => { value.head.commit = "d".repeat(40); }],
    ["wrong ref", (value) => { value.ref = "refs/heads/main"; }],
    ["wrong run", (value) => { value.run.id += 1; }],
    ["non-public run", (value) => { value.public_run_page.http_status = 404; }],
  ];
  for (const [name, mutate] of mutations) {
    const changed = structuredClone(provenance);
    mutate(changed);
    assert.throws(() => assertHostedRunProvenance(changed, expected), undefined, name);
  }
});

test("extraction record binds raw runner stdout to exact evidence and transcript bytes", async () => {
  const { assertExtractionBinding } = await import("../scripts/extraction-binding.mjs");
  const evidenceObject = { status: "PASS" };
  const evidence = Buffer.from(`${JSON.stringify(evidenceObject, null, 2)}\n`);
  const transcript = Buffer.from("FINAL_STATUS PASS\n");
  const raw = {
    receipt_id: `sha256:${"e".repeat(64)}`,
    execution: { stdout: JSON.stringify({
      evidence_json: evidenceObject,
      transcript: transcript.toString("utf8"),
      artifacts: {
        evidence_json: { path: "artifacts/evidence.json", bytes: evidence.length, sha256: sha256(evidence) },
        transcript: { path: "artifacts/transcript.txt", bytes: transcript.length, sha256: sha256(transcript) },
      },
    }) },
  };
  const rawBytes = Buffer.from(`${JSON.stringify(raw)}\n`);
  const extraction = {
    status: "PASS",
    receipt_id: raw.receipt_id,
    raw_run_sha256: sha256(rawBytes),
    runner_stdout_sha256: sha256(Buffer.from(raw.execution.stdout)),
    evidence_sha256: sha256(evidence),
    transcript_sha256: sha256(transcript),
  };
  assert.doesNotThrow(() => assertExtractionBinding({ extraction, raw, rawBytes, evidence, transcript }));
  assert.throws(() => assertExtractionBinding({ extraction: { ...extraction, transcript_sha256: sha256(evidence) }, raw, rawBytes, evidence, transcript }));
  assert.throws(() => assertExtractionBinding({ extraction: { ...extraction, runner_stdout_sha256: "f".repeat(64) }, raw, rawBytes, evidence, transcript }));
});

test("resolved package state is explicit while final QA authorization remains separate", async () => {
  const { buildTaskFiles } = await import("../scripts/materialize-deliveries.mjs");
  const proofBytes = Buffer.from("verified proof\n");
  const files = buildTaskFiles(33, {
    validation: { kind: "live", bytes: Buffer.from("live evidence\n") },
    verified: {
      evidence: {
        observations: ["one", "two", "three", "four", "five", "six"],
        evidence_items: [{ type: "raw" }],
        project_facts: {
          repository: exactInputs.target_repo_url,
          commit: exactInputs.target_commit,
          license: "BSD-3-Clause",
          sourcey_adapter: "godoc",
          sourcey_command: "sourcey godoc --module ./source/redsync --packages ./... --out godoc.json",
          package_count: 15,
          non_test_go_file_count: 19,
          exported_symbol_count: 110,
          generated_page_list: Array.from({ length: 20 }, (_, index) => `page-${index}.html`),
          public_host: { public_url: exactInputs.public_url, official: false, target_owned: false },
        },
      },
      proof: { receipt_ref: `sha256:${"a".repeat(64)}`, archive: { sha256: "b".repeat(64) } },
      proofBytes,
    },
    ciInputBytes: Buffer.from("ci inputs\n"),
  });
  const evidence = JSON.parse(files.get("evidence.json"));
  const acceptance = JSON.parse(files.get("acceptance.json"));
  const report = files.get("report.md").toString("utf8");
  assert.equal(evidence.preparation_state, "governed_receipt_resolved_pending_final_qa");
  assert.equal(evidence.provenance_roles.docs_deployment_status, "deployed_and_live_validated");
  assert.equal(evidence.governed_receipt.status, "PASS");
  assert.equal(evidence.governed_receipt.final_delivery_authorization, false);
  assert.equal(acceptance.preparation_state, "governed_receipt_resolved_pending_final_qa");
  assert.ok(acceptance.criteria.every((criterion) => criterion.status === "PASS"));
  assert.match(report, /governed receipt is resolved/i);
  assert.doesNotMatch(report, /pending governed receipt/i);
  assert.match(report, /final delivery authorization remains false pending independent Dirac QA/i);
});

test("Redsync source pin is task-neutral and contains no stale Frantic 113 checkout provenance", async () => {
  const bytes = await readFile(join(repoRoot, "source/redsync/.source-pin.json"), "utf8");
  assert.doesNotMatch(bytes, /frantic-113|preflight-frantic-113-redsync/i);
  const pin = JSON.parse(bytes);
  assert.equal(pin.repository, exactInputs.target_repo_url);
  assert.equal(pin.commit, exactInputs.target_commit);
  assert.equal(pin.acquisition.method, "git_checkout_at_immutable_commit");
});

test("workflow emits hosted provenance and extraction records while local capture is non-final", async () => {
  const workflow = await readFile(join(repoRoot, ".github/workflows/validate-sourcey-adoption.yml"), "utf8");
  const proofMaterializer = await readFile(join(repoRoot, "scripts/materialize-receipt-proof.mjs"), "utf8");
  const localCapture = await readFile(join(repoRoot, "scripts/capture-governed-receipt.mjs"), "utf8");
  assert.match(workflow, /capture-hosted-run-provenance\.mjs/);
  assert.match(workflow, /hosted-run-provenance-exit-code\.txt/);
  assert.match(workflow, /artifact-extraction\.json/);
  assert.match(proofMaterializer, /expectedHostedRunIdentity/);
  assert.match(proofMaterializer, /assertExtractionBinding/);
  assert.match(localCapture, /local_declared_policy_nonfinal/);
  assert.match(localCapture, /local-capture-record\.json/);
  assert.doesNotMatch(localCapture, /writeFile\(join\(output, "receipt-proof\.json"/);
});
