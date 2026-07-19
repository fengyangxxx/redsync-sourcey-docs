export function assertPinnedActionRefs(source) {
  const refs = [...source.matchAll(/^\s*(?:-\s*)?uses:\s+([^\s#]+)(?:\s+#.*)?$/gm)]
    .map((match) => match[1])
    .filter((ref) => !ref.startsWith("./"));
  if (refs.length === 0) throw new Error("workflow contains no external action references");
  for (const ref of refs) {
    if (!/^[^/@\s]+\/[^@\s]+@[0-9a-f]{40}$/.test(ref)) {
      throw new Error(`action ref must end in an exact 40-character lowercase commit ID: ${ref}`);
    }
  }
  return refs;
}
