import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { repositoryLfBytes } from "../scripts/repository-bytes.mjs";

const root = new URL("../", import.meta.url);
const pin = "79f6ba24a8bf41f35141de700d410a06bb27622f";
const claimId = "4ec19597-79e9-499b-a932-d91fc0150881";
const claimedAt = "2026-07-16T19:14:58.021Z";
const deliverDeadlineAt = "2026-07-17T00:14:58.021Z";
const candidateParent = "2a572fee31bb273b3c16333c3a869798e8c5227f";
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
    assert.equal(rebuiltFiles.length, 30);
    for (const path of rebuiltFiles) {
      const committed = await readFile(join(committedRoot, path));
      const rebuilt = await readFile(join(output, path));
      assert.deepEqual(rebuilt, committed, path);
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("documented preparation leaves the complete generated surface git-clean", { timeout: 120000 }, async () => {
  const rootPath = fileURLToPath(root);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "redsync-sourcey-full-repro-"));
  const repository = join(temporaryRoot, "repository");
  const excluded = new Set([
    join(rootPath, ".git"),
    join(rootPath, "node_modules"),
  ]);
  const run = (command, args, options = {}) => spawnSync(command, args, {
    cwd: repository,
    encoding: "utf8",
    ...options,
  });
  const expectSuccess = (result, label) => {
    assert.equal(
      result.status,
      0,
      `${label}\n${result.error ?? ""}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  };

  try {
    await cp(rootPath, repository, {
      recursive: true,
      filter: (source) => !excluded.has(source),
    });
    await symlink(
      join(rootPath, "node_modules"),
      join(repository, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );

    expectSuccess(run("git", ["init", "--quiet"]), "git init");
    expectSuccess(run("git", ["config", "user.email", "repro@example.invalid"]), "git config email");
    expectSuccess(run("git", ["config", "user.name", "Sourcey Repro Check"]), "git config name");
    expectSuccess(run("git", ["add", "-A"]), "git add");
    expectSuccess(run("git", ["commit", "--quiet", "-m", "repro baseline"]), "git commit");

    const prepare = process.platform === "win32"
      ? run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run prepare:docs"])
      : run("npm", ["run", "prepare:docs"]);
    expectSuccess(prepare, "npm run prepare:docs");
    const generatedDiff = run("git", [
      "diff",
      "--exit-code",
      "--",
      "godoc.json",
      "evidence/inventory.json",
      "evidence/page-source-mappings.json",
      "evidence/sha256-manifest.json",
      "dist",
    ]);
    expectSuccess(generatedDiff, "generated artifact git diff");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
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
  assert.match(wrapper, /source_commit_committed_at/);
  assert.match(wrapper, /source_commit_committed_at_utc/);
  assert.match(wrapper, /snapshot\.generated_at = normalizedGeneratedAt/);
});

test("godoc snapshot is the pinned Redsync module with no diagnostics", async () => {
  const snapshot = await json("godoc.json");

  assert.equal(snapshot.schema_version, 1);
  assert.equal(snapshot.module_path, "github.com/go-redsync/redsync/v4");
  assert.equal(snapshot.packages.length, 15);
  assert.equal(snapshot.diagnostics?.length ?? 0, 0);
  assert.equal(snapshot.generated_at, "2026-07-02T06:37:50Z");
});

test("source snapshot and inventory prove real package and symbol depth", async () => {
  const pinRecord = await json("source/redsync/.source-pin.json");
  const inventory = await json("evidence/inventory.json");

  assert.equal(pinRecord.repository, "https://github.com/go-redsync/redsync");
  assert.equal(pinRecord.commit, pin);
  assert.equal(pinRecord.source_commit_committed_at, "2026-07-02T12:37:50+06:00");
  assert.equal(pinRecord.godoc_generated_at_policy, "source_commit_committed_at_utc");
  assert.equal(pinRecord.snapshot_prepared_before_current_claim, true);
  assert.equal(pinRecord.preclaim_work_override, "fy_task_specific_override");
  assert.equal(pinRecord.current_publication_claim_id, claimId);
  assert.equal(pinRecord.current_publication_claimed_at, claimedAt);
  assert.ok(!Object.hasOwn(pinRecord, "copied_after_claim"));
  assert.ok(!Object.hasOwn(pinRecord, "claim_id"));
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
    "pinned-source-coverage.html",
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

test("pinned source coverage reports the audited inventory and publication boundary", async () => {
  const coverage = await text("pinned-source-coverage.md");
  const generated = await text("dist/pinned-source-coverage.html");

  for (const value of [pin, "19", "110", "15", "BSD-3-Clause"]) {
    assert.ok(coverage.includes(value), `coverage source missing ${value}`);
    assert.ok(generated.includes(value), `generated coverage missing ${value}`);
  }
  assert.match(coverage, /previous Read the Docs deployment does not prove these bytes/i);
  assert.match(coverage, /must be deployed and checked/i);
});

test("generated maintainer rationale reflects the raw packaged page counts", async () => {
  const page = await text("dist/upstream-pr-rationale.html");

  assert.ok(!page.includes(unresolved("GENERATED_PAGE_COUNT")));
  assert.match(page, /Sourcey-generated HTML pages:\s*<code>23<\/code>/);
  assert.match(page, /including\s*<code>15<\/code> API package pages/);
  assert.match(page, /<code>24<\/code>\s*packaged\s+HTML files/);
});

test("QA candidate evidence and report are complete for every locally controllable field", async () => {
  const evidence = await json("evidence/evidence.draft.json");
  const report = await text("report.draft.md");

  assert.equal(evidence.posting_id, "p-8b91e1ac8c");
  assert.equal(evidence.claim_id, claimId);
  assert.equal(evidence.claim_state, "active");
  assert.equal(evidence.claimed_at, claimedAt);
  assert.equal(evidence.fuse_expires_at, deliverDeadlineAt);
  assert.equal(evidence.deliver_deadline_at, deliverDeadlineAt);
  assert.equal(evidence.candidate_base_commit, candidateParent);
  assert.match(evidence.summary, /claimant-authored ReadTheDocs community publication/i);
  assert.ok(evidence.summary.includes(pin));
  assert.match(evidence.summary, /Sourcey 3\.6\.3/);
  assert.match(evidence.summary, /runx-cli 0\.6\.14 validation/);
  assert.match(evidence.summary, /15 packages, 19 non-test Go files, and 110 exported symbols/);
  assert.match(evidence.summary, /not target-owned or official/);
  assert.match(evidence.summary, /not adoption or endorsement/);
  assert.equal(evidence.target.commit, pin);
  assert.equal(evidence.target.license, "BSD-3-Clause");
  assert.equal(evidence.sourcey.adapter, "godoc");
  assert.equal(
    evidence.sourcey.command,
    "sourcey godoc --module ./source/redsync --packages ./... --out godoc.json",
  );
  assert.ok(evidence.observations.includes("runx-cli 0.6.14"));
  assert.ok(evidence.observations.length >= 6);
  assert.equal(evidence.generated_docs.sourcey_html_page_count, 23);
  assert.equal(evidence.generated_docs.navigation_compatibility_page_count, 1);
  assert.equal(evidence.generated_docs.packaged_html_page_count, 24);
  assert.equal(evidence.generated_docs.html_page_list.length, 24);
  assert.equal(evidence.generated_docs.exported_symbol_count, 110);
  assert.equal(evidence.public_host.target_owned, false);
  assert.equal(evidence.public_host.official, false);
  assert.equal(evidence.upstream_pr.state, "open");
  assert.equal(evidence.upstream_pr.merged, false);
  assert.equal(evidence.upstream_pr.adoption, false);
  assert.equal(evidence.upstream_pr.endorsement, false);
  assert.equal(evidence.workflow.successful_run_id, null);
  assert.equal(evidence.workflow.receipt_ref, null);
  assert.deepEqual(evidence.external_only_pending, [
    "post-claim candidate commit push and exact ReadTheDocs build/deploy provenance",
    "one successful governed workflow run and verified receipt",
    "immutable final evidence/report URLs",
    "Dirac final QA and guarded Frantic delivery",
  ]);
  assert.ok(evidence.evidence_items.length >= 6);
  assert.match(report, /claimant-authored, project-named community documentation/i);
  assert.match(report, /(?:not|never) adoption,\s*endorsement, or maintainer acceptance/i);
  assert.ok((report.match(/^\s*\d+\.\s+\*\*/gm) ?? []).length >= 3);
  assert.ok((report.match(/^\s*-\s+/gm) ?? []).length >= 6);
  for (const forbiddenRun of ["29385064167", "29386361713"]) {
    assert.doesNotMatch(JSON.stringify(evidence), new RegExp(forbiddenRun));
    assert.doesNotMatch(report, new RegExp(forbiddenRun));
  }
});

test("current execution record binds the exact active claim and public parent", async () => {
  const handoff = await text("evidence/hume-handoff.md");
  const commands = await text("evidence/commands.local.txt");
  const readme = await text("README.md");
  const handoffParent = handoff.match(/direct\s+parent is `([0-9a-f]{40})`/i)?.[1];
  const commandsParent = commands.match(/^Candidate parent: ([0-9a-f]{40})$/m)?.[1];
  const git = (...args) => {
    const result = spawnSync("git", args, {
      cwd: fileURLToPath(root),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const head = git("rev-parse", "HEAD");
  const actualParent = head === candidateParent ? head : git("rev-parse", "HEAD^");
  const currentSurfaces = `${handoff}\n${commands}\n${await text("report.draft.md")}\n${await text("evidence/evidence.draft.json")}`;
  const staleClaimState = /claim_id"\s*:\s*null|claim_state"\s*:\s*"unclaimed"|no active claim|Active claim:\s*none|Reclaim #33|successful claim and exact claim\/deadline fields/i;

  assert.match(handoff, /Gauss \(`019f65c3-203f-7990-8feb-3cc1ee98d86c`, xhigh\)/);
  assert.match(handoff, /Dirac \(`019f65c3-29ec-7181-9277-b251442a3250`, xhigh\)/);
  for (const value of [claimId, claimedAt, deliverDeadlineAt]) {
    assert.match(handoff, new RegExp(value.replaceAll(".", "\\.")));
    assert.match(commands, new RegExp(value.replaceAll(".", "\\.")));
  }
  assert.equal(handoffParent, candidateParent);
  assert.equal(commandsParent, candidateParent);
  assert.equal(actualParent, candidateParent);
  assert.match(handoff, /QA_DECISION: PASS/);
  assert.doesNotMatch(currentSurfaces, staleClaimState);
  assert.doesNotMatch(handoff, /Nietzsche|Active claim:|Delivery deadline:|29 passed/i);
  assert.doesNotMatch(readme, /Hume|Nietzsche/i);
});

test("publishable evidence contains no machine-local paths or private email", async () => {
  const paths = [
    "README.md",
    "report.draft.md",
    "evidence/commands.local.txt",
    "evidence/hume-handoff.md",
    "evidence/evidence.draft.json",
    "evidence/local-live-validation/evidence.json",
    "evidence/local-live-validation/manifest.json",
    "evidence/local-live-validation/runner-stderr.txt",
    "evidence/local-live-validation/runner-stdout.json",
    "evidence/local-live-validation/runx-version.txt",
    "evidence/local-live-validation/transcript.txt",
  ];
  const machinePath = /(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\/(?:home|Users|tmp|var\/folders)\/)/;
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  for (const path of paths) {
    const content = await text(path);
    assert.doesNotMatch(content, machinePath, path);
    assert.doesNotMatch(content, email, path);
  }
});

test("no committed candidate artifact contains unresolved final-value tokens", async () => {
  const manifest = await json("evidence/sha256-manifest.json");

  for (const item of manifest.files) {
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
