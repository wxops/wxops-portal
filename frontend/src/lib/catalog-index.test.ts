import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCatalogSearch, invalidateCatalogIndex } from "./catalog-index";

function mockEntities(entities: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ entities }),
    }),
  );
}

const rocket = {
  kind: "Component",
  metadata: { name: "rocket-api", title: "Rocket API", description: "Handles rocket launches", tags: ["go", "payments"] },
  spec: { owner: "group:rocket-team", lifecycle: "production", system: "rocket-platform" },
};
const payment = {
  kind: "Component",
  metadata: { name: "payment-api", description: "Payment processing" },
  spec: { owner: "group:payments-team" },
};

beforeEach(() => {
  invalidateCatalogIndex();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getCatalogSearch", () => {
  it("builds an index from the catalog entities endpoint and finds by name", async () => {
    mockEntities([rocket, payment]);
    const search = await getCatalogSearch();
    const results = search("rocket");
    expect(results.some((r) => r.name === "rocket-api")).toBe(true);
  });

  it("finds by tag", async () => {
    mockEntities([rocket, payment]);
    const search = await getCatalogSearch();
    const results = search("payments");
    expect(results.some((r) => r.name === "rocket-api")).toBe(true);
  });

  it("missing optional fields default sensibly (title falls back to name)", async () => {
    mockEntities([payment]);
    const search = await getCatalogSearch();
    const results = search("payment-api");
    expect(results[0].title).toBe("payment-api");
    expect(results[0].tags).toBe("");
    expect(results[0].system).toBe("");
  });

  it("empty query returns no results", async () => {
    mockEntities([rocket]);
    const search = await getCatalogSearch();
    expect(search("")).toEqual([]);
    expect(search("   ")).toEqual([]);
  });

  it("a network failure leaves the index empty rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const search = await getCatalogSearch();
    expect(search("rocket")).toEqual([]);
  });

  it("invalidateCatalogIndex forces a rebuild reflecting new data on the next call", async () => {
    mockEntities([rocket]);
    let search = await getCatalogSearch();
    expect(search("nonexistent-service-xyz")).toEqual([]);
    expect(search("payment").some((r) => r.name === "payment-api")).toBe(false);

    invalidateCatalogIndex();
    mockEntities([payment]);
    search = await getCatalogSearch();
    expect(search("payment").some((r) => r.name === "payment-api")).toBe(true);
  });

  it("respects the limit parameter", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      kind: "Component",
      metadata: { name: `rocket-svc-${i}` },
      spec: {},
    }));
    mockEntities(many);
    const search = await getCatalogSearch();
    expect(search("rocket", 3)).toHaveLength(3);
  });
});
