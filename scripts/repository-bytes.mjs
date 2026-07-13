export function repositoryLfBytes(bytes, path = "source") {
  const source = Buffer.from(bytes).toString("utf8");
  const withoutCrLf = source.replaceAll("\r\n", "");
  if (withoutCrLf.includes("\r")) {
    throw new Error(`unsupported bare CR in source: ${path}`);
  }
  return Buffer.from(source.replaceAll("\r\n", "\n"), "utf8");
}
