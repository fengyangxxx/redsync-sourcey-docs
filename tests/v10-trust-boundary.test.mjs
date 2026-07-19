import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import test from "node:test";
import { boundedGet } from "../validation-skill/redsync-sourcey-validation/scripts/bounded-get.mjs";
import { repoRoot } from "./workspace-temp.mjs";

const expected = {
  repository: "fengyangxxx/redsync-sourcey-docs",
  workflow_path: ".github/workflows/validate-sourcey-adoption.yml",
  workflow_sha256: "a".repeat(64),
  head_commit: "b".repeat(40),
  head_tree: "c".repeat(40),
  ref: "refs/heads/fix/frantic33-governed-receipt-v11",
  dispatch_ref: "fix/frantic33-governed-receipt-v11",
};

function hostedRecord({ runId = 123456789, status = "in_progress", conclusion = null } = {}) {
  const runUrl = `https://github.com/${expected.repository}/actions/runs/${runId}`;
  return {
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
      status,
      conclusion,
    },
    public_run_page: {
      url: runUrl,
      final_url: runUrl,
      http_status: 200,
      redirected: false,
      authentication: "none",
    },
  };
}

function fakeResponse({ url, status = 200, body = "", redirected = false }) {
  const bytes = Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return {
    url,
    status,
    ok: status >= 200 && status < 300,
    redirected,
    headers: new Headers({ "content-type": typeof body === "string" ? "text/html" : "application/json" }),
    async arrayBuffer() { return bytes; },
    async json() { return JSON.parse(bytes.toString("utf8")); },
  };
}

function hostedFetch(record, { apiStatus = 200, apiOverrides = {}, pageStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === record.api_readback.url) {
      return fakeResponse({
        url,
        status: apiStatus,
        body: {
          repository: { full_name: record.repository },
          path: record.workflow.path,
          head_sha: record.head.commit,
          head_branch: record.dispatch_ref,
          event: record.event,
          id: record.run.id,
          run_attempt: record.run.attempt,
          html_url: record.run.url,
          status: record.api_readback.status,
          conclusion: record.api_readback.conclusion,
          ...apiOverrides,
        },
      });
    }
    if (url === record.run.url) return fakeResponse({ url, status: pageStatus, body: "public run" });
    throw new Error(`unexpected URL ${url}`);
  };
  return { calls, fetchImpl };
}

test("public docs and immutable mappings reject executable HTTP 302 substitutions", async () => {
  const server = http.createServer((request, response) => {
    if (request.url === "/public-docs" || request.url === "/mappings.json") {
      response.writeHead(302, { location: "/substituted" });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("substituted bytes");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    for (const path of ["/public-docs", "/mappings.json"]) {
      const url = `http://127.0.0.1:${port}${path}`;
      const result = await boundedGet(url, { maxAttempts: 1, backoffMs: [0] });
      assert.equal(result.http_status, 302, path);
      assert.equal(result.final_outcome, "redirect_blocked", path);
      assert.equal(result.requested_url, url, path);
      assert.equal(result.response_url, url, path);
      assert.equal(result.redirected, false, path);
      assert.equal(result.bytes.length, 0, path);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("response URL drift or a redirect flag is blocked even with HTTP 200", async () => {
  const requested = "https://example.invalid/exact";
  for (const response of [
    fakeResponse({ url: "https://example.invalid/substituted", body: "wrong" }),
    fakeResponse({ url: requested, body: "wrong", redirected: true }),
  ]) {
    const result = await boundedGet(requested, {
      maxAttempts: 1,
      fetchImpl: async () => response,
    });
    assert.equal(result.final_outcome, "redirect_blocked");
    assert.equal(result.bytes.length, 0);
  }
});

test("hosted run proof creation anonymously refetches exact in-progress identity", async () => {
  const { observeHostedRunProvenance } = await import("../scripts/hosted-run-provenance.mjs");
  const record = hostedRecord();
  const { calls, fetchImpl } = hostedFetch(record);
  const observed = await observeHostedRunProvenance(record, expected, { phase: "proof", fetchImpl });
  assert.equal(observed.api_readback.status, "in_progress");
  assert.equal(observed.api_readback.conclusion, null);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.redirect, "manual");
    assert.equal(new Headers(call.options.headers).has("authorization"), false);
  }
});

test("final load anonymously refetches the exact completed successful run", async () => {
  const { observeHostedRunProvenance } = await import("../scripts/hosted-run-provenance.mjs");
  const record = hostedRecord();
  const final = hostedRecord({ status: "completed", conclusion: "success" });
  const { fetchImpl } = hostedFetch(final);
  const observed = await observeHostedRunProvenance(record, expected, { phase: "final", fetchImpl });
  assert.equal(observed.api_readback.status, "completed");
  assert.equal(observed.api_readback.conclusion, "success");
});

test("nonexistent and self-authored hosted runs fail independent observation", async () => {
  const { observeHostedRunProvenance } = await import("../scripts/hosted-run-provenance.mjs");
  const invented = hostedRecord({ runId: 99999999999 });
  await assert.rejects(
    observeHostedRunProvenance(invented, expected, {
      phase: "proof",
      fetchImpl: hostedFetch(invented, { apiStatus: 404 }).fetchImpl,
    }),
    /GitHub run API status/,
  );
  await assert.rejects(
    observeHostedRunProvenance(invented, expected, {
      phase: "proof",
      fetchImpl: hostedFetch(invented, { apiOverrides: { id: 123456789 } }).fetchImpl,
    }),
    /hosted API run id/,
  );
});

test("hosted identity derives the exact current W commit and tree without tracked self-reference", async () => {
  const { expectedHostedRunIdentity } = await import("../scripts/hosted-run-provenance.mjs");
  const identity = await expectedHostedRunIdentity(repoRoot);
  assert.equal(identity.head_commit, execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim());
  assert.equal(identity.head_tree, execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repoRoot, encoding: "utf8" }).trim());
  assert.equal(identity.ref, "refs/heads/fix/frantic33-governed-receipt-v11");
  assert.equal(identity.dispatch_ref, "fix/frantic33-governed-receipt-v11");
});
