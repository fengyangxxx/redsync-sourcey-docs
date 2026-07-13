import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { repositoryLfBytes } from "./repository-bytes.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pin = "79f6ba24a8bf41f35141de700d410a06bb27622f";
const output =
  process.env.SOURCEY_MAPPINGS_OUTPUT ??
  join(root, "evidence", "page-source-mappings.json");
const specs = [
  {
    generated_page: "go-api/package-root.html",
    rendered_symbol: "Redsync",
    source_path: "redsync.go",
    source_line_pattern: "^type Redsync struct \\{",
    source_git_blob_sha1: "bfec2c9361f283b8f2fab5db25e7e584a4daab96",
  },
  {
    generated_page: "go-api/pkg-redis.html",
    rendered_symbol: "Pool",
    source_path: "redis/redis.go",
    source_line_pattern: "^type Pool interface \\{",
    source_git_blob_sha1: "cbae6772aec654bf09b31e2c5aa88b6019563446",
  },
  {
    generated_page: "go-api/pkg-redis-goredis-v9.html",
    rendered_symbol: "NewPool",
    source_path: "redis/goredis/v9/goredis.go",
    source_line_pattern: "^func NewPool\\(",
    source_git_blob_sha1: "8a29077d1e9a9075bb373a22bce20c2b44302ef7",
  },
  {
    generated_page: "go-api/pkg-redis-redigo.html",
    rendered_symbol: "NewPool",
    source_path: "redis/redigo/redigo.go",
    source_line_pattern: "^func NewPool\\(",
    source_git_blob_sha1: "127370be6926c23b242d818a8776562b2f70ba5c",
  },
  {
    generated_page: "go-api/pkg-redis-rueidis.html",
    rendered_symbol: "NewPool",
    source_path: "redis/rueidis/rueidis.go",
    source_line_pattern: "^func NewPool\\(",
    source_git_blob_sha1: "ce9601a298b24a67217bc250aa460fc3825e5cd9",
  },
];

const mappings = [];
for (const spec of specs) {
  const source = repositoryLfBytes(
    await readFile(join(root, "source", "redsync", spec.source_path)),
    spec.source_path,
  );
  const sourceText = source.toString("utf8");
  const gitBlobSha1 = createHash("sha1")
    .update(Buffer.from(`blob ${source.length}\0`, "utf8"))
    .update(source)
    .digest("hex");
  if (gitBlobSha1 !== spec.source_git_blob_sha1) {
    throw new Error(
      `pinned Git blob mismatch: ${spec.source_path} expected=${spec.source_git_blob_sha1} actual=${gitBlobSha1}`,
    );
  }
  const lines = sourceText.split("\n");
  const pattern = new RegExp(spec.source_line_pattern);
  const sourceLine = lines.findIndex((line) => pattern.test(line)) + 1;
  if (sourceLine < 1) throw new Error(`source declaration not found: ${spec.source_path}`);

  const page = await readFile(join(root, "dist", spec.generated_page));
  if (!page.toString("utf8").includes(spec.rendered_symbol)) {
    throw new Error(`rendered symbol missing: ${spec.generated_page} -> ${spec.rendered_symbol}`);
  }

  mappings.push({
    ...spec,
    source_line: sourceLine,
    source_url: `https://github.com/go-redsync/redsync/blob/${pin}/${spec.source_path}#L${sourceLine}`,
    source_sha256: createHash("sha256").update(source).digest("hex"),
    generated_page_sha256: createHash("sha256").update(page).digest("hex"),
  });
}

await writeFile(
  output,
  `${JSON.stringify(mappings, null, 2)}\n`,
);

console.log(`page-source mappings=${mappings.length}`);
