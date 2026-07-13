import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../", import.meta.url);
const skillRoot = new URL(
  "../validation-skill/redsync-sourcey-validation/",
  import.meta.url,
);
const runnerPath = new URL("scripts/run.mjs", skillRoot);
const receiptExtractorPath = new URL("scripts/extract-root-receipt.mjs", skillRoot);
const targetCommit = "79f6ba24a8bf41f35141de700d410a06bb27622f";
const docsCommit = "d".repeat(40);
const prHeadCommit = "e".repeat(40);
const publicUrl = "https://redsync-sourcey-docs.readthedocs.io/";
const docsRepoUrl = "https://github.com/fengyangxxx/redsync-sourcey-docs";
const targetRepoUrl = "https://github.com/go-redsync/redsync";
const prUrl = "https://github.com/go-redsync/redsync/pull/999";
const mappingsUrl =
  `https://raw.githubusercontent.com/fengyangxxx/redsync-sourcey-docs/${docsCommit}/evidence/page-source-mappings.json`;
const fixtureUnresolvedPublicUrl = ["PLACE", "HOLDER_PUBLIC_URL"].join("");

async function text(url) {
  return readFile(url, "utf8");
}

async function fixtureMappings() {
  const mappings = JSON.parse(
    await text(new URL("evidence/page-source-mappings.json", root)),
  );
  return mappings.map((mapping) => ({
    ...mapping,
    generated_page_sha256: createHash("sha256")
      .update(
        sourceyHtml(
          `${mapping.rendered_symbol} github.com/go-redsync/redsync/v4 ${mapping.source_path}`,
        ),
      )
      .digest("hex"),
  }));
}

function sourceyHtml(content) {
  return `<!doctype html><html><head><meta name="generator" content="Sourcey 3.6.3"><title>Redsync Sourcey API Documentation</title></head><body>${content}</body></html>`;
}

async function fixtureResponse(logicalUrl, { broken = false } = {}) {
  const mappings = await fixtureMappings();
  const targetApi =
    `https://api.github.com/repos/go-redsync/redsync/commits/${targetCommit}`;
  const docsApi =
    `https://api.github.com/repos/fengyangxxx/redsync-sourcey-docs/commits/${docsCommit}`;
  const prApi = "https://api.github.com/repos/go-redsync/redsync/pulls/999";
  const rawBase =
    `https://raw.githubusercontent.com/fengyangxxx/redsync-sourcey-docs/${docsCommit}/`;

  if (logicalUrl === targetApi) return { body: JSON.stringify({ sha: targetCommit }) };
  if (logicalUrl === docsApi) return { body: JSON.stringify({ sha: docsCommit }) };
  if (logicalUrl === prApi) {
    return {
      body: JSON.stringify({
        html_url: prUrl,
        state: "open",
        base: { ref: "master" },
        head: { sha: prHeadCommit },
        body: broken
          ? `Published docs: ${publicUrl}`
          : `Published Sourcey generated API documentation: ${publicUrl}\nRedsync maintainers can adopt ownership and receive a project transfer.`,
      }),
    };
  }

  if (logicalUrl === mappingsUrl) return { body: JSON.stringify(mappings) };
  if (logicalUrl === `${rawBase}sourcey.config.ts`) {
    return { body: `${targetRepoUrl}\n${targetCommit}\nSourcey 3.6.3 godoc` };
  }
  if (logicalUrl === `${rawBase}godoc.json`) {
    return {
      body: JSON.stringify({
        schema_version: 1,
        module_path: "github.com/go-redsync/redsync/v4",
        packages: Array.from({ length: 15 }, (_, index) => ({ name: `p${index}` })),
      }),
    };
  }
  if (logicalUrl === `${rawBase}dist/index.html`) {
    return {
      body: sourceyHtml(
        `Redsync github.com/go-redsync/redsync/v4 ${targetCommit} ${broken ? fixtureUnresolvedPublicUrl : ""}`,
      ),
    };
  }
  if (logicalUrl === `${rawBase}evidence/page-source-mappings.json`) {
    return { body: JSON.stringify(mappings) };
  }

  if (
    logicalUrl === publicUrl ||
    logicalUrl === new URL("introduction.html", publicUrl).href ||
    logicalUrl === new URL("go-api.html", publicUrl).href
  ) {
    return { body: sourceyHtml("Redsync github.com/go-redsync/redsync/v4") };
  }

  for (const mapping of mappings) {
    if (logicalUrl === new URL(mapping.generated_page, publicUrl).href) {
      return {
        body: sourceyHtml(
          `${mapping.rendered_symbol} github.com/go-redsync/redsync/v4 ${mapping.source_path}`,
        ),
      };
    }
    if (logicalUrl === mapping.source_url) {
      return { body: `<html><body>${mapping.source_path} ${targetCommit}</body></html>` };
    }
    const rawSource =
      `https://raw.githubusercontent.com/go-redsync/redsync/${targetCommit}/${mapping.source_path}`;
    if (logicalUrl === rawSource) {
      const source = await text(new URL(`source/redsync/${mapping.source_path}`, root));
      return { body: source };
    }
  }

  return { status: 404, body: `fixture has no response for ${logicalUrl}` };
}

async function startProxy(options) {
  const server = createServer(async (request, response) => {
    try {
      const incoming = new URL(request.url, "http://127.0.0.1");
      const logicalUrl = incoming.searchParams.get("url") ?? "";
      const fixture = await fixtureResponse(logicalUrl, options);
      response.writeHead(fixture.status ?? 200, {
        "content-type": logicalUrl.includes("api.github.com")
          ? "application/json"
          : "text/plain; charset=utf-8",
      });
      response.end(fixture.body);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    proxyUrl: `http://127.0.0.1:${address.port}/proxy`,
  };
}

async function runFixture(options = {}) {
  const { server, proxyUrl } = await startProxy(options);
  const outputDir = await mkdtemp(join(tmpdir(), "redsync-validation-"));
  try {
    const child = spawn(process.execPath, [fileURLToPath(runnerPath)], {
      cwd: fileURLToPath(skillRoot),
      env: {
        ...process.env,
        RUNX_INPUT_PUBLIC_URL: publicUrl,
        RUNX_INPUT_DOCS_REPO_URL: docsRepoUrl,
        RUNX_INPUT_DOCS_COMMIT: docsCommit,
        RUNX_INPUT_TARGET_REPO_URL: targetRepoUrl,
        RUNX_INPUT_TARGET_COMMIT: targetCommit,
        RUNX_INPUT_UPSTREAM_PR_URL: prUrl,
        RUNX_INPUT_UPSTREAM_PR_HEAD_COMMIT: prHeadCommit,
        RUNX_INPUT_MAPPINGS_URL: mappingsUrl,
        RUNX_INPUT_OUTPUT_DIR: outputDir,
        RUNX_INPUT_VALIDATION_MODE: "fixture",
        RUNX_INPUT_FIXTURE_PROXY_URL: proxyUrl,
        REDSYNC_VALIDATION_FIXTURE_CLI_VERSION: "runx-cli 0.6.14",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const exitCode = await new Promise((resolve) => child.on("close", resolve));
    return { exitCode, stdout, stderr, outputDir };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runProcess(executable, args, options = {}) {
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  return { exitCode, stdout, stderr };
}

async function runReceiptExtractor({ duplicateRoot = false, omitRoot = false, invalidRaw = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "redsync-root-receipt-"));
  const receiptDir = join(directory, "receipts");
  const outputDir = join(directory, "output");
  await mkdir(join(receiptDir, "children"), { recursive: true });

  const rootId = `sha256:${"a".repeat(64)}`;
  const childId = `sha256:${"b".repeat(64)}`;
  const rootReceipt = { schema: "runx.receipt.v1", id: rootId, lineage: { children: [childId] } };
  const childReceipt = { schema: "runx.receipt.v1", id: childId, lineage: { children: [] } };
  const rootBytes = `${JSON.stringify(rootReceipt)}\n`;
  const runJson = {
    schema: "runx.skill_run.v1",
    status: "sealed",
    receipt_id: rootId,
    receipt: rootReceipt,
  };

  await writeFile(
    join(directory, "run.json"),
    invalidRaw ? "not-json\n" : `${JSON.stringify(runJson)}\n`,
  );
  await writeFile(join(receiptDir, "index.json"), `${JSON.stringify({ entries: [] })}\n`);
  await writeFile(join(receiptDir, "children", "child.json"), `${JSON.stringify(childReceipt)}\n`);
  if (!omitRoot) await writeFile(join(receiptDir, "root.json"), rootBytes);
  if (duplicateRoot) await writeFile(join(receiptDir, "duplicate-root.json"), rootBytes);

  const result = await runProcess(process.execPath, [
    fileURLToPath(receiptExtractorPath),
    "--run-json", join(directory, "run.json"),
    "--receipt-dir", receiptDir,
    "--output-dir", outputDir,
  ]);
  return { ...result, directory, outputDir, rootId, rootBytes };
}

async function runGovernedFixture(outputDir) {
  const { server, proxyUrl } = await startProxy({});
  const stateDir = join(outputDir, "runx-state");
  const executable = "npx";
  const fixtureSigningSeed = randomBytes(32).toString("base64");
  const args = [
    "-y",
    "@runxhq/cli@0.6.14",
    "skill",
    ".\\validation-skill\\redsync-sourcey-validation",
    "default",
    "-i", `public_url=${publicUrl}`,
    "-i", `docs_repo_url=${docsRepoUrl}`,
    "-i", `docs_commit=${docsCommit}`,
    "-i", `target_repo_url=${targetRepoUrl}`,
    "-i", `target_commit=${targetCommit}`,
    "-i", `upstream_pr_url=${prUrl}`,
    "-i", `upstream_pr_head_commit=${prHeadCommit}`,
    "-i", `mappings_url=${mappingsUrl}`,
    "-i", `output_dir=${join(outputDir, "artifacts")}`,
    "-i", "validation_mode=fixture",
    "-i", `fixture_proxy_url=${proxyUrl}`,
    "-j",
    "-R", stateDir,
  ];
  process.stderr.write(`GOVERNED_COMMAND npx ${args.join(" ")}\n`);
  try {
    const child = spawn(executable, args, {
      cwd: fileURLToPath(root),
      env: {
        ...process.env,
        npm_config_cache: join(tmpdir(), "frantic113-validation-npm-cache"),
        REDSYNC_VALIDATION_FIXTURE_CLI_VERSION: "runx-cli 0.6.14",
        RUNX_RECEIPT_SIGN_KID: "frantic113-public-fixture",
        RUNX_RECEIPT_SIGN_ED25519_SEED_BASE64: fixtureSigningSeed,
        RUNX_RECEIPT_SIGN_ISSUER_TYPE: "hosted",
        RUNX_RECEIPT_DIR: stateDir,
        RUNX_SANDBOX_ALLOW_DECLARED_POLICY_ONLY: "local",
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    const exitCode = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    process.exitCode = exitCode;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv.includes("--governed-run")) {
  const index = process.argv.indexOf("--governed-run");
  const outputDir = process.argv[index + 1] || await mkdtemp(join(tmpdir(), "redsync-governed-"));
  await runGovernedFixture(outputDir);
} else if (process.argv.includes("--serve-fixture")) {
  const { server, proxyUrl } = await startProxy({});
  process.stdout.write(`${proxyUrl}\n`);
  const close = () => server.close(() => process.exit(0));
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  await new Promise(() => {});
} else {
test("validation skill declares the complete governed network contract", async () => {
  const xYaml = await text(new URL("X.yaml", skillRoot));
  const skillMd = await text(new URL("SKILL.md", skillRoot));
  const runner = await text(runnerPath);

  for (const input of [
    "public_url",
    "docs_repo_url",
    "docs_commit",
    "target_repo_url",
    "target_commit",
    "upstream_pr_url",
    "upstream_pr_head_commit",
    "mappings_url",
  ]) {
    assert.match(xYaml, new RegExp(`\\n      ${input}:`), input);
  }
  assert.match(xYaml, /command:\s*node/);
  assert.match(xYaml, /scripts\/run\.mjs/);
  assert.match(xYaml, /evidence_json:\s*object/);
  assert.match(xYaml, /transcript:\s*string/);
  assert.match(xYaml, /profile:\s*network/);
  assert.match(xYaml, /cwd_policy:\s*skill-directory/);
  assert.match(skillMd, /name:\s*redsync-sourcey-validation/);
  assert.match(skillMd, /Failures exit nonzero/);
  for (const content of [xYaml, runner]) {
    assert.doesNotMatch(content, /evidence_path|report_path|evidence\.draft\.json|report\.draft\.md/);
  }
});

test("Linux workflow is manual, live-only, pinned, and preserves raw evidence", async () => {
  const workflow = await text(
    new URL(".github/workflows/validate-sourcey-adoption.yml", root),
  );

  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule):/m);
  assert.match(workflow, /runs-on:\s*ubuntu-latest/);
  assert.match(workflow, /npx -y @runxhq\/cli@0\.6\.14 --version/);
  assert.match(workflow, /npx -y @runxhq\/cli@0\.6\.14 skill/);
  assert.match(workflow, /validation_mode=live/);
  assert.doesNotMatch(workflow, /validation_mode=fixture|fixture_proxy_url/);
  assert.match(workflow, /output_dir=artifacts/);
  assert.match(workflow, /SKILL_ARTIFACT_DIR/);
  assert.match(workflow, /RUNX_RECEIPT_SIGN_ISSUER_TYPE=ci/);
  assert.match(workflow, /randomBytes\(32\)/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(workflow, /RUNX_TOKEN|evidence_path|report_path/);
  assert.doesNotMatch(workflow, /find[^\n]*-print[^\n]*-quit/);
  assert.match(workflow, /extract-root-receipt\.mjs/);
  assert.match(workflow, /--receipt "\$VALIDATION_OUTPUT_DIR\/root-receipt\.json"/);
  assert.match(workflow, /artifact_copy_exit/);
  assert.match(workflow, /receipt_resolution_exit/);
  assert.match(workflow, /npx -y @runxhq\/cli@0\.6\.14 verify/);
  assert.match(
    workflow,
    /actions\/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5d/,
  );
  assert.match(
    workflow,
    /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/,
  );
  assert.match(
    workflow,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
  );
  for (const artifact of [
    "runx-raw-stdout.json",
    "runx-raw-stderr.txt",
    "receipts",
    "evidence.json",
    "transcript.txt",
    "root-receipt-id.txt",
    "root-receipt-ref.txt",
    "root-receipt-ref.json",
    "root-receipt.json",
    "receipt-tree.json",
    "runx-verify.json",
  ]) {
    assert.match(workflow, new RegExp(artifact.replace(".", "\\.")), artifact);
  }
  assert.doesNotMatch(workflow, /git\s+(?:push|commit)/);
});

test("fixture mode exercises every check without claiming a live pass", async () => {
  const result = await runFixture();
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);

  assert.equal(output.status, "FIXTURE_PASS");
  assert.equal(output.live_pass, false);
  assert.ok(output.checks.length >= 12, `checks=${output.checks.length}`);
  assert.ok(output.checks.every((item) => item.status === "PASS"));
  assert.ok(output.http_checks.length >= 20, `http=${output.http_checks.length}`);
  assert.ok(output.http_checks.every((item) => item.http_status === 200));
  assert.equal(output.cli_version.output, "runx-cli 0.6.14");

  const evidence = JSON.parse(
    await text(new URL(`file:///${join(result.outputDir, "evidence.json").replaceAll("\\", "/")}`)),
  );
  const transcript = await text(
    new URL(`file:///${join(result.outputDir, "transcript.txt").replaceAll("\\", "/")}`),
  );
  assert.equal(evidence.status, "FIXTURE_PASS");
  assert.equal(evidence.live_pass, false);
  assert.doesNotMatch(
    JSON.stringify(evidence.http_checks),
    /evidence\.draft\.json|report\.draft\.md/,
  );
  const immutableDocs = evidence.checks.find((item) => item.id === "immutable_docs_files");
  assert.deepEqual(
    immutableDocs.observed.files.map((item) => item.path),
    ["sourcey.config.ts", "godoc.json", "dist/index.html", "evidence/page-source-mappings.json"],
  );
  assert.match(transcript, /CLI_VERSION_OUTPUT runx-cli 0\.6\.14/);
  assert.match(transcript, /HTTP_STATUS 200/);
  assert.match(transcript, /CONTENT_SHA256 [0-9a-f]{64}/);
  assert.match(transcript, /PR_STATE open/);
});

test("raw PR or placeholder failures remain BLOCKED and exit nonzero", async () => {
  const result = await runFixture({ broken: true });
  assert.notEqual(result.exitCode, 0);
  const output = JSON.parse(result.stdout);

  assert.equal(output.status, "FIXTURE_BLOCKED");
  assert.equal(output.live_pass, false);
  const blocked = new Set(
    output.checks.filter((item) => item.status === "BLOCKED").map((item) => item.id),
  );
  assert.ok(blocked.has("upstream_pr"));
  assert.ok(blocked.has("no_delivery_placeholders"));
  const transcript = await text(
    new URL(`file:///${join(result.outputDir, "transcript.txt").replaceAll("\\", "/")}`),
  );
  assert.match(transcript, /CHECK upstream_pr BLOCKED/);
  assert.match(transcript, /CHECK no_delivery_placeholders BLOCKED/);
});

test("root receipt extractor binds raw runx JSON to one exact stored root", async () => {
  const result = await runReceiptExtractor();
  assert.equal(result.exitCode, 0, result.stderr);

  const reference = JSON.parse(await readFile(join(result.outputDir, "root-receipt-ref.json"), "utf8"));
  const tree = JSON.parse(await readFile(join(result.outputDir, "receipt-tree.json"), "utf8"));
  const copiedRoot = await readFile(join(result.outputDir, "root-receipt.json"), "utf8");
  assert.equal(reference.root_receipt_id, result.rootId);
  assert.equal(reference.root_receipt_ref, result.rootId);
  assert.equal(copiedRoot, result.rootBytes);
  assert.equal(tree.root_receipt_id, result.rootId);
  assert.equal(tree.file_count, 3);
  assert.match(tree.tree_sha256, /^[0-9a-f]{64}$/);
  assert.ok(tree.files.every((item) => /^[0-9a-f]{64}$/.test(item.sha256)));
  assert.equal(tree.files.filter((item) => item.receipt_id === result.rootId).length, 1);
});

test("root receipt extractor blocks duplicate or absent root receipts", async () => {
  for (const options of [{ duplicateRoot: true }, { omitRoot: true }]) {
    const result = await runReceiptExtractor(options);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /BLOCKED: root receipt match count must be 1/);
    const error = JSON.parse(
      await readFile(join(result.outputDir, "root-receipt-error.json"), "utf8"),
    );
    assert.equal(error.status, "BLOCKED");
    assert.match(error.error, /root receipt match count must be 1/);
  }
});

test("root receipt extractor blocks malformed runx raw JSON", async () => {
  const result = await runReceiptExtractor({ invalidRaw: true });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /BLOCKED: runx raw JSON is invalid/);
  const error = JSON.parse(
    await readFile(join(result.outputDir, "root-receipt-error.json"), "utf8"),
  );
  assert.equal(error.status, "BLOCKED");
  assert.match(error.error, /runx raw JSON is invalid/);
});
}
