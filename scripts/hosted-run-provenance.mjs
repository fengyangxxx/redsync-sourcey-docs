import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { boundedGet } from "../validation-skill/redsync-sourcey-validation/scripts/bounded-get.mjs";

const execFileAsync = promisify(execFile);

export const hostedRunConstants = Object.freeze({
  repository: "fengyangxxx/redsync-sourcey-docs",
  workflow_path: ".github/workflows/validate-sourcey-adoption.yml",
  ref: "refs/heads/fix/frantic33-governed-receipt-v11",
  dispatch_ref: "fix/frantic33-governed-receipt-v11",
  event: "workflow_dispatch",
});

function exact(actual, expected, label) {
  assert.equal(actual, expected, label);
}

function assertHostedPhase(value, phase) {
  if (phase === "proof") {
    exact(value.api_readback?.status, "in_progress", "hosted API proof status");
    exact(value.api_readback?.conclusion, null, "hosted API proof conclusion");
    return;
  }
  if (phase === "final") {
    exact(value.api_readback?.status, "completed", "hosted API final status");
    exact(value.api_readback?.conclusion, "success", "hosted API final conclusion");
    return;
  }
  throw new Error(`unsupported hosted observation phase: ${phase}`);
}

export function assertHostedRunProvenance(value, expected, options = {}) {
  const phase = options.phase ?? "proof";
  exact(value?.schema_version, "redsync.sourcey.github-hosted-run.v1", "hosted run schema");
  exact(value?.status, "PASS", "hosted run status");
  exact(value?.issuer_scope, "github_actions_hosted_workflow", "hosted issuer scope");
  exact(value?.repository, expected.repository, "hosted repository");
  exact(value?.workflow?.path, expected.workflow_path, "hosted workflow path");
  exact(value?.workflow?.sha256, expected.workflow_sha256, "hosted workflow hash");
  exact(value?.head?.commit, expected.head_commit, "hosted head commit");
  exact(value?.head?.tree, expected.head_tree, "hosted head tree");
  exact(value?.ref, expected.ref, "hosted ref");
  exact(value?.dispatch_ref, expected.dispatch_ref, "hosted dispatch ref");
  exact(value?.event, "workflow_dispatch", "hosted event");
  assert.ok(Number.isSafeInteger(value?.run?.id) && value.run.id > 0, "hosted run id");
  assert.ok(Number.isSafeInteger(value?.run?.attempt) && value.run.attempt > 0, "hosted run attempt");
  const runUrl = `https://github.com/${expected.repository}/actions/runs/${value.run.id}`;
  const apiUrl = `https://api.github.com/repos/${expected.repository}/actions/runs/${value.run.id}`;
  exact(value.run.url, runUrl, "hosted run URL");
  exact(value.api_readback?.url, apiUrl, "hosted API URL");
  exact(value.api_readback?.http_status, 200, "hosted API status");
  exact(value.api_readback?.authentication, "none", "hosted API authentication");
  exact(value.api_readback?.repository, expected.repository, "hosted API repository");
  exact(value.api_readback?.workflow_path, expected.workflow_path, "hosted API workflow path");
  exact(value.api_readback?.head_commit, expected.head_commit, "hosted API head commit");
  exact(value.api_readback?.head_branch, expected.dispatch_ref, "hosted API head branch");
  exact(value.api_readback?.event, "workflow_dispatch", "hosted API event");
  exact(value.api_readback?.run_id, value.run.id, "hosted API run id");
  exact(value.api_readback?.run_attempt, value.run.attempt, "hosted API run attempt");
  exact(value.api_readback?.run_url, runUrl, "hosted API run URL");
  assertHostedPhase(value, phase);
  exact(value.public_run_page?.url, runUrl, "public run URL");
  exact(value.public_run_page?.final_url, runUrl, "public run final URL");
  exact(value.public_run_page?.http_status, 200, "public run status");
  exact(value.public_run_page?.redirected, false, "public run redirect");
  exact(value.public_run_page?.authentication, "none", "public run authentication");
  return value;
}

function anonymousHeaders() {
  return {
    accept: "application/vnd.github+json",
    "user-agent": "redsync-sourcey-governed-validator",
  };
}

async function fetchExact(url, fetchImpl) {
  return boundedGet(url, {
    fetchImpl,
    headers: anonymousHeaders(),
  });
}

export async function readHostedRunProvenance({ expected, runId, runAttempt, phase, fetchImpl = fetch }) {
  assert.ok(Number.isSafeInteger(runId) && runId > 0, "hosted run id");
  assert.ok(Number.isSafeInteger(runAttempt) && runAttempt > 0, "hosted run attempt");
  const runUrl = `https://github.com/${expected.repository}/actions/runs/${runId}`;
  const apiUrl = `https://api.github.com/repos/${expected.repository}/actions/runs/${runId}`;
  const apiResult = await fetchExact(apiUrl, fetchImpl);
  if (apiResult.http_status !== 200 || apiResult.final_outcome !== "response_ok") {
    throw new Error(`GitHub run API status must be exact anonymous 200 without redirect, observed ${apiResult.http_status ?? "missing"}`);
  }
  let api;
  try {
    api = JSON.parse(apiResult.bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`GitHub run API body is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const pageResult = await fetchExact(runUrl, fetchImpl);
  if (pageResult.http_status !== 200 || pageResult.final_outcome !== "response_ok") {
    throw new Error(`GitHub public run page status must be exact anonymous 200 without redirect, observed ${pageResult.http_status ?? "missing"}`);
  }
  const value = {
    schema_version: "redsync.sourcey.github-hosted-run.v1",
    status: "PASS",
    issuer_scope: "github_actions_hosted_workflow",
    repository: expected.repository,
    workflow: { path: expected.workflow_path, sha256: expected.workflow_sha256 },
    head: { commit: expected.head_commit, tree: expected.head_tree },
    ref: expected.ref,
    dispatch_ref: expected.dispatch_ref,
    event: "workflow_dispatch",
    run: { id: runId, attempt: runAttempt, url: runUrl },
    api_readback: {
      url: apiUrl,
      http_status: apiResult.http_status,
      authentication: "none",
      repository: api.repository?.full_name,
      workflow_path: api.path,
      head_commit: api.head_sha,
      head_branch: api.head_branch,
      event: api.event,
      run_id: api.id,
      run_attempt: api.run_attempt,
      run_url: api.html_url,
      status: api.status,
      conclusion: api.conclusion,
    },
    public_run_page: {
      url: runUrl,
      final_url: pageResult.response_url,
      http_status: pageResult.http_status,
      redirected: pageResult.redirected,
      authentication: "none",
    },
  };
  return assertHostedRunProvenance(value, expected, { phase });
}

export async function observeHostedRunProvenance(recorded, expected, options = {}) {
  assertHostedRunProvenance(recorded, expected, { phase: "proof" });
  return readHostedRunProvenance({
    expected,
    runId: recorded.run.id,
    runAttempt: recorded.run.attempt,
    phase: options.phase ?? "proof",
    fetchImpl: options.fetchImpl ?? fetch,
  });
}

export async function expectedHostedRunIdentity(repoRoot) {
  const workflowBytes = await readFile(join(repoRoot, hostedRunConstants.workflow_path));
  const [{ stdout: head }, { stdout: tree }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, windowsHide: true }),
    execFileAsync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repoRoot, windowsHide: true }),
  ]);
  return {
    ...hostedRunConstants,
    workflow_sha256: createHash("sha256").update(workflowBytes).digest("hex"),
    head_commit: head.trim(),
    head_tree: tree.trim(),
  };
}
