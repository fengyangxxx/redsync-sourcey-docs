import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, "source", "redsync");
const output =
  process.env.SOURCEY_INVENTORY_OUTPUT ?? join(root, "evidence", "inventory.json");
const modulePath = (await readFile(join(sourceRoot, "go.mod"), "utf8"))
  .match(/^module\s+(\S+)/m)?.[1];

if (!modulePath) {
  throw new Error("go.mod does not declare a module");
}

async function goFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "vendor") continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await goFiles(fullPath)));
    if (entry.isFile() && entry.name.endsWith(".go") && !entry.name.endsWith("_test.go")) {
      result.push(fullPath);
    }
  }
  return result;
}

function exportedSymbols(contents, sourcePath) {
  const symbols = [];
  const lines = contents.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const declaration =
      line.match(/^\s*(type|var|const)\s+([A-Z][A-Za-z0-9_]*)\b/) ??
      line.match(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Z][A-Za-z0-9_]*)\b/);
    if (!declaration) continue;
    symbols.push({
      name: declaration[2] ?? declaration[1],
      kind: declaration[2] ? declaration[1] : "func",
      source_path: sourcePath,
      source_line: index + 1,
    });
  }
  return symbols;
}

const packageMap = new Map();
for (const fullPath of (await goFiles(sourceRoot)).sort()) {
  const sourcePath = relative(sourceRoot, fullPath).split(sep).join("/");
  const directory = dirname(sourcePath).split(sep).join("/");
  const contents = await readFile(fullPath, "utf8");
  const packageName = contents.match(/^package\s+(\w+)/m)?.[1];
  if (!packageName) throw new Error(`missing package declaration: ${sourcePath}`);

  const importPath = directory === "." ? modulePath : `${modulePath}/${directory}`;
  const record = packageMap.get(importPath) ?? {
    import_path: importPath,
    package_name: packageName,
    files: [],
    exported_symbols: [],
  };
  record.files.push(sourcePath);
  record.exported_symbols.push(...exportedSymbols(contents, sourcePath));
  packageMap.set(importPath, record);
}

const packages = [...packageMap.values()]
  .map((item) => ({
    ...item,
    files: item.files.sort(),
    exported_symbols: item.exported_symbols.sort((a, b) =>
      a.name.localeCompare(b.name) || a.source_path.localeCompare(b.source_path),
    ),
  }))
  .sort((a, b) => a.import_path.localeCompare(b.import_path));

const inventory = {
  schema_version: "redsync-sourcey-inventory/v1",
  repository: "https://github.com/go-redsync/redsync",
  commit: "79f6ba24a8bf41f35141de700d410a06bb27622f",
  module: modulePath,
  package_count: packages.length,
  non_test_go_file_count: packages.reduce((sum, item) => sum + item.files.length, 0),
  exported_symbol_count: packages.reduce(
    (sum, item) => sum + item.exported_symbols.length,
    0,
  ),
  packages,
};

await writeFile(
  output,
  `${JSON.stringify(inventory, null, 2)}\n`,
);

console.log(
  `inventory packages=${inventory.package_count} files=${inventory.non_test_go_file_count} exported_symbols=${inventory.exported_symbol_count}`,
);
