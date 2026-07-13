import { defineConfig, godoc, markdown } from "sourcey";

const redsyncCommit = "79f6ba24a8bf41f35141de700d410a06bb27622f";

export default defineConfig({
  name: "Redsync Sourcey API Documentation",
  description:
    "Sourcey-generated API documentation for go-redsync/redsync v4 at a pinned public commit.",
  repo: "https://github.com/go-redsync/redsync",
  editBranch: redsyncCommit,
  ogImage: `https://opengraph.githubassets.com/${redsyncCommit}/go-redsync/redsync`,
  theme: {
    colors: {
      primary: "#b42318",
    },
  },
  navigation: {
    tabs: [
      {
        tab: "Overview",
        slug: "",
        source: markdown({
          groups: [
            {
              group: "Project",
              pages: [
                "introduction",
                "reproduce",
                "hosting-decision",
                "maintainer-gap-analysis",
                "upstream-pr-rationale",
              ],
            },
          ],
        }),
      },
      {
        tab: "Go API",
        slug: "go-api",
        source: godoc({
          module: "./source/redsync",
          packages: ["./..."],
          snapshot: "./godoc.json",
          mode: "snapshot",
          includeTests: true,
          includeUnexported: false,
          sourceBasePath: "",
        }),
      },
    ],
  },
  navbar: {
    links: [
      { type: "github", href: "https://github.com/go-redsync/redsync" },
      {
        type: "custom",
        label: "Go Reference",
        href: "https://pkg.go.dev/github.com/go-redsync/redsync/v4",
      },
      {
        type: "custom",
        label: "Pinned Source",
        href: `https://github.com/go-redsync/redsync/tree/${redsyncCommit}`,
      },
    ],
  },
});
