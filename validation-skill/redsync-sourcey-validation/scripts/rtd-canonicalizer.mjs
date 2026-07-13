import { createHash } from "node:crypto";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function countOccurrences(bytes, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= bytes.length - needle.length) {
    const index = bytes.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + needle.length;
  }
  return count;
}

export function readTheDocsAddonFragment(pageUrl, publicRootUrl, projectSlug) {
  const page = new URL(pageUrl);
  const root = new URL(publicRootUrl);
  const hostMatch = /^([a-z0-9-]+)\.readthedocs\.io$/i.exec(root.hostname);
  const rootMatch = /^\/[^/]+\/([^/]+)\/$/.exec(root.pathname);
  if (!hostMatch || hostMatch[1] !== projectSlug) {
    throw new Error("public host does not bind to the documentation repository slug");
  }
  if (!rootMatch) throw new Error("public root must use the /<language>/<version>/ Read the Docs shape");
  if (page.origin !== root.origin || !page.pathname.startsWith(root.pathname)) {
    throw new Error("public page is outside the declared Read the Docs root");
  }

  const relativePath = page.pathname.slice(root.pathname.length);
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("..")) {
    throw new Error("public page has an invalid resolver path");
  }
  const identity = {
    script_src: "/_/static/javascript/readthedocs-addons.js",
    project_slug: projectSlug,
    version_slug: rootMatch[1],
    resolver_filename: `/${relativePath}`,
    http_status: "200",
    insertion_boundary: "immediately_before_closing_head",
  };
  const fragment =
    `<script async type="text/javascript" src="${identity.script_src}"></script>` +
    `<meta name="readthedocs-project-slug" content="${identity.project_slug}" />` +
    `<meta name="readthedocs-version-slug" content="${identity.version_slug}" />` +
    `<meta name="readthedocs-resolver-filename" content="${identity.resolver_filename}" />` +
    `<meta name="readthedocs-http-status" content="${identity.http_status}" />`;
  return { fragment, identity };
}

export function canonicalizeReadTheDocsPage(publicBytes, pageUrl, publicRootUrl, projectSlug) {
  const base = {
    recognized: false,
    removed_fragment_count: 0,
    removed_fragment_bytes: 0,
    removed_fragment_sha256: null,
    removed_fragment_identity: null,
    marker_counts: {},
    canonical_bytes: null,
    error: null,
  };

  try {
    const { fragment, identity } = readTheDocsAddonFragment(
      pageUrl,
      publicRootUrl,
      projectSlug,
    );
    const fragmentBytes = Buffer.from(fragment, "utf8");
    const boundaryBytes = Buffer.from(`${fragment}</head>`, "utf8");
    const markers = [
      "readthedocs-addons.js",
      "readthedocs-project-slug",
      "readthedocs-version-slug",
      "readthedocs-resolver-filename",
      "readthedocs-http-status",
    ];
    const markerCounts = Object.fromEntries(
      markers.map((marker) => [marker, countOccurrences(publicBytes, Buffer.from(marker, "utf8"))]),
    );
    const fragmentCount = countOccurrences(publicBytes, fragmentBytes);
    const boundaryCount = countOccurrences(publicBytes, boundaryBytes);
    const recognized =
      fragmentCount === 1 &&
      boundaryCount === 1 &&
      Object.values(markerCounts).every((count) => count === 1);
    if (!recognized) {
      return {
        ...base,
        removed_fragment_count: fragmentCount,
        removed_fragment_identity: identity,
        marker_counts: markerCounts,
        error: "expected exactly one recognized RTD addon immediately before </head>",
      };
    }

    const index = publicBytes.indexOf(fragmentBytes);
    const canonicalBytes = Buffer.concat([
      publicBytes.subarray(0, index),
      publicBytes.subarray(index + fragmentBytes.length),
    ]);
    return {
      ...base,
      recognized: true,
      removed_fragment_count: 1,
      removed_fragment_bytes: fragmentBytes.length,
      removed_fragment_sha256: sha256(fragmentBytes),
      removed_fragment_identity: identity,
      marker_counts: markerCounts,
      canonical_bytes: canonicalBytes,
    };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
}
