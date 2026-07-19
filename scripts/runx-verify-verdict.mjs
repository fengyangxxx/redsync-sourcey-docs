import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const resultKeys = ["receipt_dir", "signature_mode", "trees", "unreadable_files", "valid"];
const treeKeys = ["findings", "parent_missing", "receipt_count", "root_receipt_id", "valid"];

function sameKeys(value, expected) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function requireVerdict(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertRunxVerifyVerdict(value, expectedReceiptRef) {
  try {
    requireVerdict(value !== null && typeof value === "object" && !Array.isArray(value), "result must be an object");
    requireVerdict(sameKeys(value, resultKeys), "result fields do not match runx 0.7.1 output");
    requireVerdict(typeof value.receipt_dir === "string" && value.receipt_dir.length > 0, "receipt_dir is invalid");
    requireVerdict(value.signature_mode === "production", "signature_mode is not production");
    requireVerdict(value.valid === true, "top-level valid is not true");
    requireVerdict(Array.isArray(value.unreadable_files) && value.unreadable_files.length === 0, "unreadable receipt files exist");
    requireVerdict(Array.isArray(value.trees) && value.trees.length === 1, "exactly one receipt tree is required");
    const tree = value.trees[0];
    requireVerdict(tree !== null && typeof tree === "object" && !Array.isArray(tree), "tree must be an object");
    requireVerdict(sameKeys(tree, treeKeys), "tree fields do not match runx 0.7.1 output");
    requireVerdict(tree.root_receipt_id === expectedReceiptRef, "tree root does not match the expected receipt");
    requireVerdict(Number.isInteger(tree.receipt_count) && tree.receipt_count >= 1, "receipt_count is invalid");
    requireVerdict(tree.parent_missing === null, "receipt tree has a missing parent");
    requireVerdict(tree.valid === true, "receipt tree valid is not true");
    requireVerdict(Array.isArray(tree.findings) && tree.findings.length === 0, "receipt tree findings are not empty");
    return value;
  } catch (error) {
    throw new Error(`runx verify verdict is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseRunxVerifyBytes(bytes, expectedReceiptRef) {
  let value;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (error) {
    throw new Error(`runx verify verdict is invalid: JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return assertRunxVerifyVerdict(value, expectedReceiptRef);
}

function args(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) {
      throw new Error(`invalid argument pair at ${argv[index] ?? "<end>"}`);
    }
    values[argv[index]] = argv[index + 1];
  }
  if (!values["--input"] || !values["--receipt-ref"]) {
    throw new Error("--input and --receipt-ref are required");
  }
  return values;
}

async function main() {
  const flags = args(process.argv.slice(2));
  parseRunxVerifyBytes(await readFile(resolve(flags["--input"])), flags["--receipt-ref"]);
  process.stdout.write(`RUNX_VERIFY_VERDICT_PASS ${flags["--receipt-ref"]}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
