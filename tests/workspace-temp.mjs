import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after } from "node:test";

export const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
export const workspaceRoot = resolve(repoRoot, "../..");
export const testTempRoot = assertWorkspacePath(join(
  workspaceRoot,
  "scratch",
  "frantic113-redsync-workflow-repair-tests",
  String(process.pid),
));

export function assertWorkspacePath(path) {
  const absolute = resolve(path);
  const rel = relative(workspaceRoot, absolute);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`test path escapes workspace: ${absolute}`);
  }
  return absolute;
}

await mkdir(testTempRoot, { recursive: true });

export async function makeWorkspaceTemp(prefix) {
  const path = await mkdtemp(join(testTempRoot, prefix));
  return assertWorkspacePath(path);
}

export function workspaceTempPath(...parts) {
  return assertWorkspacePath(join(testTempRoot, ...parts));
}

after(async () => {
  await rm(testTempRoot, { recursive: true, force: true });
});
