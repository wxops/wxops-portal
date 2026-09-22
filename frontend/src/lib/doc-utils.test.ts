import { describe, expect, it } from "vitest";
import { slugifyHeading } from "./doc-utils";

describe("slugifyHeading", () => {
  it("lowercases and joins words with hyphens", () => {
    expect(slugifyHeading("Getting Started")).toBe("getting-started");
  });

  it("strips punctuation but keeps word characters and hyphens", () => {
    expect(slugifyHeading("What's New? (v0.5.1)")).toBe("whats-new-v051");
  });

  it("unwraps inline code spans, keeping their content", () => {
    expect(slugifyHeading("The `wxops darlane sync` command")).toBe("the-wxops-darlane-sync-command");
  });

  it("collapses runs of whitespace/underscores into a single hyphen", () => {
    expect(slugifyHeading("foo   bar_baz")).toBe("foo-bar-baz");
  });

  it("trims leading/trailing whitespace before hyphenating", () => {
    expect(slugifyHeading("  Overview  ")).toBe("overview");
  });

  it("empty string yields an empty slug", () => {
    expect(slugifyHeading("")).toBe("");
  });
});
