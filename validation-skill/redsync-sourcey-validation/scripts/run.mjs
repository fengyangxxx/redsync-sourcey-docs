import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { boundedGet } from "./bounded-get.mjs";
import { canonicalizeReadTheDocsPage } from "./rtd-canonicalizer.mjs";

const EXPECTED_TARGET_REPO = "https://github.com/go-redsync/redsync";
const EXPECTED_MODULE = "github.com/go-redsync/redsync/v4";
const MINIMUM_CLI_VERSION = [0, 6, 13];
const EXPECTED_LICENSE = "BSD-3-Clause";
const EXPECTED_SOURCEY_COMMAND =
  "sourcey godoc --module ./source/redsync --packages ./... --out godoc.json";
const UNRESOLVED_FINAL_RE = new RegExp(["PLACE", "HOLDER_[A-Z0-9_]+"].join(""), "g");

function parseRunxVersion(output) {
  const match = /^runx-cli (\d+)\.(\d+)\.(\d+)$/.exec(output);
  if (!match) return null;
  return match.slice(1).map(Number);
}

function isAtLeastVersion(actual, minimum) {
  if (!actual) return false;
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

function input(name, fallback = "") {
  return (process.env[`RUNX_INPUT_${name.toUpperCase()}`] ?? fallback).trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitBlobSha1(value) {
  return createHash("sha1")
    .update(Buffer.from(`blob ${value.length}\0`, "utf8"))
    .update(value)
    .digest("hex");
}

function excerpt(value, limit = 240) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function checkedText(label, body) {
  if (label === "target_commit_api" || label === "docs_commit_api") {
    try {
      const parsed = JSON.parse(body);
      return JSON.stringify({
        sha: parsed.sha ?? null,
        files: Array.isArray(parsed.files)
          ? parsed.files.map((file) => ({ filename: file.filename ?? null }))
          : [],
      });
    } catch {
      return "invalid commit API JSON";
    }
  }
  return excerpt(body);
}

function parseGitHubRepo(value) {
  const url = new URL(value);
  const parts = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || parts.length !== 2) {
    throw new Error(`unsupported GitHub repository URL: ${value}`);
  }
  return { owner: parts[0], repo: parts[1], url: `https://github.com/${parts[0]}/${parts[1]}` };
}

function parsePullRequest(value) {
  const url = new URL(value);
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    parts.length !== 4 ||
    parts[2] !== "pull" ||
    !/^\d+$/.test(parts[3])
  ) {
    throw new Error(`unsupported GitHub pull request URL: ${value}`);
  }
  return { owner: parts[0], repo: parts[1], number: Number(parts[3]) };
}

function rawUrl(repo, commit, path) {
  return `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${commit}/${path}`;
}

function githubApi(repo, suffix) {
  return `https://api.github.com/repos/${repo.owner}/${repo.repo}${suffix}`;
}

function apiPagePath(importPath) {
  if (importPath === EXPECTED_MODULE) return "go-api/package-root.html";
  const relativePath = importPath.slice(`${EXPECTED_MODULE}/`.length);
  return `go-api/pkg-${relativePath.replaceAll("/", "-")}.html`;
}

function resolveOutputDir(value) {
  const fallback = `artifacts/validation-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const selected = value || fallback;
  return isAbsolute(selected) ? selected : resolve(process.cwd(), selected);
}

async function main() {
  const checkedAt = new Date().toISOString();
  const inputs = {
    public_url: input("public_url"),
    docs_repo_url: input("docs_repo_url"),
    docs_commit: input("docs_commit"),
    target_repo_url: input("target_repo_url"),
    target_commit: input("target_commit"),
    upstream_pr_url: input("upstream_pr_url"),
    upstream_pr_head_commit: input("upstream_pr_head_commit"),
    mappings_url: input("mappings_url"),
    runx_version_output: input("runx_version_output"),
    claimant_github_login: input("claimant_github_login"),
    output_dir: input("output_dir"),
    artifact_mode: input("artifact_mode", "files").toLowerCase(),
    validation_mode: input("validation_mode", "live").toLowerCase(),
    fixture_proxy_url: input("fixture_proxy_url"),
  };

  const outputDir = resolveOutputDir(inputs.output_dir);
  const checks = [];
  const httpChecks = [];
  const responseBodies = new Map();
  const placeholderSurfaces = [];
  const transcript = [
    "Redsync Sourcey governed validation transcript",
    `CHECKED_AT ${checkedAt}`,
    `VALIDATION_MODE ${inputs.validation_mode}`,
    `ARTIFACT_MODE ${inputs.artifact_mode}`,
  ];

  function addCheck(id, requirement, passed, observed, refs = []) {
    const item = {
      id,
      requirement,
      status: passed ? "PASS" : "BLOCKED",
      observed,
      refs,
    };
    checks.push(item);
    transcript.push(`CHECK ${id} ${item.status}`);
    transcript.push(`OBSERVED ${JSON.stringify(observed)}`);
    return passed;
  }

  function addPlaceholderSurface(label, url, body) {
    placeholderSurfaces.push({ label, url, body: String(body) });
  }

  async function fetchText(logicalUrl, label) {
    if (responseBodies.has(logicalUrl)) return responseBodies.get(logicalUrl);
    let fetchedUrl = logicalUrl;
    if (inputs.validation_mode === "fixture") {
      const proxy = new URL(inputs.fixture_proxy_url);
      proxy.searchParams.set("url", logicalUrl);
      fetchedUrl = proxy.href;
    }

    const fetched = await boundedGet(fetchedUrl, {
      auditUrl: logicalUrl,
      headers: {
        accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": "redsync-sourcey-validation/0.1.2",
      },
      onAttempt(attemptRecord) {
        transcript.push(
          `HTTP_ATTEMPT ${attemptRecord.attempt} STATUS ${attemptRecord.http_status ?? "ERROR"} ` +
          `RETRYABLE ${attemptRecord.retryable}`,
        );
        transcript.push(`HTTP_ATTEMPT_URL ${logicalUrl}`);
        transcript.push(`HTTP_ATTEMPT_RESULT ${JSON.stringify(attemptRecord)}`);
      },
      onBackoff(backoff) {
        transcript.push(`HTTP_RETRY_BACKOFF_MS ${backoff.backoff_ms}`);
      },
    });
    const rawBytes = fetched.bytes;
    const body = rawBytes.toString("utf8");
    const record = {
      label,
      url: logicalUrl,
      fetched_url: inputs.validation_mode === "fixture" ? fetchedUrl : logicalUrl,
      requested_url: fetched.requested_url,
      response_url: fetched.response_url,
      redirected: fetched.redirected,
      location: fetched.location,
      http_status: fetched.http_status,
      content_sha256: fetched.content_sha256,
      bytes: rawBytes.length,
      content_type: fetched.content_type,
      checked_text: checkedText(label, body),
      error: fetched.error,
      attempts: fetched.attempts,
      attempt_count: fetched.attempt_count,
      max_attempts: fetched.max_attempts,
      retry_exhausted: fetched.retry_exhausted,
      final_outcome: fetched.final_outcome,
    };

    httpChecks.push(record);
    responseBodies.set(logicalUrl, { ...record, body, raw_bytes: rawBytes });
    transcript.push(`HTTP_LABEL ${label}`);
    transcript.push(`HTTP_URL ${logicalUrl}`);
    if (inputs.validation_mode === "fixture") transcript.push(`FETCHED_AS ${fetchedUrl}`);
    transcript.push(`HTTP_STATUS ${record.http_status ?? "ERROR"}`);
    transcript.push(`HTTP_REQUESTED_URL ${record.requested_url}`);
    transcript.push(`HTTP_RESPONSE_URL ${record.response_url ?? "NONE"}`);
    transcript.push(`HTTP_REDIRECTED ${record.redirected}`);
    transcript.push(`HTTP_ATTEMPT_COUNT ${record.attempt_count}`);
    transcript.push(`HTTP_RETRY_EXHAUSTED ${record.retry_exhausted}`);
    transcript.push(`HTTP_FINAL_OUTCOME ${record.final_outcome}`);
    transcript.push(`CONTENT_SHA256 ${record.content_sha256 ?? "NONE"}`);
    transcript.push(`CONTENT_BYTES ${record.bytes}`);
    transcript.push(`CHECKED_TEXT ${JSON.stringify(record.checked_text)}`);
    if (record.error) transcript.push(`HTTP_ERROR ${JSON.stringify(record.error)}`);
    return { ...record, body, raw_bytes: rawBytes };
  }

  const required = [
    "public_url",
    "docs_repo_url",
    "docs_commit",
    "target_repo_url",
    "target_commit",
    "upstream_pr_url",
    "upstream_pr_head_commit",
    "mappings_url",
    "runx_version_output",
  ];
  const inputFailures = required.filter((name) => !inputs[name]).map((name) => `${name} is required`);
  if (!new Set(["live", "fixture"]).has(inputs.validation_mode)) {
    inputFailures.push("validation_mode must be live or fixture");
  }
  if (inputs.validation_mode === "fixture" && !inputs.fixture_proxy_url) {
    inputFailures.push("fixture_proxy_url is required in fixture mode");
  }
  if (!new Set(["files", "stdout-only"]).has(inputs.artifact_mode)) {
    inputFailures.push("artifact_mode must be files or stdout-only");
  }
  if (inputs.target_repo_url && inputs.target_repo_url !== EXPECTED_TARGET_REPO) {
    inputFailures.push(`target_repo_url must be ${EXPECTED_TARGET_REPO}`);
  }
  for (const name of ["docs_commit", "target_commit", "upstream_pr_head_commit"]) {
    if (inputs[name] && !/^[0-9a-f]{40}$/i.test(inputs[name])) inputFailures.push(`${name} must be a full SHA`);
  }
  if (
    inputs.claimant_github_login &&
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(inputs.claimant_github_login)
  ) {
    inputFailures.push("claimant_github_login must be a public GitHub login");
  }
  addCheck(
    "input_contract",
    "All immutable inputs are present and target go-redsync/redsync.",
    inputFailures.length === 0,
    { failures: inputFailures, target_repo_url: inputs.target_repo_url },
  );

  const parsedCliVersion = parseRunxVersion(inputs.runx_version_output);
  const cliVersion = {
    command: parsedCliVersion
      ? `npx -y @runxhq/cli@${parsedCliVersion.join(".")} --version`
      : "npx -y @runxhq/cli@<invalid> --version",
    output: inputs.runx_version_output,
    exit_code: inputs.runx_version_output ? 0 : 1,
    source: "captured_outer_command",
  };
  transcript.push(`CLI_COMMAND ${cliVersion.command}`);
  transcript.push(`CLI_SOURCE ${cliVersion.source}`);
  transcript.push(`CLI_EXIT ${cliVersion.exit_code}`);
  transcript.push(`CLI_VERSION_OUTPUT ${cliVersion.output}`);
  if (cliVersion.stderr) transcript.push(`CLI_STDERR ${JSON.stringify(cliVersion.stderr)}`);
  addCheck(
    "cli_version_exact",
    "Governed CLI output is a literal runx-cli semantic version at or above 0.6.13.",
    cliVersion.exit_code === 0 && isAtLeastVersion(parsedCliVersion, MINIMUM_CLI_VERSION),
    cliVersion,
  );

  let docsRepo;
  let targetRepo;
  let pull;
  try {
    docsRepo = parseGitHubRepo(inputs.docs_repo_url);
    targetRepo = parseGitHubRepo(inputs.target_repo_url);
    pull = parsePullRequest(inputs.upstream_pr_url);
  } catch (error) {
    addCheck("github_url_shapes", "Repository and PR URLs use supported immutable GitHub shapes.", false, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let mappings = [];
  let prFields = {};
  let projectFacts = {
    repository: inputs.target_repo_url,
    commit: inputs.target_commit,
    license: null,
    sourcey_adapter: "godoc",
    sourcey_command: EXPECTED_SOURCEY_COMMAND,
    sourcey_config_url: null,
    generated_page_list: [],
    package_count: null,
    non_test_go_file_count: null,
    exported_symbol_count: null,
    public_host: {
      url: inputs.public_url,
      classification: "claimant-authored project-named community documentation",
      target_owned: false,
      official: false,
    },
    upstream_pr: {
      url: inputs.upstream_pr_url,
      role: "optional unmerged link proposal",
      adoption: false,
      endorsement: false,
    },
    claimant_sourcey_star: null,
  };
  if (docsRepo && targetRepo && pull && inputFailures.length === 0) {
    addCheck(
      "github_url_shapes",
      "Repository and PR URLs use supported immutable GitHub shapes.",
      pull.owner === "go-redsync" && pull.repo === "redsync" && targetRepo.url === EXPECTED_TARGET_REPO,
      { docs_repo: docsRepo.url, target_repo: targetRepo.url, pull_request: inputs.upstream_pr_url },
      [inputs.docs_repo_url, inputs.target_repo_url, inputs.upstream_pr_url],
    );

    const targetRepositoryUrl = githubApi(targetRepo, "");
    const targetRepositoryResponse = await fetchText(targetRepositoryUrl, "target_repository_api");
    let targetRepository = {};
    try { targetRepository = JSON.parse(targetRepositoryResponse.body); } catch {}
    const targetLicenseUrl = rawUrl(targetRepo, inputs.target_commit, "LICENSE");
    const targetLicenseResponse = await fetchText(targetLicenseUrl, "target_license");
    addPlaceholderSurface("target_license", targetLicenseUrl, targetLicenseResponse.body);
    const pushedAtMs = Date.parse(targetRepository.pushed_at ?? "");
    const checkedAtMs = Date.parse(checkedAt);
    const activityAgeDays = Number.isFinite(pushedAtMs)
      ? Math.floor((checkedAtMs - pushedAtMs) / 86_400_000)
      : null;
    const projectPass =
      targetRepositoryResponse.http_status === 200 &&
      targetRepository.full_name === "go-redsync/redsync" &&
      targetRepository.archived === false &&
      targetRepository.license?.spdx_id === EXPECTED_LICENSE &&
      activityAgeDays !== null &&
      activityAgeDays >= 0 &&
      activityAgeDays <= 365 &&
      targetLicenseResponse.http_status === 200 &&
      /Redistribution and use in source and binary forms/.test(targetLicenseResponse.body) &&
      /Neither the name of the Redsync nor the names of its/.test(targetLicenseResponse.body);
    addCheck(
      "target_project",
      "Redsync is a maintained, public, unarchived BSD-3-Clause third-party project at the pinned source.",
      projectPass,
      {
        repository_http_status: targetRepositoryResponse.http_status,
        full_name: targetRepository.full_name ?? null,
        archived: targetRepository.archived ?? null,
        pushed_at: targetRepository.pushed_at ?? null,
        activity_age_days: activityAgeDays,
        license_spdx: targetRepository.license?.spdx_id ?? null,
        license_http_status: targetLicenseResponse.http_status,
        license_sha256: targetLicenseResponse.content_sha256,
      },
      [targetRepositoryUrl, targetLicenseUrl],
    );

    const targetCommitUrl = githubApi(targetRepo, `/commits/${inputs.target_commit}`);
    const targetCommitResponse = await fetchText(targetCommitUrl, "target_commit_api");
    let targetCommitJson = {};
    try { targetCommitJson = JSON.parse(targetCommitResponse.body); } catch {}
    addCheck(
      "target_commit",
      "The pinned Redsync commit resolves exactly.",
      targetCommitResponse.http_status === 200 && targetCommitJson.sha === inputs.target_commit,
      { http_status: targetCommitResponse.http_status, sha: targetCommitJson.sha ?? null },
      [targetCommitUrl],
    );

    const docsCommitUrl = githubApi(docsRepo, `/commits/${inputs.docs_commit}`);
    const docsCommitResponse = await fetchText(docsCommitUrl, "docs_commit_api");
    let docsCommitJson = {};
    try { docsCommitJson = JSON.parse(docsCommitResponse.body); } catch {}
    addCheck(
      "docs_commit",
      "The immutable docs commit resolves exactly.",
      docsCommitResponse.http_status === 200 && docsCommitJson.sha === inputs.docs_commit,
      { http_status: docsCommitResponse.http_status, sha: docsCommitJson.sha ?? null },
      [docsCommitUrl],
    );

    const expectedMappingsUrl = rawUrl(docsRepo, inputs.docs_commit, "evidence/page-source-mappings.json");
    const mappingResponse = await fetchText(inputs.mappings_url, "page_source_mappings");
    addPlaceholderSurface("immutable_mappings", inputs.mappings_url, mappingResponse.body);
    try { mappings = JSON.parse(mappingResponse.body); } catch {}
    const mappingShape =
      inputs.mappings_url === expectedMappingsUrl &&
      mappingResponse.http_status === 200 &&
      Array.isArray(mappings) &&
      mappings.length === 5 &&
      new Set(mappings.map((item) => item.generated_page)).size === 5 &&
      mappings.every(
        (item) =>
          typeof item.generated_page === "string" &&
          /^go-api\/.+\.html$/.test(item.generated_page) &&
          typeof item.rendered_symbol === "string" &&
          item.rendered_symbol.length > 0 &&
          typeof item.source_path === "string" &&
          item.source_path.endsWith(".go") &&
          Number.isInteger(item.source_line) &&
          /^[0-9a-f]{40}$/.test(item.source_git_blob_sha1) &&
          /^[0-9a-f]{64}$/.test(item.source_sha256) &&
          /^[0-9a-f]{64}$/.test(item.generated_page_sha256),
      );
    addCheck(
      "mappings_shape",
      "The immutable mappings JSON contains exactly five complete records.",
      mappingShape,
      {
        http_status: mappingResponse.http_status,
        count: Array.isArray(mappings) ? mappings.length : null,
        immutable_url_matches_docs_commit: inputs.mappings_url === expectedMappingsUrl,
      },
      [inputs.mappings_url],
    );

    const docsPaths = [
      "sourcey.config.ts",
      "scripts/generate-godoc-snapshot.mjs",
      "godoc.json",
      "dist/index.html",
      "evidence/inventory.json",
      "evidence/page-source-mappings.json",
      "evidence/sha256-manifest.json",
    ];
    const docsResponses = new Map();
    for (const path of docsPaths) {
      const url = rawUrl(docsRepo, inputs.docs_commit, path);
      const response = await fetchText(url, `docs_file:${path}`);
      docsResponses.set(path, response);
      addPlaceholderSurface(`immutable_docs:${path}`, url, response.body);
    }
    const configBody = docsResponses.get("sourcey.config.ts")?.body ?? "";
    const snapshotScriptBody = docsResponses.get("scripts/generate-godoc-snapshot.mjs")?.body ?? "";
    const indexBody = docsResponses.get("dist/index.html")?.body ?? "";
    let godoc = {};
    let inventory = {};
    let sha256Manifest = {};
    try { godoc = JSON.parse(docsResponses.get("godoc.json")?.body ?? ""); } catch {}
    try { inventory = JSON.parse(docsResponses.get("evidence/inventory.json")?.body ?? ""); } catch {}
    try { sha256Manifest = JSON.parse(docsResponses.get("evidence/sha256-manifest.json")?.body ?? ""); } catch {}
    const generatedPageList = Array.isArray(sha256Manifest.files)
      ? sha256Manifest.files
          .map((file) => file.path)
          .filter((path) => /^dist\/.+\.html$/.test(path))
          .map((path) => path.slice("dist/".length))
          .sort()
      : [];
    const apiPackagePageList = Array.isArray(inventory.packages)
      ? inventory.packages.map((item) => apiPagePath(item.import_path)).sort()
      : [];
    const sourceyCommandPass =
      snapshotScriptBody.includes('"godoc"') &&
      snapshotScriptBody.includes('"--module"') &&
      snapshotScriptBody.includes('"./source/redsync"') &&
      snapshotScriptBody.includes('"--packages"') &&
      snapshotScriptBody.includes('"./..."') &&
      snapshotScriptBody.includes('"--out"');
    const docsFilesPass =
      docsPaths.every((path) => docsResponses.get(path)?.http_status === 200) &&
      configBody.includes(EXPECTED_TARGET_REPO) &&
      configBody.includes(inputs.target_commit) &&
      /Sourcey/i.test(configBody) &&
      /godoc/i.test(configBody) &&
      /Sourcey/i.test(indexBody) &&
      /Redsync/i.test(indexBody) &&
      indexBody.includes(EXPECTED_MODULE) &&
      indexBody.includes(inputs.target_commit) &&
      godoc.schema_version === 1 &&
      godoc.module_path === EXPECTED_MODULE &&
      Array.isArray(godoc.packages) &&
      godoc.packages.length === 15 &&
      sourceyCommandPass &&
      inventory.schema_version === "redsync-sourcey-inventory/v1" &&
      inventory.repository === EXPECTED_TARGET_REPO &&
      inventory.commit === inputs.target_commit &&
      inventory.package_count === 15 &&
      inventory.non_test_go_file_count === 19 &&
      inventory.exported_symbol_count === 110 &&
      apiPackagePageList.length === 15 &&
      generatedPageList.length >= 20 &&
      sha256Manifest.schema_version === "sha256-manifest/v1" &&
      mappingShape;
    addCheck(
      "immutable_docs_files",
      "Sourcey config, godoc snapshot, dist index, and mappings resolve at the immutable docs commit with pinned target markers.",
      docsFilesPass,
      {
        files: docsPaths.map((path) => ({ path, http_status: docsResponses.get(path)?.http_status ?? null })),
        godoc_schema: godoc.schema_version ?? null,
        godoc_module: godoc.module_path ?? null,
        godoc_packages: Array.isArray(godoc.packages) ? godoc.packages.length : null,
        sourcey_adapter: "godoc",
        sourcey_command: EXPECTED_SOURCEY_COMMAND,
        sourcey_command_configured: sourceyCommandPass,
        package_count: inventory.package_count ?? null,
        non_test_go_file_count: inventory.non_test_go_file_count ?? null,
        exported_symbol_count: inventory.exported_symbol_count ?? null,
        api_package_pages: apiPackagePageList,
        generated_page_count: generatedPageList.length,
        generated_page_list: generatedPageList,
        config_has_target_repo: configBody.includes(EXPECTED_TARGET_REPO),
        config_has_target_commit: configBody.includes(inputs.target_commit),
        dist_has_target_module: indexBody.includes(EXPECTED_MODULE),
        dist_has_target_commit: indexBody.includes(inputs.target_commit),
        mappings_count: Array.isArray(mappings) ? mappings.length : null,
      },
      docsPaths.map((path) => rawUrl(docsRepo, inputs.docs_commit, path)),
    );
    const documentationDepthPass =
      inventory.non_test_go_file_count >= 2 &&
      inventory.exported_symbol_count >= 20 &&
      apiPackagePageList.length === inventory.package_count &&
      generatedPageList.length >= 20;
    addCheck(
      "documentation_depth",
      "The pinned project has multiple source files and the published package documents at least 20 real exported items.",
      documentationDepthPass,
      {
        non_test_go_file_count: inventory.non_test_go_file_count ?? null,
        exported_symbol_count: inventory.exported_symbol_count ?? null,
        package_count: inventory.package_count ?? null,
        generated_page_count: generatedPageList.length,
        api_package_page_list: apiPackagePageList,
      },
      [
        rawUrl(docsRepo, inputs.docs_commit, "evidence/inventory.json"),
        rawUrl(docsRepo, inputs.docs_commit, "evidence/sha256-manifest.json"),
      ],
    );
    projectFacts = {
      ...projectFacts,
      license: EXPECTED_LICENSE,
      archived: targetRepository.archived ?? null,
      pushed_at: targetRepository.pushed_at ?? null,
      activity_age_days: activityAgeDays,
      sourcey_config_url: rawUrl(docsRepo, inputs.docs_commit, "sourcey.config.ts"),
      sourcey_snapshot_script_url: rawUrl(
        docsRepo,
        inputs.docs_commit,
        "scripts/generate-godoc-snapshot.mjs",
      ),
      generated_page_list: generatedPageList,
      api_package_page_list: apiPackagePageList,
      package_count: inventory.package_count ?? null,
      non_test_go_file_count: inventory.non_test_go_file_count ?? null,
      exported_symbol_count: inventory.exported_symbol_count ?? null,
      inventory_url: rawUrl(docsRepo, inputs.docs_commit, "evidence/inventory.json"),
    };

    const publicRoot = await fetchText(inputs.public_url, "public_url");
    addPlaceholderSurface("public_root", inputs.public_url, publicRoot.body);
    const publicRootPass =
      publicRoot.http_status === 200 && /Sourcey/i.test(publicRoot.body) && /Redsync/i.test(publicRoot.body);
    addCheck(
      "public_url",
      "Published public_url returns HTTP 200 and identifies Sourcey and Redsync.",
      publicRootPass,
      { http_status: publicRoot.http_status, content_sha256: publicRoot.content_sha256, checked_text: publicRoot.checked_text },
      [inputs.public_url],
    );

    const introductionUrl = new URL("introduction.html", inputs.public_url).href;
    const apiHomeUrl = new URL("go-api.html", inputs.public_url).href;
    const introduction = await fetchText(introductionUrl, "sourcey_introduction");
    const apiHome = await fetchText(apiHomeUrl, "sourcey_api_home");
    addPlaceholderSurface("public_introduction", introductionUrl, introduction.body);
    addPlaceholderSurface("public_api_home", apiHomeUrl, apiHome.body);
    const sourceyHomePass = [introduction, apiHome].every(
      (response) => response.http_status === 200 && /Sourcey/i.test(response.body) && /Redsync/i.test(response.body),
    );
    addCheck(
      "sourcey_home",
      "Sourcey introduction and Go API home both return HTTP 200 with target markers.",
      sourceyHomePass,
      {
        introduction_status: introduction.http_status,
        api_home_status: apiHome.http_status,
        introduction_sha256: introduction.content_sha256,
        api_home_sha256: apiHome.content_sha256,
      },
      [introductionUrl, apiHomeUrl],
    );

    const narrativePaths = [
      "introduction.html",
      "hosting-decision.html",
      "pinned-source-coverage.html",
      "upstream-pr-rationale.html",
      "llms-full.txt",
      "search-index.json",
    ];
    const forbiddenNarrativePhrases = [
      "candidate publication: pending",
      "not pushed, built, or deployed",
      "not been pushed, built, or deployed",
      "fresh post-claim docs commit",
      "fresh docs commit",
      "fresh read the docs build",
      "require a readthedocs build/deploy",
      "require a read the docs build/deploy",
      "confirm a fresh read the docs build deploys",
    ];
    const narrativeResults = [];
    for (const path of narrativePaths) {
      const immutableUrl = rawUrl(docsRepo, inputs.docs_commit, `dist/${path}`);
      const pageUrl = new URL(path, inputs.public_url).href;
      const immutable = await fetchText(immutableUrl, `immutable_narrative:${path}`);
      const published = await fetchText(pageUrl, `public_narrative:${path}`);
      addPlaceholderSurface(`immutable_narrative:${path}`, immutableUrl, immutable.body);
      addPlaceholderSurface(`public_narrative:${path}`, pageUrl, published.body);
      let canonicalBytes = published.raw_bytes;
      let canonicalization = null;
      if (path.endsWith(".html")) {
        canonicalization = canonicalizeReadTheDocsPage(
          published.raw_bytes,
          pageUrl,
          inputs.public_url,
          docsRepo.repo,
        );
        canonicalBytes = canonicalization.canonical_bytes;
      }
      const lowered = published.body.toLowerCase();
      const forbiddenOccurrences = forbiddenNarrativePhrases.filter((phrase) => lowered.includes(phrase));
      const canonicalSha256 = canonicalBytes ? sha256(canonicalBytes) : null;
      const publicMatchesImmutable =
        immutable.http_status === 200 &&
        published.http_status === 200 &&
        canonicalSha256 === immutable.content_sha256 &&
        (!path.endsWith(".html") || canonicalization?.recognized === true);
      narrativeResults.push({
        path,
        immutable_url: immutableUrl,
        public_url: pageUrl,
        immutable_http_status: immutable.http_status,
        public_http_status: published.http_status,
        immutable_sha256: immutable.content_sha256,
        canonical_public_sha256: canonicalSha256,
        public_matches_immutable: publicMatchesImmutable,
        forbidden_occurrences: forbiddenOccurrences,
        rtd_addon_recognized: canonicalization?.recognized ?? null,
      });
    }
    addCheck(
      "public_narrative_readback",
      "All public provenance narratives match the immutable docs commit after strict RTD addon canonicalization and contain no stale publication-state prose.",
      narrativeResults.length === narrativePaths.length &&
        narrativeResults.every(
          (item) => item.public_matches_immutable && item.forbidden_occurrences.length === 0,
        ),
      { docs_commit: inputs.docs_commit, files: narrativeResults },
      narrativeResults.flatMap((item) => [item.public_url, item.immutable_url]),
    );

    const pageResults = [];
    for (const mapping of mappings) {
      const pageUrl = new URL(mapping.generated_page, inputs.public_url).href;
      const immutablePageUrl = rawUrl(
        docsRepo,
        inputs.docs_commit,
        `dist/${mapping.generated_page}`,
      );
      const immutablePage = await fetchText(
        immutablePageUrl,
        `immutable_api_page:${mapping.generated_page}`,
      );
      const publicPage = await fetchText(pageUrl, `public_api_page:${mapping.generated_page}`);
      addPlaceholderSurface(
        `immutable_api_page:${mapping.generated_page}`,
        immutablePageUrl,
        immutablePage.body,
      );
      addPlaceholderSurface(
        `public_api_page:${mapping.generated_page}`,
        pageUrl,
        publicPage.body,
      );
      const canonicalization = canonicalizeReadTheDocsPage(
        publicPage.raw_bytes,
        pageUrl,
        inputs.public_url,
        docsRepo.repo,
      );
      const canonicalizedSha256 = canonicalization.canonical_bytes
        ? sha256(canonicalization.canonical_bytes)
        : null;
      const immutableHashMatches =
        immutablePage.http_status === 200 &&
        immutablePage.content_sha256 === mapping.generated_page_sha256;
      const canonicalMatchesImmutable =
        canonicalizedSha256 !== null &&
        canonicalizedSha256 === immutablePage.content_sha256;
      pageResults.push({
        generated_page: mapping.generated_page,
        public_url: pageUrl,
        immutable_url: immutablePageUrl,
        public_http_status: publicPage.http_status,
        immutable_http_status: immutablePage.http_status,
        public_raw_sha256: publicPage.content_sha256,
        immutable_raw_sha256: immutablePage.content_sha256,
        mapped_immutable_sha256: mapping.generated_page_sha256,
        canonicalized_public_sha256: canonicalizedSha256,
        immutable_hash_matches_mapping: immutableHashMatches,
        canonicalized_public_matches_immutable: canonicalMatchesImmutable,
        rtd_addon: {
          recognized: canonicalization.recognized,
          removed_fragment_count: canonicalization.removed_fragment_count,
          removed_fragment_bytes: canonicalization.removed_fragment_bytes,
          removed_fragment_sha256: canonicalization.removed_fragment_sha256,
          removed_fragment_identity: canonicalization.removed_fragment_identity,
          marker_counts: canonicalization.marker_counts,
          error: canonicalization.error,
        },
        rendered_symbol: mapping.rendered_symbol,
        public_contains_sourcey: /Sourcey/i.test(publicPage.body),
        public_contains_symbol: publicPage.body.includes(mapping.rendered_symbol),
        pass:
          publicPage.http_status === 200 &&
          /Sourcey/i.test(publicPage.body) &&
          publicPage.body.includes(mapping.rendered_symbol) &&
          immutableHashMatches &&
          canonicalization.recognized &&
          canonicalMatchesImmutable,
      });
    }
    addCheck(
      "five_api_pages",
      "Each immutable API page matches its mapped hash, and each HTTP 200 RTD page contains Sourcey plus its symbol and differs only by one recognized addon injected immediately before </head>.",
      pageResults.length === 5 && pageResults.every((item) => item.pass),
      { pages: pageResults },
      pageResults.flatMap((item) => [item.public_url, item.immutable_url]),
    );

    const sourceResults = [];
    for (const mapping of mappings) {
      const expectedSourcePrefix =
        `https://github.com/go-redsync/redsync/blob/${inputs.target_commit}/${mapping.source_path}#L${mapping.source_line}`;
      const sourceUrlPinned =
        mapping.source_url === expectedSourcePrefix || mapping.source_url.startsWith(`${expectedSourcePrefix}-L`);
      const rawSourceUrl =
        `https://raw.githubusercontent.com/go-redsync/redsync/${inputs.target_commit}/${mapping.source_path}`;
      const rawSource = await fetchText(rawSourceUrl, `raw_source:${mapping.source_path}`);
      addPlaceholderSurface(`pinned_source:${mapping.source_path}`, rawSourceUrl, rawSource.body);
      const sourceLines = rawSource.body.split(/\r?\n/);
      const rawSourceGitBlobSha1 = gitBlobSha1(rawSource.raw_bytes);
      let lineMatches = false;
      try {
        lineMatches = new RegExp(mapping.source_line_pattern).test(sourceLines[mapping.source_line - 1] ?? "");
      } catch {}
      sourceResults.push({
        source_url: mapping.source_url,
        raw_source_url: rawSourceUrl,
        source_url_shape_verified: sourceUrlPinned,
        source_page_fetch: "not_required",
        raw_source_status: rawSource.http_status,
        source_url_pinned: sourceUrlPinned,
        content_sha256: rawSource.content_sha256,
        expected_sha256: mapping.source_sha256,
        git_blob_sha1: rawSourceGitBlobSha1,
        expected_git_blob_sha1: mapping.source_git_blob_sha1,
        checked_line: sourceLines[mapping.source_line - 1] ?? "",
        line_matches: lineMatches,
        pass:
          sourceUrlPinned &&
          rawSource.http_status === 200 &&
          rawSource.content_sha256 === mapping.source_sha256 &&
          rawSourceGitBlobSha1 === mapping.source_git_blob_sha1 &&
          lineMatches,
      });
    }
    addCheck(
      "five_pinned_sources",
      "All five source links have the exact pinned Redsync shape and raw source bytes/lines match mappings.",
      sourceResults.length === 5 && sourceResults.every((item) => item.pass),
      { sources: sourceResults },
      sourceResults.flatMap((item) => [item.source_url, item.raw_source_url]),
    );

    const prApiUrl = githubApi(targetRepo, `/pulls/${pull.number}`);
    const prResponse = await fetchText(prApiUrl, "upstream_pull_request");
    let pr = {};
    try { pr = JSON.parse(prResponse.body); } catch {}
    prFields = {
      api_url: prApiUrl,
      html_url: pr.html_url ?? null,
      state: pr.state ?? null,
      draft: pr.draft ?? null,
      merged_at: pr.merged_at ?? null,
      base_ref: pr.base?.ref ?? null,
      head_sha: pr.head?.sha ?? null,
      body_sha256: sha256(String(pr.body ?? "")),
      body_checked_text: excerpt(String(pr.body ?? "")),
    };
    transcript.push(`PR_URL ${prFields.html_url}`);
    transcript.push(`PR_STATE ${prFields.state}`);
    transcript.push(`PR_DRAFT ${prFields.draft}`);
    transcript.push(`PR_MERGED_AT ${prFields.merged_at}`);
    transcript.push(`PR_BASE_REF ${prFields.base_ref}`);
    transcript.push(`PR_HEAD_SHA ${prFields.head_sha}`);
    transcript.push(`PR_BODY_SHA256 ${prFields.body_sha256}`);
    const prBody = String(pr.body ?? "");
    addPlaceholderSurface("upstream_pr_body", inputs.upstream_pr_url, prBody);
    const prPass =
      prResponse.http_status === 200 &&
      pr.html_url === inputs.upstream_pr_url &&
      pr.state === "open" &&
      pr.draft === false &&
      pr.merged_at === null &&
      pr.base?.ref === "master" &&
      pr.head?.sha === inputs.upstream_pr_head_commit &&
      prBody.includes(inputs.public_url) &&
      /Sourcey|generated API documentation/i.test(prBody) &&
      /maintainer/i.test(prBody) &&
      /adopt|ownership|transfer/i.test(prBody);
    addCheck(
      "upstream_pr",
      "The optional upstream link proposal is open, unmerged, non-draft, exact-head, and is not adoption or endorsement.",
      prPass,
      { http_status: prResponse.http_status, ...prFields },
      [inputs.upstream_pr_url, prApiUrl],
    );
    projectFacts.upstream_pr = {
      ...projectFacts.upstream_pr,
      state: prFields.state,
      draft: prFields.draft,
      merged_at: prFields.merged_at,
      head_sha: prFields.head_sha,
    };

    if (inputs.claimant_github_login) {
      const starApiUrl =
        `https://api.github.com/users/${inputs.claimant_github_login}/starred?per_page=100`;
      const listUrls = [];
      const httpStatuses = [];
      let listItemCount = 0;
      let matchedRepository = null;
      let parseError = null;
      for (let page = 1; page <= 10; page += 1) {
        const pageUrl = page === 1 ? starApiUrl : `${starApiUrl}&page=${page}`;
        const response = await fetchText(pageUrl, `claimant_sourcey_star_page_${page}`);
        listUrls.push(pageUrl);
        httpStatuses.push(response.http_status);
        if (response.http_status !== 200) break;
        let repositories;
        try {
          repositories = JSON.parse(response.body);
          if (!Array.isArray(repositories)) throw new Error("response is not an array");
        } catch (error) {
          parseError = error instanceof Error ? error.message : String(error);
          break;
        }
        listItemCount += repositories.length;
        if (repositories.some((repository) => repository?.full_name === "sourcey/sourcey")) {
          matchedRepository = "sourcey/sourcey";
          break;
        }
        if (repositories.length < 100) break;
      }
      const starObserved = {
        claimant: inputs.claimant_github_login,
        repository: "sourcey/sourcey",
        url: starApiUrl,
        http_status: httpStatuses[0] ?? null,
        authentication: "none",
        matched_repository: matchedRepository,
        list_item_count: listItemCount,
        pages_checked: listUrls.length,
        parse_error: parseError,
      };
      addCheck(
        "claimant_sourcey_star",
        "The claimant's public starred-repository list contains exact full_name sourcey/sourcey and the check uses no authentication.",
        httpStatuses.length > 0 &&
          httpStatuses.every((status) => status === 200) &&
          parseError === null &&
          matchedRepository === "sourcey/sourcey",
        starObserved,
        listUrls,
      );
      projectFacts.claimant_sourcey_star = starObserved;
    }

    const placeholders = [];
    for (const surface of placeholderSurfaces) {
      const matches = [...new Set(surface.body.match(UNRESOLVED_FINAL_RE) ?? [])];
      if (matches.length) {
        placeholders.push({ label: surface.label, url: surface.url, placeholders: matches });
      }
      UNRESOLVED_FINAL_RE.lastIndex = 0;
    }
    for (const [name, value] of Object.entries(inputs)) {
      const matches = [...new Set(String(value).match(UNRESOLVED_FINAL_RE) ?? [])];
      if (matches.length) placeholders.push({ input: name, placeholders: matches });
      UNRESOLVED_FINAL_RE.lastIndex = 0;
    }
    addCheck(
      "no_delivery_placeholders",
      "Runtime inputs and explicit public or immutable non-draft docs, site, mapping, pinned-source, and PR-body surfaces contain no unresolved final-value token; GitHub API metadata and patch bodies are excluded.",
      placeholders.length === 0,
      {
        scanned_surface_count: placeholderSurfaces.length,
        excluded_response_classes: ["github_commit_api_metadata", "github_commit_api_patch", "github_ui_wrapper"],
        placeholder_occurrences: placeholders,
      },
      placeholderSurfaces.map((surface) => surface.url),
    );
  } else {
    for (const id of [
      "target_commit",
      "target_project",
      "docs_commit",
      "mappings_shape",
      "immutable_docs_files",
      "documentation_depth",
      "public_url",
      "sourcey_home",
      "five_api_pages",
      "five_pinned_sources",
      "upstream_pr",
      "no_delivery_placeholders",
    ]) {
      addCheck(id, "Dependent live validation check.", false, { blocker: "invalid inputs or URL shapes" });
    }
  }

  const blocked = checks.filter((item) => item.status === "BLOCKED");
  const livePass = inputs.validation_mode === "live" && blocked.length === 0;
  const status = inputs.validation_mode === "fixture"
    ? blocked.length === 0 ? "FIXTURE_PASS" : "FIXTURE_BLOCKED"
    : livePass ? "PASS" : "BLOCKED";

  transcript.push(`FINAL_STATUS ${status}`);
  transcript.push(`LIVE_PASS ${livePass}`);
  transcript.push(`BLOCKED_COUNT ${blocked.length}`);
  const transcriptText = `${transcript.join("\n")}\n`;
  const transcriptBytes = Buffer.from(transcriptText);
  const transcriptPath = resolve(outputDir, "transcript.txt");
  const evidencePath = resolve(outputDir, "evidence.json");
  const transcriptRef = "artifacts/transcript.txt";
  const evidenceRef = "artifacts/evidence.json";
  if (inputs.artifact_mode === "files") {
    await mkdir(outputDir, { recursive: true });
    await writeFile(transcriptPath, transcriptBytes);
  }

  const observations = [
    cliVersion.output,
    `Target repository: ${inputs.target_repo_url}`,
    `Pinned target commit: ${inputs.target_commit}`,
    `License: ${projectFacts.license ?? "unverified"}`,
    `Sourcey adapter: ${projectFacts.sourcey_adapter}`,
    `Sourcey command: ${projectFacts.sourcey_command}`,
    `Sourcey config: ${projectFacts.sourcey_config_url ?? "unverified"}`,
    `Generated page count: ${projectFacts.generated_page_list.length}`,
    `Generated page list: ${projectFacts.generated_page_list.join(", ")}`,
    `Coverage: packages=${projectFacts.package_count ?? "unverified"}, non-test Go files=${projectFacts.non_test_go_file_count ?? "unverified"}, exported symbols=${projectFacts.exported_symbol_count ?? "unverified"}`,
    `Public host boundary: ${projectFacts.public_host.classification}; target_owned=false; official=false`,
    `Upstream PR boundary: ${projectFacts.upstream_pr.role}; adoption=false; endorsement=false`,
    ...(projectFacts.claimant_sourcey_star
      ? [
          `Public star: ${projectFacts.claimant_sourcey_star.claimant} stars sourcey/sourcey; HTTP ${projectFacts.claimant_sourcey_star.http_status}; authentication=none`,
        ]
      : []),
  ];
  const evidenceItems = [
    { type: "literal_runx_version", observed: cliVersion.output, command: cliVersion.command },
    { type: "target_repository", refs: checks.find((item) => item.id === "target_project")?.refs ?? [] },
    { type: "immutable_source_commit", refs: checks.find((item) => item.id === "target_commit")?.refs ?? [] },
    { type: "sourcey_config_and_command", refs: checks.find((item) => item.id === "immutable_docs_files")?.refs ?? [] },
    { type: "inventory_and_page_list", refs: checks.find((item) => item.id === "documentation_depth")?.refs ?? [] },
    { type: "five_page_source_mappings", refs: checks.find((item) => item.id === "five_pinned_sources")?.refs ?? [] },
    { type: "public_page_http_and_hashes", refs: checks.find((item) => item.id === "five_api_pages")?.refs ?? [] },
    { type: "independent_raw_transcript", path: transcriptRef, sha256: sha256(transcriptBytes) },
  ];

  const evidence = {
    schema_version: "redsync.sourcey.governed_validation.v1",
    status,
    live_pass: livePass,
    validation_mode: inputs.validation_mode,
    checked_at: checkedAt,
    inputs: {
      ...inputs,
      output_dir: "artifacts",
      fixture_proxy_url: inputs.validation_mode === "fixture" ? inputs.fixture_proxy_url : "",
    },
    cli_version: cliVersion,
    project_facts: projectFacts,
    observations,
    evidence_items: evidenceItems,
    graph_receipt: {
      applicable: false,
      reason: "The validator is a standalone skill and does not compose another runx skill.",
    },
    failed_workflow_evidence_policy:
      "Only a new successful post-claim governed run and its verified receipt may be used in final evidence.",
    checks,
    http_checks: httpChecks,
    pr_fields: prFields,
    raw_failure_count: blocked.length,
    summary_consistency: {
      status_matches_raw_failures:
        (status === "PASS" && blocked.length === 0) ||
        (status === "FIXTURE_PASS" && blocked.length === 0) ||
        ((status === "BLOCKED" || status === "FIXTURE_BLOCKED") && blocked.length > 0),
      live_pass_matches_status: livePass === (status === "PASS"),
      blocked_check_ids: blocked.map((item) => item.id),
    },
    transcript_artifact: {
      path: transcriptRef,
      bytes: transcriptBytes.length,
      sha256: sha256(transcriptBytes),
    },
  };
  const evidenceText = `${JSON.stringify(evidence, null, 2)}\n`;
  const evidenceBytes = Buffer.from(evidenceText);
  if (inputs.artifact_mode === "files") await writeFile(evidencePath, evidenceBytes);
  const artifacts = {
    evidence_json: { path: evidenceRef, bytes: evidenceBytes.length, sha256: sha256(evidenceBytes) },
    transcript: { path: transcriptRef, bytes: transcriptBytes.length, sha256: sha256(transcriptBytes) },
  };

  const output = {
    ...evidence,
    validation_result: { status, live_pass: livePass, blocked_checks: blocked.map((item) => item.id) },
    evidence_json: evidence,
    transcript: transcriptText,
    artifacts,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (blocked.length) process.exitCode = 1;
}

main().catch(async (error) => {
  const failure = {
    schema_version: "redsync.sourcey.governed_validation.v1",
    status: "BLOCKED",
    live_pass: false,
    checked_at: new Date().toISOString(),
    fatal_error: error instanceof Error ? error.stack ?? error.message : String(error),
  };
  process.stdout.write(`${JSON.stringify(failure)}\n`);
  process.exitCode = 1;
});
