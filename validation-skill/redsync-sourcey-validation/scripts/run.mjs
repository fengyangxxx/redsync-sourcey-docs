import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { canonicalizeReadTheDocsPage } from "./rtd-canonicalizer.mjs";

const EXPECTED_TARGET_REPO = "https://github.com/go-redsync/redsync";
const EXPECTED_MODULE = "github.com/go-redsync/redsync/v4";
const EXPECTED_CLI_VERSION = "runx-cli 0.6.14";
const UNRESOLVED_FINAL_RE = new RegExp(["PLACE", "HOLDER_[A-Z0-9_]+"].join(""), "g");

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
    output_dir: input("output_dir"),
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

    let record;
    let body = "";
    let rawBytes = Buffer.alloc(0);
    try {
      const response = await fetch(fetchedUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
        headers: {
          accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
          "user-agent": "redsync-sourcey-validation/0.1.0",
        },
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      rawBytes = bytes;
      body = bytes.toString("utf8");
      record = {
        label,
        url: logicalUrl,
        fetched_url: inputs.validation_mode === "fixture" ? fetchedUrl : logicalUrl,
        http_status: response.status,
        content_sha256: sha256(bytes),
        bytes: bytes.length,
        content_type: response.headers.get("content-type") ?? "",
        checked_text: excerpt(body),
      };
    } catch (error) {
      record = {
        label,
        url: logicalUrl,
        fetched_url: inputs.validation_mode === "fixture" ? fetchedUrl : logicalUrl,
        http_status: null,
        content_sha256: null,
        bytes: 0,
        content_type: "",
        checked_text: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }

    httpChecks.push(record);
    responseBodies.set(logicalUrl, { ...record, body, raw_bytes: rawBytes });
    transcript.push(`HTTP_LABEL ${label}`);
    transcript.push(`HTTP_URL ${logicalUrl}`);
    if (inputs.validation_mode === "fixture") transcript.push(`FETCHED_AS ${fetchedUrl}`);
    transcript.push(`HTTP_STATUS ${record.http_status ?? "ERROR"}`);
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
  ];
  const inputFailures = required.filter((name) => !inputs[name]).map((name) => `${name} is required`);
  if (!new Set(["live", "fixture"]).has(inputs.validation_mode)) {
    inputFailures.push("validation_mode must be live or fixture");
  }
  if (inputs.validation_mode === "fixture" && !inputs.fixture_proxy_url) {
    inputFailures.push("fixture_proxy_url is required in fixture mode");
  }
  if (inputs.target_repo_url && inputs.target_repo_url !== EXPECTED_TARGET_REPO) {
    inputFailures.push(`target_repo_url must be ${EXPECTED_TARGET_REPO}`);
  }
  for (const name of ["docs_commit", "target_commit", "upstream_pr_head_commit"]) {
    if (inputs[name] && !/^[0-9a-f]{40}$/i.test(inputs[name])) inputFailures.push(`${name} must be a full SHA`);
  }
  addCheck(
    "input_contract",
    "All immutable inputs are present and target go-redsync/redsync.",
    inputFailures.length === 0,
    { failures: inputFailures, target_repo_url: inputs.target_repo_url },
  );

  let cliVersion = { command: "npx -y @runxhq/cli@0.6.14 --version", output: "", exit_code: 1, source: "live_command" };
  if (inputs.validation_mode === "fixture" && process.env.REDSYNC_VALIDATION_FIXTURE_CLI_VERSION) {
    cliVersion = {
      ...cliVersion,
      output: process.env.REDSYNC_VALIDATION_FIXTURE_CLI_VERSION.trim(),
      exit_code: 0,
      source: "fixture_override",
    };
  } else {
    const versionRun = spawnSync("npx", ["-y", "@runxhq/cli@0.6.14", "--version"], {
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_cache: resolve(tmpdir(), "redsync-validation-npm-cache"),
      },
      shell: process.platform === "win32",
    });
    cliVersion = {
      ...cliVersion,
      output: (versionRun.stdout ?? "").trim(),
      stderr: (versionRun.stderr ?? "").trim(),
      exit_code: versionRun.status ?? 1,
      source: "live_command",
      error: versionRun.error?.message,
    };
  }
  transcript.push(`CLI_COMMAND ${cliVersion.command}`);
  transcript.push(`CLI_SOURCE ${cliVersion.source}`);
  transcript.push(`CLI_EXIT ${cliVersion.exit_code}`);
  transcript.push(`CLI_VERSION_OUTPUT ${cliVersion.output}`);
  if (cliVersion.stderr) transcript.push(`CLI_STDERR ${JSON.stringify(cliVersion.stderr)}`);
  addCheck(
    "cli_version_exact",
    `Governed CLI output is exactly ${EXPECTED_CLI_VERSION}.`,
    cliVersion.exit_code === 0 && cliVersion.output === EXPECTED_CLI_VERSION,
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
  if (docsRepo && targetRepo && pull && inputFailures.length === 0) {
    addCheck(
      "github_url_shapes",
      "Repository and PR URLs use supported immutable GitHub shapes.",
      pull.owner === "go-redsync" && pull.repo === "redsync" && targetRepo.url === EXPECTED_TARGET_REPO,
      { docs_repo: docsRepo.url, target_repo: targetRepo.url, pull_request: inputs.upstream_pr_url },
      [inputs.docs_repo_url, inputs.target_repo_url, inputs.upstream_pr_url],
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
      "godoc.json",
      "dist/index.html",
      "evidence/page-source-mappings.json",
    ];
    const docsResponses = new Map();
    for (const path of docsPaths) {
      const url = rawUrl(docsRepo, inputs.docs_commit, path);
      const response = await fetchText(url, `docs_file:${path}`);
      docsResponses.set(path, response);
      addPlaceholderSurface(`immutable_docs:${path}`, url, response.body);
    }
    const configBody = docsResponses.get("sourcey.config.ts")?.body ?? "";
    const indexBody = docsResponses.get("dist/index.html")?.body ?? "";
    let godoc = {};
    try { godoc = JSON.parse(docsResponses.get("godoc.json")?.body ?? ""); } catch {}
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
        config_has_target_repo: configBody.includes(EXPECTED_TARGET_REPO),
        config_has_target_commit: configBody.includes(inputs.target_commit),
        dist_has_target_module: indexBody.includes(EXPECTED_MODULE),
        dist_has_target_commit: indexBody.includes(inputs.target_commit),
        mappings_count: Array.isArray(mappings) ? mappings.length : null,
      },
      docsPaths.map((path) => rawUrl(docsRepo, inputs.docs_commit, path)),
    );

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
      const sourcePage = await fetchText(mapping.source_url, `source_page:${mapping.source_path}`);
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
        source_page_status: sourcePage.http_status,
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
          sourcePage.http_status === 200 &&
          rawSource.http_status === 200 &&
          rawSource.content_sha256 === mapping.source_sha256 &&
          rawSourceGitBlobSha1 === mapping.source_git_blob_sha1 &&
          lineMatches,
      });
    }
    addCheck(
      "five_pinned_sources",
      "All five source URLs target the pinned Redsync commit and raw source bytes/lines match mappings.",
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
      base_ref: pr.base?.ref ?? null,
      head_sha: pr.head?.sha ?? null,
      body_sha256: sha256(String(pr.body ?? "")),
      body_checked_text: excerpt(String(pr.body ?? "")),
    };
    transcript.push(`PR_URL ${prFields.html_url}`);
    transcript.push(`PR_STATE ${prFields.state}`);
    transcript.push(`PR_BASE_REF ${prFields.base_ref}`);
    transcript.push(`PR_HEAD_SHA ${prFields.head_sha}`);
    transcript.push(`PR_BODY_SHA256 ${prFields.body_sha256}`);
    const prBody = String(pr.body ?? "");
    addPlaceholderSurface("upstream_pr_body", inputs.upstream_pr_url, prBody);
    const prPass =
      prResponse.http_status === 200 &&
      pr.html_url === inputs.upstream_pr_url &&
      pr.state === "open" &&
      pr.base?.ref === "master" &&
      pr.head?.sha === inputs.upstream_pr_head_commit &&
      prBody.includes(inputs.public_url) &&
      /Sourcey|generated API documentation/i.test(prBody) &&
      /maintainer/i.test(prBody) &&
      /adopt|ownership|transfer/i.test(prBody);
    addCheck(
      "upstream_pr",
      "Upstream PR is OPEN against master at the exact head and includes URL plus maintainer rationale.",
      prPass,
      { http_status: prResponse.http_status, ...prFields },
      [inputs.upstream_pr_url, prApiUrl],
    );

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
      "docs_commit",
      "mappings_shape",
      "immutable_docs_files",
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
  await mkdir(outputDir, { recursive: true });
  await writeFile(transcriptPath, transcriptBytes);

  const evidence = {
    schema_version: "redsync.sourcey.governed_validation.v1",
    status,
    live_pass: livePass,
    validation_mode: inputs.validation_mode,
    checked_at: checkedAt,
    inputs: { ...inputs, fixture_proxy_url: inputs.validation_mode === "fixture" ? inputs.fixture_proxy_url : "" },
    cli_version: cliVersion,
    checks,
    http_checks: httpChecks,
    pr_fields: prFields,
    raw_failure_count: blocked.length,
    transcript_artifact: {
      path: transcriptPath,
      bytes: transcriptBytes.length,
      sha256: sha256(transcriptBytes),
    },
  };
  const evidenceText = `${JSON.stringify(evidence, null, 2)}\n`;
  const evidenceBytes = Buffer.from(evidenceText);
  await writeFile(evidencePath, evidenceBytes);
  const artifacts = {
    evidence_json: { path: evidencePath, bytes: evidenceBytes.length, sha256: sha256(evidenceBytes) },
    transcript: { path: transcriptPath, bytes: transcriptBytes.length, sha256: sha256(transcriptBytes) },
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
