import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  },
  {
    generated_page: "go-api/pkg-redis.html",
    rendered_symbol: "Pool",
    source_path: "redis/redis.go",
    source_line_pattern: "^type Pool interface \\{",
  },
  {
    generated_page: "go-api/pkg-redis-goredis-v9.html",
    rendered_symbol: "NewPool",
    source_path: "redis/goredis/v9/goredis.go",
    source_line_pattern: "^func NewPool\\(",
  },
  {
    generated_page: "go-api/pkg-redis-redigo.html",
    rendered_symbol: "NewPool",
    source_path: "redis/redigo/redigo.go",
    source_line_pattern: "^func NewPool\\(",
  },
  {
    generated_page: "go-api/pkg-redis-rueidis.html",
    rendered_symbol: "NewPool",
    source_path: "redis/rueidis/rueidis.go",
    source_line_pattern: "^func NewPool\\(",
  },
];

const mappings = [];
for (const spec of specs) {
  const source = await readFile(join(root, "source", "redsync", spec.source_path), "utf8");
  const lines = source.split(/\r?\n/);
  const pattern = new RegExp(spec.source_line_pattern);
  const sourceLine = lines.findIndex((line) => pattern.test(line)) + 1;
  if (sourceLine < 1) throw new Error(`source declaration not found: ${spec.source_path}`);

  const page = await readFile(join(root, "dist", spec.generated_page), "utf8");
  if (!page.includes(spec.rendered_symbol)) {
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
