import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`invalid argument pair at ${flag ?? "<end>"}`);
    }
    values[flag.slice(2)] = value;
  }
  for (const name of ["run-json", "receipt-dir", "output-dir"]) {
    if (!values[name]) throw new Error(`--${name} is required`);
  }
  return values;
}

async function collectFiles(root, directory = root) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const fullPath = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`receipt tree contains symlink: ${fullPath}`);
    if (entry.isDirectory()) files.push(...(await collectFiles(root, fullPath)));
    if (entry.isFile()) {
      files.push({
        fullPath,
        path: relative(root, fullPath).split(sep).join("/"),
      });
    }
  }
  return files;
}

async function writeBlocked(outputDir, error) {
  if (!outputDir) return;
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, "root-receipt-error.json"),
    `${JSON.stringify({
      schema: "redsync.root_receipt_error.v1",
      status: "BLOCKED",
      checked_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }, null, 2)}\n`,
  );
}

async function main() {
  let outputDir = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const runJsonPath = resolve(args["run-json"]);
    const receiptDir = resolve(args["receipt-dir"]);
    outputDir = resolve(args["output-dir"]);
    await mkdir(outputDir, { recursive: true });

    const runBytes = await readFile(runJsonPath);
    let run;
    try {
      run = JSON.parse(runBytes.toString("utf8"));
    } catch (error) {
      throw new Error(`runx raw JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }

    const rootReceiptId = run.receipt_id;
    if (run.schema !== "runx.skill_run.v1") {
      throw new Error(`unexpected runx raw schema: ${run.schema ?? "missing"}`);
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(rootReceiptId ?? "")) {
      throw new Error("runx raw JSON has no exact sha256 receipt_id");
    }
    if (run.receipt?.schema !== "runx.receipt.v1" || run.receipt?.id !== rootReceiptId) {
      throw new Error("runx raw receipt_id does not match embedded root receipt.id");
    }

    const treeFiles = await collectFiles(receiptDir);
    if (treeFiles.length === 0) throw new Error("receipt store is empty");

    const records = [];
    const rootMatches = [];
    for (const file of treeFiles) {
      const bytes = await readFile(file.fullPath);
      const record = {
        path: file.path,
        bytes: bytes.length,
        sha256: sha256(bytes),
      };
      if (file.path.endsWith(".json")) {
        try {
          const parsed = JSON.parse(bytes.toString("utf8"));
          if (typeof parsed.schema === "string") record.schema = parsed.schema;
          if (typeof parsed.id === "string") record.receipt_id = parsed.id;
          if (parsed.schema === "runx.receipt.v1" && parsed.id === rootReceiptId) {
            rootMatches.push({ ...file, bytes, parsed, record });
          }
        } catch {
          record.json_parse = "invalid";
        }
      }
      records.push(record);
    }

    if (rootMatches.length !== 1) {
      throw new Error(`root receipt match count must be 1, observed ${rootMatches.length}`);
    }
    const root = rootMatches[0];
    if (root.parsed.id !== rootReceiptId || root.parsed.schema !== "runx.receipt.v1") {
      throw new Error("located root receipt has inconsistent schema or id");
    }
    if (!isDeepStrictEqual(root.parsed, run.receipt)) {
      throw new Error("stored root receipt does not match the root receipt embedded in runx raw JSON");
    }

    const treeHash = sha256(Buffer.from(JSON.stringify(records), "utf8"));
    const receiptTree = {
      schema: "redsync.receipt_tree.v1",
      checked_at: new Date().toISOString(),
      root_receipt_id: rootReceiptId,
      root_receipt_ref: rootReceiptId,
      root_receipt_path: root.path,
      file_count: records.length,
      tree_sha256: treeHash,
      files: records,
    };
    const rootReference = {
      schema: "redsync.root_receipt_ref.v1",
      checked_at: receiptTree.checked_at,
      root_receipt_id: rootReceiptId,
      root_receipt_ref: rootReceiptId,
      root_receipt_path: root.path,
      root_receipt_sha256: root.record.sha256,
      runx_raw_schema: run.schema,
      runx_raw_sha256: sha256(runBytes),
      receipt_tree_file_count: records.length,
      receipt_tree_sha256: treeHash,
    };

    await writeFile(join(outputDir, "root-receipt-id.txt"), `${rootReceiptId}\n`);
    await writeFile(join(outputDir, "root-receipt-ref.txt"), `${rootReceiptId}\n`);
    await writeFile(join(outputDir, "root-receipt.json"), root.bytes);
    await writeFile(join(outputDir, "root-receipt-ref.json"), `${JSON.stringify(rootReference, null, 2)}\n`);
    await writeFile(join(outputDir, "receipt-tree.json"), `${JSON.stringify(receiptTree, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ status: "PASS", ...rootReference }, null, 2)}\n`);
  } catch (error) {
    await writeBlocked(outputDir, error);
    process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

await main();
