import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { reconstructReceiptTreeArchive } from "../validation-skill/redsync-sourcey-validation/scripts/receipt-tree-archive.mjs";
import { resolveNpxInvocation } from "./npx-invocation.mjs";
import { assertRunxVerifyVerdict } from "./runx-verify-verdict.mjs";

const receiptFilename = /^sha256[:\-]([0-9a-f]{64})\.json$/;

function safeOutputPath(root, logicalPath) {
  const parts = logicalPath.split("/");
  const basename = parts.at(-1);
  const match = receiptFilename.exec(basename);
  if (match) parts[parts.length - 1] = `sha256-${match[1]}.json`;
  const destination = resolve(root, ...parts);
  const rel = relative(root, destination);
  assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel), `receipt path escapes output: ${logicalPath}`);
  return destination;
}

export async function reconstructReceiptDirectory({ archiveBytes, receiptTree, outputDir }) {
  const reconstructed = reconstructReceiptTreeArchive({ archiveBytes, receiptTree });
  const destinations = new Set();
  for (const file of reconstructed.files) {
    const destination = safeOutputPath(resolve(outputDir), file.path);
    if (destinations.has(destination)) throw new Error(`receipt filename collision: ${file.path}`);
    destinations.add(destination);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content);
  }
  if (destinations.size !== receiptTree.file_count) {
    throw new Error("reconstructed receipt directory file count mismatch");
  }
  return reconstructed;
}

export async function runxVerifyReceiptDirectory({ receiptDir, key, cwd }) {
  assert.equal(key.algorithm, "Ed25519");
  assert.match(key.kid, /\S/);
  assert.match(key.public_key_base64, /^[A-Za-z0-9+/]+={0,2}$/);
  const env = {
    ...process.env,
    npm_config_cache: join(cwd, "node_modules", ".npm-cache"),
    RUNX_RECEIPT_VERIFY_KID: key.kid,
    RUNX_RECEIPT_VERIFY_ED25519_PUBLIC_KEY_BASE64: key.public_key_base64,
  };
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
  delete env.RUNX_TOKEN;
  const invocation = resolveNpxInvocation([
    "-y", "@runxhq/cli@0.7.1", "verify", "--receipt-dir", resolve(receiptDir), "-j",
  ]);
  const child = spawn(invocation.executable, invocation.args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: invocation.shell,
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

export function receiptDirectoryVerdictIdentity(result) {
  const { signature_mode, trees, unreadable_files, valid } = result;
  return { signature_mode, trees, unreadable_files, valid };
}

export function assertEquivalentReceiptDirectoryVerdicts(recorded, replayed, receiptId) {
  const left = assertRunxVerifyVerdict(recorded, receiptId);
  const right = assertRunxVerifyVerdict(replayed, receiptId);
  assert.deepEqual(
    receiptDirectoryVerdictIdentity(left),
    receiptDirectoryVerdictIdentity(right),
    "recorded runx verdict differs from fresh receipt-directory verification",
  );
  return right;
}

export async function withReconstructedReceiptDirectory({
  archiveBytes,
  receiptTree,
  workspaceRoot,
}, callback) {
  const parent = join(workspaceRoot, "node_modules");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, ".receipt-directory-verify-"));
  try {
    const reconstructed = await reconstructReceiptDirectory({ archiveBytes, receiptTree, outputDir: directory });
    return await callback(directory, reconstructed);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
