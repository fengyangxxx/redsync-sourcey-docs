import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
} from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { reconstructReceiptTreeArchive } from "../validation-skill/redsync-sourcey-validation/scripts/receipt-tree-archive.mjs";
import { operatorContextApprovalArgs, resolveNpxInvocation } from "./npx-invocation.mjs";
import { parseRunxVerifyBytes } from "./runx-verify-verdict.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const output = join(root, "deliveries", "shared-receipt");
const receipts = join(root, "r");
const skillArtifacts = join(root, "validation-skill", "redsync-sourcey-validation", "artifacts");
const cache = join(root, "node_modules", ".npm-cache");
const temp = join(root, "node_modules", ".receipt-temp");
const docsCommit = "bc5585dae317d2fcbd48b3774ba10a27f2e585d6";
const targetCommit = "79f6ba24a8bf41f35141de700d410a06bb27622f";
const prHead = "f13cd302b903ae84fc21d914bbeb631a21bb9521";
let ownsRuntimeReceipts = false;
let runStarted = false;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function repoPath(path) {
  return relative(root, path).split(sep).join("/");
}

async function command(executable, args, options = {}) {
  const child = spawn(executable, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: options.shell ?? false,
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

async function writeResult(prefix, result) {
  await writeFile(join(output, `${prefix}-stdout.json`), result.stdout);
  await writeFile(join(output, `${prefix}-stderr.txt`), result.stderr);
  await writeFile(join(output, `${prefix}-exit-code.txt`), `${result.exitCode}\n`);
}

async function copyIfPresent(source, destination) {
  try {
    await copyFile(source, destination);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function preserveSkillArtifacts() {
  await copyIfPresent(join(skillArtifacts, "evidence.json"), join(output, "evidence.json"));
  await copyIfPresent(join(skillArtifacts, "transcript.txt"), join(output, "transcript.txt"));
}

async function manifestFiles(directory, current = directory) {
  const files = [];
  for (const entry of (await readdir(current, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await manifestFiles(directory, full));
    if (entry.isFile() && entry.name !== "manifest.json") {
      const bytes = await readFile(full);
      files.push({ path: relative(directory, full).split(sep).join("/"), bytes: bytes.length, sha256: sha256(bytes) });
    }
  }
  return files;
}

async function main() {
  let retryingFailedCapture = false;
  try {
    await access(output);
    const names = new Set(await readdir(output));
    const failedRetryShape = names.has("capture-error.json") && !names.has("receipt-proof.json");
    if (!failedRetryShape) throw new Error(`output already exists: ${repoPath(output)}`);
    await rm(output, { recursive: true, force: true });
    retryingFailedCapture = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (retryingFailedCapture) {
    await rm(skillArtifacts, { recursive: true, force: true });
  }
  try {
    await access(receipts);
    throw new Error(`runtime receipt directory already exists: ${repoPath(receipts)}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(output, { recursive: true });
  await mkdir(receipts, { recursive: true });
  ownsRuntimeReceipts = true;
  await mkdir(cache, { recursive: true });
  await mkdir(temp, { recursive: true });
  try {
    await access(skillArtifacts);
    throw new Error(`skill artifact directory already exists: ${repoPath(skillArtifacts)}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const env = {
    ...process.env,
    TEMP: temp,
    TMP: temp,
    npm_config_cache: cache,
    NODE_USE_ENV_PROXY: "1",
    RUNX_SANDBOX_ALLOW_DECLARED_POLICY_ONLY: "local",
  };
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
  delete env.RUNX_TOKEN;

  const versionInvocation = resolveNpxInvocation(["-y", "@runxhq/cli@0.7.1", "--version"]);
  const version = await command(versionInvocation.executable, versionInvocation.args, {
    env,
    shell: versionInvocation.shell,
  });
  await writeFile(join(output, "runx-version-stdout.txt"), version.stdout);
  await writeFile(join(output, "runx-version-stderr.txt"), version.stderr);
  await writeFile(join(output, "runx-version-exit-code.txt"), `${version.exitCode}\n`);
  const versionOutput = version.stdout.toString("utf8").trim();
  if (version.exitCode !== 0 || versionOutput !== "runx-cli 0.7.1") {
    throw new Error(`runx version check failed: exit=${version.exitCode} output=${JSON.stringify(versionOutput)}`);
  }

  const seed = randomBytes(32);
  const privateDer = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed,
  ]);
  const privateKey = createPrivateKey({ key: privateDer, format: "der", type: "pkcs8" });
  const publicDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const publicKey = publicDer.subarray(publicDer.length - 32);
  const kid = `redsync-sourcey-local-${randomBytes(8).toString("hex")}`;
  Object.assign(env, {
    RUNX_RECEIPT_SIGN_KID: kid,
    RUNX_RECEIPT_SIGN_ED25519_SEED_BASE64: seed.toString("base64"),
    RUNX_RECEIPT_SIGN_ISSUER_TYPE: "ci",
    RUNX_RECEIPT_VERIFY_KID: kid,
    RUNX_RECEIPT_VERIFY_ED25519_PUBLIC_KEY_BASE64: publicKey.toString("base64"),
  });
  await writeFile(join(output, "verification-public-key.json"), `${JSON.stringify({
    schema_version: "redsync.runx-public-verification-key.v1",
    algorithm: "Ed25519",
    kid,
    issuer_type: "ci",
    public_key_base64: publicKey.toString("base64"),
  }, null, 2)}\n`);

  const runArgs = [
    "-y", "@runxhq/cli@0.7.1", "skill",
    "./validation-skill/redsync-sourcey-validation", "default",
    "-i", "public_url=https://redsync-sourcey-docs.readthedocs.io/en/latest/",
    "-i", "docs_repo_url=https://github.com/fengyangxxx/redsync-sourcey-docs",
    "-i", `docs_commit=${docsCommit}`,
    "-i", "target_repo_url=https://github.com/go-redsync/redsync",
    "-i", `target_commit=${targetCommit}`,
    "-i", "upstream_pr_url=https://github.com/go-redsync/redsync/pull/245",
    "-i", `upstream_pr_head_commit=${prHead}`,
    "-i", `mappings_url=https://raw.githubusercontent.com/fengyangxxx/redsync-sourcey-docs/${docsCommit}/evidence/page-source-mappings.json`,
    "-i", `runx_version_output=${versionOutput}`,
    "-i", "claimant_github_login=fengyangxxx",
    "-i", "validation_mode=live",
    "-i", "output_dir=artifacts",
    "-R", repoPath(receipts),
    "-j",
  ];
  await writeFile(
    join(output, "operator-context-command.txt"),
    `npx ${runArgs.map((arg) => JSON.stringify(arg)).join(" ")}\n`,
  );
  const operatorContextInvocation = resolveNpxInvocation(runArgs);
  runStarted = true;
  const operatorContext = await command(operatorContextInvocation.executable, operatorContextInvocation.args, {
    env,
    shell: operatorContextInvocation.shell,
  });
  await writeResult("runx-operator-context", operatorContext);
  const approvalArgs = operatorContextApprovalArgs(operatorContext.exitCode, operatorContext.stdout);
  const approvedRunArgs = [...runArgs, ...approvalArgs];
  await writeFile(
    join(output, "command.txt"),
    `npx ${approvedRunArgs.map((arg) => JSON.stringify(arg)).join(" ")}\n`,
  );
  const runInvocation = resolveNpxInvocation(approvedRunArgs);
  const run = await command(runInvocation.executable, runInvocation.args, {
    env,
    shell: runInvocation.shell,
  });
  await writeResult("runx-raw", run);
  await preserveSkillArtifacts();
  if (run.exitCode !== 0) throw new Error(`governed runx validation failed with exit ${run.exitCode}`);

  const extract = await command(process.execPath, [
    "./validation-skill/redsync-sourcey-validation/scripts/extract-root-receipt.mjs",
    "--run-json", repoPath(join(output, "runx-raw-stdout.json")),
    "--receipt-dir", repoPath(receipts),
    "--output-dir", repoPath(output),
  ]);
  await writeResult("root-receipt-resolution", extract);
  if (extract.exitCode !== 0) throw new Error(`root receipt extraction failed with exit ${extract.exitCode}`);

  const pack = await command(process.execPath, [
    "./validation-skill/redsync-sourcey-validation/scripts/receipt-tree-archive.mjs",
    "pack",
    "--receipt-dir", repoPath(receipts),
    "--receipt-tree", repoPath(join(output, "receipt-tree.json")),
    "--archive", repoPath(join(output, "runx-receipts.archive.json")),
  ]);
  await writeResult("receipt-archive-pack", pack);
  if (pack.exitCode !== 0) throw new Error(`receipt archive packaging failed with exit ${pack.exitCode}`);

  const archiveBytes = await readFile(join(output, "runx-receipts.archive.json"));
  const receiptTree = JSON.parse(await readFile(join(output, "receipt-tree.json"), "utf8"));
  const reconstructed = reconstructReceiptTreeArchive({ archiveBytes, receiptTree });
  await writeFile(join(output, "receipt-archive-reconstruction.json"), `${JSON.stringify({
    ...reconstructed.result,
    reconstruction_mismatch_count: 0,
  }, null, 2)}\n`);
  await writeFile(join(output, "receipt-archive-reconstruction-exit-code.txt"), "0\n");

  const verifyInvocation = resolveNpxInvocation([
    "-y", "@runxhq/cli@0.7.1", "verify",
    "--receipt-dir", repoPath(receipts),
    "-j",
  ]);
  const verify = await command(verifyInvocation.executable, verifyInvocation.args, {
    env,
    shell: verifyInvocation.shell,
  });
  await writeResult("runx-verify", verify);
  if (verify.exitCode !== 0) throw new Error(`runx receipt verification failed with exit ${verify.exitCode}`);

  const rawRun = JSON.parse(run.stdout.toString("utf8"));
  const verifyVerdict = parseRunxVerifyBytes(verify.stdout, rawRun.receipt_id);
  const evidence = JSON.parse(await readFile(join(output, "evidence.json"), "utf8"));
  const rootReference = JSON.parse(await readFile(join(output, "root-receipt-ref.json"), "utf8"));
  const star = evidence.checks.find((check) => check.id === "claimant_sourcey_star");
  if (evidence.status !== "PASS" || evidence.live_pass !== true || star?.status !== "PASS") {
    throw new Error("live evidence or public star check is not PASS");
  }
  const proof = {
    schema_version: "redsync.sourcey.local-capture-record.v1",
    status: "PASS",
    receipt_ref: rootReference.root_receipt_ref,
    issuer_scope: "local_declared_policy_nonfinal",
    final_proof_eligible: false,
    final_delivery_authorization: false,
    inputs: {
      docs_commit: docsCommit,
      target_commit: targetCommit,
      upstream_pr_url: "https://github.com/go-redsync/redsync/pull/245",
      upstream_pr_head_commit: prHead,
    },
    validation: {
      status: evidence.status,
      live_pass: evidence.live_pass,
      mode: evidence.validation_mode,
      checked_at: evidence.checked_at,
      evidence_path: "deliveries/shared-receipt/evidence.json",
      evidence_sha256: sha256(await readFile(join(output, "evidence.json"))),
      transcript_path: "deliveries/shared-receipt/transcript.txt",
      transcript_sha256: sha256(await readFile(join(output, "transcript.txt"))),
    },
    runx: {
      status: rawRun.status,
      exit_code: run.exitCode,
      version_output: versionOutput,
      raw_path: "deliveries/shared-receipt/runx-raw-stdout.json",
      raw_sha256: sha256(run.stdout),
    },
    verification: {
      exit_code: verify.exitCode,
      valid: true,
      mode: "receipt_directory",
      command: ["runx-cli@0.7.1", "verify", "--receipt-dir", "r", "-j"],
      output_path: "deliveries/shared-receipt/runx-verify-stdout.json",
      output_sha256: sha256(verify.stdout),
      public_key_path: "deliveries/shared-receipt/verification-public-key.json",
      replay_exit_code: verify.exitCode,
      replay_verdict_sha256: sha256(Buffer.from(JSON.stringify({
        signature_mode: verifyVerdict.signature_mode,
        trees: verifyVerdict.trees,
        unreadable_files: verifyVerdict.unreadable_files,
        valid: verifyVerdict.valid,
      }))),
    },
    receipt_tree: {
      status: receiptTree.receipt_status_audit.overall_status,
      path: "deliveries/shared-receipt/receipt-tree.json",
      tree_sha256: receiptTree.tree_sha256,
      file_count: receiptTree.file_count,
      parseable_json_count: receiptTree.receipt_status_audit.parseable_json_count,
      failed_json_count: receiptTree.receipt_status_audit.failed_json_count,
    },
    archive: {
      status: reconstructed.result.status,
      path: "deliveries/shared-receipt/runx-receipts.archive.json",
      sha256: sha256(archiveBytes),
      reconstructed_file_count: reconstructed.result.reconstructed_file_count,
      reconstruction_mismatch_count: 0,
    },
    star: star.observed,
  };
  await writeFile(join(output, "local-capture-record.json"), `${JSON.stringify(proof, null, 2)}\n`);
  await rm(receipts, { recursive: true, force: true });
  ownsRuntimeReceipts = false;
  await rm(skillArtifacts, { recursive: true, force: true });
  await writeFile(join(output, "manifest.json"), `${JSON.stringify({
    schema_version: "redsync.sourcey.shared-receipt-manifest.v1",
    files: await manifestFiles(output),
  }, null, 2)}\n`);
  process.stdout.write(`LOCAL_CAPTURE_NONFINAL ${proof.receipt_ref}\n`);
}

async function reportFailure(error) {
  await mkdir(output, { recursive: true });
  if (runStarted) await preserveSkillArtifacts();
  if (ownsRuntimeReceipts) {
    await rm(receipts, { recursive: true, force: true });
    ownsRuntimeReceipts = false;
  }
  if (runStarted) await rm(skillArtifacts, { recursive: true, force: true });
  const message = error instanceof Error ? error.message : String(error);
  await writeFile(join(output, "capture-error.json"), `${JSON.stringify({ status: "BLOCKED", error: message }, null, 2)}\n`);
  await writeFile(join(output, "manifest.json"), `${JSON.stringify({
    schema_version: "redsync.sourcey.shared-receipt-manifest.v1",
    status: "BLOCKED",
    files: await manifestFiles(output),
  }, null, 2)}\n`);
  process.stderr.write(`BLOCKED: ${message}\n`);
  process.exitCode = 1;
}

if (process.platform === "win32") {
  process.stderr.write("BLOCKED: native Windows receipt capture is unsupported; use the governed Linux CI workflow\n");
  process.exitCode = 1;
} else {
  main().catch(reportFailure);
}
