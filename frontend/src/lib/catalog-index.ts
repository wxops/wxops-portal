// Module-level singleton — survives re-renders and client-side navigation.
// Rebuilt on first CommandPalette open, or when older than INDEX_TTL.
// Cleared only on full page reload.

import { Document } from "flexsearch";

export interface IndexedEntity {
  id: number;
  name: string;
  title: string;
  description: string;
  tags: string;
  kind: string;
  owner: string;
  lifecycle: string;
  system: string;
  // Index signature required by FlexSearch's DocumentData constraint
  [key: string]: unknown;
}

interface RawEntity {
  kind: string;
  metadata: {
    name: string;
    title?: string;
    description?: string;
    tags?: string[];
  };
  spec?: {
    owner?: string;
    lifecycle?: string;
    system?: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FlexDoc = Document<any, any>;

const INDEX_TTL = 5 * 60 * 1000; // 5 minutes — matches backend cache TTL

let flexIndex: FlexDoc | null = null;
let indexedEntities: IndexedEntity[] = [];
let builtAt = 0;
let building: Promise<void> | null = null;

async function build(): Promise<void> {
  let raw: RawEntity[] = [];
  try {
    const res = await fetch("/api/catalog/entities?limit=0", {
      credentials: "include",
    });
    if (res.ok) {
      const data = await res.json();
      raw = data.entities ?? [];
    }
  } catch {
    // Network error — leave index empty so palette shows an error state
  }

  const doc: FlexDoc = new Document({
    tokenize: "forward",
    document: {
      id: "id",
      index: ["name", "title", "description", "tags"],
      store: true,
    },
  });

  indexedEntities = raw.map((e, i) => ({
    id: i,
    name: e.metadata.name,
    title: e.metadata.title ?? e.metadata.name,
    description: e.metadata.description ?? "",
    tags: (e.metadata.tags ?? []).join(" "),
    kind: e.kind,
    owner: e.spec?.owner ?? "",
    lifecycle: e.spec?.lifecycle ?? "",
    system: e.spec?.system ?? "",
  }));

  for (const entity of indexedEntities) {
    doc.add(entity);
  }

  flexIndex = doc;
  builtAt = Date.now();
}

/** Returns the search function, building the index first if needed. */
export async function getCatalogSearch(): Promise<
  (query: string, limit?: number) => IndexedEntity[]
> {
  const isStale = Date.now() - builtAt > INDEX_TTL;

  if (flexIndex && indexedEntities.length > 0 && !isStale) {
    return searchFn;
  }

  if (!building) {
    building = build().finally(() => { building = null; });
  }

  await building;
  return searchFn;
}

/** Force the index to rebuild on the next open (e.g. after a catalog write). */
export function invalidateCatalogIndex(): void {
  flexIndex = null;
  indexedEntities = [];
  builtAt = 0;
}

function searchFn(query: string, limit = 8): IndexedEntity[] {
  if (!flexIndex || !query.trim()) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = flexIndex.search(query, { limit, enrich: true }) as any[];
  const seen = new Set<number>();
  const merged: IndexedEntity[] = [];

  for (const fieldResult of raw) {
    for (const item of fieldResult.result ?? []) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item.doc as IndexedEntity);
      }
    }
  }

  return merged.slice(0, limit);
}
