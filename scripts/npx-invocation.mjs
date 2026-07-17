import { dirname, join } from "node:path";

export function operatorContextApprovalArgs(exitCode, stdout) {
  let response;
  try {
    response = JSON.parse(Buffer.from(stdout).toString("utf8"));
  } catch {
    throw new Error("invalid operator-context approval response");
  }
  const digest = response?.digest;
  if (
    !Number.isInteger(exitCode) ||
    exitCode === 0 ||
    response?.status !== "needs_operator_approval" ||
    !/^sha256:[0-9a-f]{64}$/.test(digest ?? "") ||
    response?.approval_flag !== `--approve-operator-context ${digest}`
  ) {
    throw new Error("invalid operator-context approval response");
  }
  return ["--approve-operator-context", digest];
}

export function resolveNpxInvocation(args, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return { executable: "npx", args: [...args], shell: false };
  }
  const execPath = options.execPath ?? process.execPath;
  return {
    executable: execPath,
    args: [join(dirname(execPath), "node_modules", "npm", "bin", "npx-cli.js"), ...args],
    shell: false,
  };
}
