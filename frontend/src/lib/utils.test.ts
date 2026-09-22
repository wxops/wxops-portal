import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("joins plain class names with a space", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("lets a later Tailwind utility win over a conflicting earlier one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("drops falsy values", () => {
    expect(cn("px-2", false, undefined, null, "py-1")).toBe("px-2 py-1");
  });

  it("expands conditional object syntax", () => {
    expect(cn("base", { "text-red-500": true, "text-blue-500": false })).toBe(
      "base text-red-500",
    );
  });
});
