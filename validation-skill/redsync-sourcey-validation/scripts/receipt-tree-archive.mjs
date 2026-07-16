import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  const [command, ...pairs] = argv;
  if (!new Set(["pack", "extract"]).has(command)) {
    throw new Error("first argument must be pack or extract");
  }
  const values = {};
  for (let index = 0; index < pairs.length; index += 2) {
    const flag = pairs[index];
    const value = pairs[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`invalid argument pair at ${flag ?? "<end>"}`);
    }
    values[flag.slice(2)] = value;
  }
  return { command, values };
}

function safeArchivePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    value.includes("\0") ||
    isAbsolute(value) ||
    value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`unsafe receipt archive path: ${JSON.stringify(value)}`);
  }
  return value;
}

async function collectFiles(root, directory = root) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    const fullPath = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`receipt tree contains symlink: ${fullPath}`);
    if (entry.isDirectory()) files.push(...(await collectFiles(root, fullPath)));
    if (entry.isFile()) {
      files.push({
        fullPath,
        path: safeArchivePath(relative(root, fullPath).split(sep).join("/")),
      });
    }
  }
  return files;
}

function validateTree(tree) {
  if (tree?.schema !== "redsync.receipt_tree.v1") {
    throw new Error(`unexpected receipt tree schema: ${tree?.schema ?? "missing"}`);
  }
  if (!Array.isArray(tree.files) || tree.files.length !== tree.file_count) {
    throw new Error("receipt tree file count is inconsistent");
  }
  if (!/^[0-9a-f]{64}$/.test(tree.tree_sha256 ?? "")) {
    throw new Error("receipt tree has no valid tree_sha256");
  }
  const paths = tree.files.map((file) => {
    const path = safeArchivePath(file.path);
    if (!Number.isInteger(file.bytes) || file.bytes < 0) {
      throw new Error(`receipt tree has invalid byte count for ${path}`);
    }
    if (!/^[0-9a-f]{64}$/.test(file.sha256 ?? "")) {
      throw new Error(`receipt tree has invalid SHA-256 for ${path}`);
    }
    return path;
  });
  if (new Set(paths).size !== paths.length) throw new Error("receipt tree contains duplicate paths");
  if (sha256(Buffer.from(JSON.stringify(tree.files), "utf8")) !== tree.tree_sha256) {
    throw new Error("receipt tree hash does not match its file records");
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(tree.root_receipt_id ?? "")) {
    throw new Error("receipt tree has no exact root receipt id");
  }
  const rootPath = safeArchivePath(tree.root_receipt_path);
  const roots = tree.files.filter((file) => file.path === rootPath);
  if (roots.length !== 1 || roots[0].receipt_id !== tree.root_receipt_id) {
    throw new Error("receipt tree root path and id are inconsistent");
  }
  const auditedFiles = tree.files
    .filter((file) => file.json_parse === "parsed")
    .map((file) => ({ path: file.path, ...file.status_audit }));
  const failedFiles = auditedFiles.filter((file) => file.status !== "PASS");
  const audit = tree.receipt_status_audit;
  if (
    audit?.schema !== "redsync.receipt_status_audit.v1" ||
    audit.overall_status !== "PASS" ||
    audit.parseable_json_count !== auditedFiles.length ||
    audit.failed_json_count !== failedFiles.length ||
    failedFiles.length !== 0 ||
    JSON.stringify(audit.files) !== JSON.stringify(auditedFiles)
  ) {
    throw new Error("receipt tree status audit is missing, blocked, or inconsistent");
  }
}

function parseArchiveBytes(bytes) {
  let archive;
  try {
    archive = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`receipt archive JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (archive?.schema !== "redsync.receipt_tree_archive.v1") {
    throw new Error(`unexpected receipt archive schema: ${archive?.schema ?? "missing"}`);
  }
  if (!Array.isArray(archive.files) || archive.files.length !== archive.file_count) {
    throw new Error("receipt archive file count is inconsistent");
  }
  if (!/^[0-9a-f]{64}$/.test(archive.receipt_tree_sha256 ?? "")) {
    throw new Error("receipt archive has no valid receipt_tree_sha256");
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(archive.root_receipt_id ?? "")) {
    throw new Error("receipt archive has no exact root receipt id");
  }
  if (
    archive.receipt_status_audit?.schema !== "redsync.receipt_status_audit.v1" ||
    archive.receipt_status_audit.overall_status !== "PASS" ||
    archive.receipt_status_audit.failed_json_count !== 0
  ) {
    throw new Error("receipt archive status audit is missing or blocked");
  }
  safeArchivePath(archive.root_receipt_path);
  const seen = new Set();
  const decoded = archive.files.map((file) => {
    const safePath = safeArchivePath(file.path);
    if (seen.has(safePath)) throw new Error(`receipt archive contains duplicate path: ${safePath}`);
    seen.add(safePath);
    if (!/^[0-9a-f]{64}$/.test(file.sha256 ?? "")) {
      throw new Error(`receipt archive has invalid SHA-256 for ${safePath}`);
    }
    if (typeof file.content_base64 !== "string") {
      throw new Error(`receipt archive has no base64 content for ${safePath}`);
    }
    const content = Buffer.from(file.content_base64, "base64");
    if (content.toString("base64") !== file.content_base64) {
      throw new Error(`receipt archive has non-canonical base64 for ${safePath}`);
    }
    if (content.length !== file.bytes || sha256(content) !== file.sha256) {
      throw new Error(`receipt archive byte metadata mismatch for ${safePath}`);
    }
    return { ...file, path: safePath, content };
  });
  if (!decoded.some((file) => file.path === archive.root_receipt_path)) {
    throw new Error("receipt archive does not contain its root receipt path");
  }
  return { archive, archiveBytes: bytes, decoded };
}

export function createReceiptTreeArchive({ receiptTree, files }) {
  validateTree(receiptTree);
  const expected = new Map(
    receiptTree.files.map((file) => [safeArchivePath(file.path), file]),
  );
  const supplied = files
    .map((file) => ({ path: safeArchivePath(file.path), content: Buffer.from(file.content) }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (supplied.length !== expected.size || new Set(supplied.map((file) => file.path)).size !== supplied.length) {
    throw new Error(`receipt source file count mismatch: expected ${expected.size}, observed ${supplied.length}`);
  }
  const archivedFiles = supplied.map((file) => {
    const expectedFile = expected.get(file.path);
    if (!expectedFile) throw new Error(`receipt source path is absent from tree: ${file.path}`);
    const digest = sha256(file.content);
    if (file.content.length !== expectedFile.bytes || digest !== expectedFile.sha256) {
      throw new Error(`receipt source bytes do not match tree: ${file.path}`);
    }
    return {
      path: file.path,
      bytes: file.content.length,
      sha256: digest,
      content_base64: file.content.toString("base64"),
    };
  });
  const archive = {
    schema: "redsync.receipt_tree_archive.v1",
    encoding: "base64",
    receipt_tree_sha256: receiptTree.tree_sha256,
    root_receipt_id: receiptTree.root_receipt_id,
    root_receipt_path: receiptTree.root_receipt_path,
    receipt_status_audit: receiptTree.receipt_status_audit,
    file_count: archivedFiles.length,
    files: archivedFiles,
  };
  const archiveBytes = Buffer.from(`${JSON.stringify(archive, null, 2)}\n`);
  return {
    archive,
    archiveBytes,
    result: {
      status: "PASS",
      archive_bytes: archiveBytes.length,
      archive_sha256: sha256(archiveBytes),
      receipt_tree_sha256: receiptTree.tree_sha256,
      root_receipt_id: receiptTree.root_receipt_id,
      root_receipt_path: receiptTree.root_receipt_path,
      receipt_status_audit: receiptTree.receipt_status_audit,
      file_count: archivedFiles.length,
    },
  };
}

export function reconstructReceiptTreeArchive({ archiveBytes, receiptTree }) {
  const { archive, decoded } = parseArchiveBytes(Buffer.from(archiveBytes));
  if (receiptTree) {
    validateTree(receiptTree);
    if (
      receiptTree.tree_sha256 !== archive.receipt_tree_sha256 ||
      receiptTree.file_count !== archive.file_count ||
      receiptTree.root_receipt_id !== archive.root_receipt_id ||
      receiptTree.root_receipt_path !== archive.root_receipt_path ||
      JSON.stringify(receiptTree.receipt_status_audit) !== JSON.stringify(archive.receipt_status_audit)
    ) {
      throw new Error("receipt archive does not match the expected receipt tree identity");
    }
    const expected = new Map(
      receiptTree.files.map((file) => [safeArchivePath(file.path), file]),
    );
    for (const file of decoded) {
      const expectedFile = expected.get(file.path);
      if (!expectedFile || expectedFile.bytes !== file.bytes || expectedFile.sha256 !== file.sha256) {
        throw new Error(`receipt archive entry does not match expected tree: ${file.path}`);
      }
    }
  }
  return {
    archive,
    files: decoded.map((file) => ({ path: file.path, content: file.content })),
    result: {
      status: "PASS",
      archive_sha256: sha256(Buffer.from(archiveBytes)),
      receipt_tree_sha256: archive.receipt_tree_sha256,
      root_receipt_id: archive.root_receipt_id,
      root_receipt_path: archive.root_receipt_path,
      receipt_status_audit: archive.receipt_status_audit,
      reconstructed_file_count: decoded.length,
    },
  };
}

export async function packReceiptTree({ receiptDir, receiptTreePath, archivePath }) {
  const root = resolve(receiptDir);
  const tree = JSON.parse(await readFile(receiptTreePath, "utf8"));
  const sourceFiles = await collectFiles(root);
  const files = [];
  for (const file of sourceFiles) {
    files.push({ path: file.path, content: await readFile(file.fullPath) });
  }
  const packed = createReceiptTreeArchive({ receiptTree: tree, files });
  await mkdir(dirname(resolve(archivePath)), { recursive: true });
  await writeFile(archivePath, packed.archiveBytes);
  return {
    ...packed.result,
    archive_path: resolve(archivePath),
  };
}

export async function extractReceiptTree({ archivePath, outputDir, receiptTreePath }) {
  const archiveBytes = await readFile(archivePath);
  const tree = receiptTreePath ? JSON.parse(await readFile(receiptTreePath, "utf8")) : undefined;
  const reconstructedArchive = reconstructReceiptTreeArchive({ archiveBytes, receiptTree: tree });

  const root = resolve(outputDir);
  await mkdir(root, { recursive: true });
  for (const file of reconstructedArchive.files) {
    const destination = resolve(root, ...file.path.split("/"));
    const relativeDestination = relative(root, destination);
    if (relativeDestination.startsWith("..") || isAbsolute(relativeDestination)) {
      throw new Error(`receipt archive path escapes output directory: ${file.path}`);
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content);
  }

  const reconstructed = await collectFiles(root);
  if (reconstructed.length !== reconstructedArchive.files.length) {
    throw new Error("reconstructed receipt file count mismatch");
  }
  const expected = new Map(reconstructedArchive.files.map((file) => [file.path, file]));
  for (const file of reconstructed) {
    const bytes = await readFile(file.fullPath);
    const archived = expected.get(file.path);
    if (!archived || !bytes.equals(archived.content)) {
      throw new Error(`reconstructed receipt bytes mismatch: ${file.path}`);
    }
  }
  return reconstructedArchive.result;
}

async function main() {
  const { command, values } = parseArgs(process.argv.slice(2));
  const result = command === "pack"
    ? await packReceiptTree({
        receiptDir: values["receipt-dir"],
        receiptTreePath: values["receipt-tree"],
        archivePath: values.archive,
      })
    : await extractReceiptTree({
        archivePath: values.archive,
        outputDir: values["output-dir"],
        receiptTreePath: values["receipt-tree"],
      });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
