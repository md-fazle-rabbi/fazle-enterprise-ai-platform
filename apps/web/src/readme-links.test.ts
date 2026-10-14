// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../", import.meta.url);
const README = readFileSync(new URL("README.md", ROOT), "utf8");

// Why: the README names files as evidence, and a link that goes nowhere reads as a claim
// with nothing behind it. Only paths inside this repository are checked, not web addresses.
function repoPaths(): string[] {
  const links = [...README.matchAll(/\]\((?!https?:|mailto:|#)([^)\s#]+)(?:#[^)\s]*)?\)/g)].map(
    (match) => match[1],
  );
  const named = [...README.matchAll(/`((?:proof|docs|packages|apps)\/[^`\s*<>{}]+)`/g)].map(
    (match) => match[1],
  );
  return [...new Set([...links, ...named])].filter((path): path is string => path !== undefined);
}

describe("README", () => {
  it("finds the paths it should check", () => {
    // Why: guards the guard. A regex that stopped matching would pass the test below with
    // nothing to check.
    expect(repoPaths().length).toBeGreaterThan(30);
  });

  it("points only at files that exist in the repository", () => {
    const missing = repoPaths().filter((path) => !existsSync(new URL(path, ROOT)));
    expect(missing).toEqual([]);
  });
});
