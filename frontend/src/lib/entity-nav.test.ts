import { beforeEach, describe, expect, it } from "vitest";
import { getPinned, getRecent, isPinned, togglePin, trackVisit, type NavEntity } from "./entity-nav";

const rocket: NavEntity = { kind: "Component", name: "rocket-api", title: "Rocket API", description: "d", lifecycle: "production" };
const payment: NavEntity = { kind: "Component", name: "payment-api", title: "Payment API", description: "d", lifecycle: "production" };

beforeEach(() => {
  localStorage.clear();
});

describe("recent entities", () => {
  it("starts empty", () => {
    expect(getRecent()).toEqual([]);
  });

  it("tracking a visit puts it first with a timestamp", () => {
    trackVisit(rocket);
    const recent = getRecent();
    expect(recent).toHaveLength(1);
    expect(recent[0].name).toBe("rocket-api");
    expect(typeof recent[0].visitedAt).toBe("number");
  });

  it("revisiting the same entity moves it to the front instead of duplicating", () => {
    trackVisit(rocket);
    trackVisit(payment);
    trackVisit(rocket);
    const recent = getRecent();
    expect(recent).toHaveLength(2);
    expect(recent[0].name).toBe("rocket-api");
    expect(recent[1].name).toBe("payment-api");
  });

  it("caps the list at 8 entries", () => {
    for (let i = 0; i < 10; i++) {
      trackVisit({ kind: "Component", name: `svc-${i}`, title: `svc-${i}`, description: "", lifecycle: "production" });
    }
    expect(getRecent()).toHaveLength(8);
    // Most recently visited (svc-9) stays, oldest (svc-0, svc-1) fall off.
    expect(getRecent()[0].name).toBe("svc-9");
  });
});

describe("pinned entities", () => {
  it("starts empty and unpinned", () => {
    expect(getPinned()).toEqual([]);
    expect(isPinned("Component", "rocket-api")).toBe(false);
  });

  it("togglePin pins an unpinned entity and returns true", () => {
    const result = togglePin(rocket);
    expect(result).toBe(true);
    expect(isPinned("Component", "rocket-api")).toBe(true);
    expect(getPinned()).toHaveLength(1);
  });

  it("togglePin unpins a pinned entity and returns false", () => {
    togglePin(rocket);
    const result = togglePin(rocket);
    expect(result).toBe(false);
    expect(isPinned("Component", "rocket-api")).toBe(false);
    expect(getPinned()).toHaveLength(0);
  });

  it("pinned entities are keyed by kind+name, not object identity", () => {
    togglePin(rocket);
    expect(isPinned("Component", "rocket-api")).toBe(true);
    expect(isPinned("API", "rocket-api")).toBe(false);
  });
});
