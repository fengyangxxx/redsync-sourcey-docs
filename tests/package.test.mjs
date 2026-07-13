import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { repositoryLfBytes } from "../scripts/repository-bytes.mjs";

const root = new URL("../", import.meta.url);
const pin = "79f6ba24a8bf41f35141de700d410a06bb27622f";
const unresolved = (suffix) => ["PLACE", "HOLDER_", suffix].join("");
const unresolvedPattern = new RegExp(["PLACE", "HOLDER_[A-Z0-9_]+"].join(""));
const pinnedRawSourceHashes = new Map([
  ["redsync.go", "763b22db61d2377cc070039ed7f1f9591ce4be765319288891596ffbdc2bf151"],
  ["redis/redis.go", "3426e5543bfdd497221a8cc4d5a9a5ea86c993b2d4816f0e650d38ba696a7c9e"],
  ["redis/goredis/v9/goredis.go", "ed479a6b9eb37cb77a768074e68f2852c680206ec9fb67a9eac777f54b80da3b"],
  ["redis/redigo/redigo.go", "bbcea02ae4dc8c6214e92606973e839f6bf868aa48f020f63350c1f6ea39cc39"],
  ["redis/rueidis/rueidis.go", "be591138e687282ef35cf179026b9f27e9ec9676fdcfa6cb027f1473eae70aec"],
]);
const pinnedGitBlobIds = new Map([
  ["redsync.go", "bfec2c9361f283b8f2fab5db25e7e584a4daab96"],
  ["redis/redis.go", "cbae6772aec654bf09b31e2c5aa88b6019563446"],
  ["redis/goredis/v9/goredis.go", "8a29077d1e9a9075bb373a22bce20c2b44302ef7"],
  ["redis/redigo/redigo.go", "127370be6926c23b242d818a8776562b2f70ba5c"],
  ["redis/rueidis/rueidis.go", "ce9601a298b24a67217bc250aa460fc3825e5cd9"],
]);

async function text(path) {
  return readFile(new URL(path, root), "utf8");
}

async function json(path) {
  return JSON.parse(await text(path));
}

async function collectFiles(directory, base = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(fullPath, base)));
    if (entry.isFile()) files.push(fullPath.slice(base.length + 1).replaceAll("\\", "/"));
  }
  return files.sort();
}

test("build configuration is pinned to Redsync and governed runx 0.6.14", async () => {
  const packageJson = await json("package.json");
  const sourceyConfig = await text("sourcey.config.ts");
  const readTheDocs = await text(".readthedocs.yaml");
  const gitAttributes = await text(".gitattributes");

  assert.equal(packageJson.devDependencies.sourcey, "3.6.3");
  assert.match(packageJson.scripts["verify:runx-version"], /@runxhq\/cli@0\.6\.14 --version/);
  assert.doesNotMatch(JSON.stringify(packageJson), /0\.6\.13/);
  assert.match(sourceyConfig, /go-redsync\/redsync/);
  assert.match(sourceyConfig, new RegExp(pin));
  assert.match(sourceyConfig, /module:\s*"\.\/source\/redsync"/);
  assert.match(sourceyConfig, /ogImage:/);
  assert.match(readTheDocs, /npm ci/);
  assert.match(readTheDocs, /npm run build/);
  assert.match(readTheDocs, /READTHEDOCS_OUTPUT/);
  assert.match(gitAttributes, /^\* text=auto eol=lf$/m);
});

test("site build wrapper supports an isolated output directory", async () => {
  const packageJson = await json("package.json");
  const wrapper = await text("scripts/build-site.mjs");

  assert.equal(packageJson.scripts.build, "node scripts/build-site.mjs");
  assert.match(wrapper, /SOURCEY_BUILD_OUTPUT/);
  assert.match(wrapper, /"build"/);
  assert.match(wrapper, /"--output"/);
});

test("isolated Sourcey rebuild is byte-identical to committed dist", async () => {
  const rootPath = fileURLToPath(root);
  const output = await mkdtemp(join(tmpdir(), "redsync-sourcey-byte-check-"));
  try {
    const result = spawnSync(process.execPath, ["scripts/build-site.mjs"], {
      cwd: rootPath,
      encoding: "utf8",
      env: { ...process.env, SOURCEY_BUILD_OUTPUT: output },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const committedRoot = join(rootPath, "dist");
    const committedFiles = await collectFiles(committedRoot);
    const rebuiltFiles = await collectFiles(output);
    assert.deepEqual(rebuiltFiles, committedFiles);
    assert.equal(rebuiltFiles.length, 29);
    for (const path of rebuiltFiles) {
      const committed = await readFile(join(committedRoot, path));
      const rebuilt = await readFile(join(output, path));
      assert.deepEqual(rebuilt, committed, path);
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("evidence generators support isolated output files", async () => {
  assert.match(await text("scripts/generate-inventory.mjs"), /SOURCEY_INVENTORY_OUTPUT/);
  assert.match(await text("scripts/generate-mappings.mjs"), /SOURCEY_MAPPINGS_OUTPUT/);
  assert.match(await text("scripts/generate-hashes.mjs"), /SOURCEY_HASH_OUTPUT/);
});

test("repository source hashing is independent of checkout line endings", () => {
  const lf = Buffer.from("package example\n\nfunc Exported() {}\n", "utf8");
  const crlf = Buffer.from("package example\r\n\r\nfunc Exported() {}\r\n", "utf8");
  assert.deepEqual(repositoryLfBytes(crlf, "fixture.go"), lf);
  assert.deepEqual(repositoryLfBytes(lf, "fixture.go"), lf);
  assert.throws(
    () => repositoryLfBytes(Buffer.from("package example\rfunc Broken() {}\n"), "fixture.go"),
    /unsupported bare CR/,
  );
});

test("snapshot wrapper uses writable cache and disables VCS stamping", async () => {
  const packageJson = await json("package.json");
  const wrapper = await text("scripts/generate-godoc-snapshot.mjs");

  assert.equal(packageJson.scripts.snapshot, "node scripts/generate-godoc-snapshot.mjs");
  assert.match(wrapper, /GOCACHE/);
  assert.match(wrapper, /tmpdir\(\)/);
  assert.match(wrapper, /GOFLAGS/);
  assert.match(wrapper, /-buildvcs=false/);
  assert.match(wrapper, /SOURCEY_GODOC_OUTPUT/);
});

test("godoc snapshot is the pinned Redsync module with no diagnostics", async () => {
  const snapshot = await json("godoc.json");

  assert.equal(snapshot.schema_version, 1);
  assert.equal(snapshot.module_path, "github.com/go-redsync/redsync/v4");
  assert.equal(snapshot.packages.length, 15);
  assert.equal(snapshot.diagnostics?.length ?? 0, 0);
});

test("source snapshot and inventory prove real package and symbol depth", async () => {
  const pinRecord = await json("source/redsync/.source-pin.json");
  const inventory = await json("evidence/inventory.json");

  assert.equal(pinRecord.repository, "https://github.com/go-redsync/redsync");
  assert.equal(pinRecord.commit, pin);
  assert.equal(inventory.repository, pinRecord.repository);
  assert.equal(inventory.commit, pin);
  assert.ok(inventory.package_count >= 10, `package_count=${inventory.package_count}`);
  assert.ok(inventory.exported_symbol_count >= 20, `exported_symbol_count=${inventory.exported_symbol_count}`);

  const packages = new Set(inventory.packages.map((item) => item.import_path));
  for (const expected of [
    "github.com/go-redsync/redsync/v4",
    "github.com/go-redsync/redsync/v4/redis",
    "github.com/go-redsync/redsync/v4/redis/goredis/v9",
    "github.com/go-redsync/redsync/v4/redis/redigo",
    "github.com/go-redsync/redsync/v4/redis/rueidis",
    "github.com/go-redsync/redsync/v4/redis/valkeygo",
  ]) {
    assert.ok(packages.has(expected), `missing package ${expected}`);
  }
});

test("five generated-page mappings resolve to pinned source and rendered symbols", async () => {
  const mappings = await json("evidence/page-source-mappings.json");
  assert.equal(mappings.length, 5);
  assert.equal(new Set(mappings.map((item) => item.generated_page)).size, 5);

  for (const mapping of mappings) {
    assert.match(mapping.source_url, new RegExp(pin));
    assert.match(mapping.source_url, /#L\d+(?:-L\d+)?$/);
    assert.ok(mapping.source_path.endsWith(".go"));
    assert.ok(mapping.source_line >= 1);

    const source = repositoryLfBytes(
      await readFile(new URL(`source/redsync/${mapping.source_path}`, root)),
      mapping.source_path,
    );
    const sourceLines = source.toString("utf8").split("\n");
    assert.match(sourceLines[mapping.source_line - 1], new RegExp(mapping.source_line_pattern));
    const sourceHash = createHash("sha256").update(source).digest("hex");
    assert.equal(sourceHash, mapping.source_sha256, mapping.source_path);
    assert.equal(sourceHash, pinnedRawSourceHashes.get(mapping.source_path), mapping.source_path);
    const gitBlobId = createHash("sha1")
      .update(Buffer.from(`blob ${source.length}\0`, "utf8"))
      .update(source)
      .digest("hex");
    assert.equal(gitBlobId, mapping.source_git_blob_sha1, mapping.source_path);
    assert.equal(gitBlobId, pinnedGitBlobIds.get(mapping.source_path), mapping.source_path);

    const page = await readFile(new URL(`dist/${mapping.generated_page}`, root));
    assert.match(page.toString("utf8"), new RegExp(mapping.rendered_symbol));
    assert.equal(
      createHash("sha256").update(page).digest("hex"),
      mapping.generated_page_sha256,
      mapping.generated_page,
    );
  }
});

test("mapping generator reproduces the committed canonical mapping bytes", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "redsync-mapping-byte-check-"));
  const output = join(outputDir, "page-source-mappings.json");
  try {
    const result = spawnSync(process.execPath, ["scripts/generate-mappings.mjs"], {
      cwd: fileURLToPath(root),
      encoding: "utf8",
      env: { ...process.env, SOURCEY_MAPPINGS_OUTPUT: output },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(await readFile(output), await readFile(new URL("evidence/page-source-mappings.json", root)));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("static site is navigable and includes maintainer-facing pages", async () => {
  const index = await text("dist/index.html");
  const api = await text("dist/go-api.html");
  const apiRedirect = await text("dist/go-api/index.html");

  for (const href of [
    "introduction.html",
    "reproduce.html",
    "hosting-decision.html",
    "maintainer-gap-analysis.html",
    "upstream-pr-rationale.html",
  ]) {
    assert.ok(index.includes(href) || api.includes(href), `navigation missing ${href}`);
  }
  assert.match(index, /href="go-api\/index\.html"/);
  assert.match(apiRedirect, /\.\.\/go-api\.html/);
});

test("generated maintainer rationale reflects finalized page counts", async () => {
  const page = await text("dist/upstream-pr-rationale.html");

  assert.ok(!page.includes(unresolved("GENERATED_PAGE_COUNT")));
  assert.match(page, /Sourcey-generated pages:\s*<code>21<\/code> total/);
  assert.match(page, /including\s*<code>15<\/code> API package pages/);
});

test("draft evidence and report expose every unresolved external field as a placeholder", async () => {
  const evidence = await json("evidence/evidence.draft.json");
  const report = await text("report.draft.md");

  assert.equal(evidence.claim_id, "817adb29-a5d5-493d-8a1d-9f7cb6911b86");
  assert.equal(evidence.target.commit, pin);
  assert.ok(evidence.observations.includes("runx-cli 0.6.14"));
  assert.equal(evidence.public_url, unresolved("PUBLIC_URL"));
  assert.equal(evidence.upstream_pr.url, unresolved("OPEN_PR_URL"));
  assert.equal(evidence.upstream_pr.state, unresolved("OPEN_PR_STATE"));
  assert.equal(evidence.receipt_ref, unresolved("GOVERNED_RECEIPT_REF"));
  assert.equal(evidence.immutable_refs.evidence_json, unresolved("IMMUTABLE_EVIDENCE_URL"));
  assert.equal(evidence.immutable_refs.report, unresolved("IMMUTABLE_REPORT_URL"));
  assert.match(report, new RegExp(unresolved("PUBLIC_URL")));
  assert.match(report, new RegExp(unresolved("OPEN_PR_URL")));
  assert.match(report, new RegExp(unresolved("GOVERNED_RECEIPT_REF")));
});

test("only explicit draft artifacts contain unresolved final-value tokens", async () => {
  const manifest = await json("evidence/sha256-manifest.json");
  const allowed = new Set(["evidence/evidence.draft.json", "report.draft.md"]);

  for (const item of manifest.files) {
    if (allowed.has(item.path)) continue;
    const content = (await readFile(new URL(item.path, root))).toString("utf8");
    assert.doesNotMatch(content, unresolvedPattern, item.path);
  }
});

test("hash manifest covers local evidence and generated site bytes", async () => {
  const manifest = await json("evidence/sha256-manifest.json");
  assert.ok(manifest.files.length >= 20, `manifest files=${manifest.files.length}`);

  for (const item of manifest.files) {
    const bytes = await readFile(new URL(item.path, root));
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, item.sha256, item.path);
    assert.equal(bytes.length, item.bytes, item.path);
  }
});
