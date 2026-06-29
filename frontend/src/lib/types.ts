/**
 * Normalize an entity ref to "kind:name" for comparison.
 * Strips the namespace segment since entities may use "", "default",
 * or a custom namespace inconsistently (e.g. "api:platform/portal-api"
 * vs "api:default/portal-api").
 */
function normalizeRef(ref: string): string {
  const colonIdx = ref.indexOf(":");
  if (colonIdx < 0) return ref.toLowerCase();
  const kind = ref.slice(0, colonIdx).toLowerCase();
  const rest = ref.slice(colonIdx + 1);
  const slashIdx = rest.indexOf("/");
  const name = slashIdx >= 0 ? rest.slice(slashIdx + 1) : rest;
  return `${kind}:${name}`;
}

/**
 * Check if a doc's relatedTo array includes a ref that matches the given
 * entity ref, ignoring namespace differences.
 */
export function relatedToIncludes(relatedTo: string[] | undefined, entityRef: string): boolean {
  if (!relatedTo) return false;
  const norm = normalizeRef(entityRef);
  return relatedTo.some((r) => normalizeRef(r) === norm);
}

/**
 * Check if a doc's relatedTo array includes any ref from a set,
 * ignoring namespace differences.
 */
export function relatedToIncludesAny(relatedTo: string[] | undefined, refs: Set<string>): boolean {
  if (!relatedTo) return false;
  const normSet = new Set<string>();
  for (const r of refs) normSet.add(normalizeRef(r));
  return relatedTo.some((r) => normSet.has(normalizeRef(r)));
}

export interface EntityLink {
  url: string;
  title?: string;
  icon?: string;
  type?: string;
}

export interface Entity {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    title?: string;
    description?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    tags?: string[];
    links?: EntityLink[];
  };
  spec: {
    owner?: string;
    lifecycle?: string;
    type?: string;
    system?: string;
    domain?: string;
    dependsOn?: string[];
    providesApis?: string[];
    consumesApis?: string[];
    parent?: string;
    children?: string[];
    members?: string[];
    definition?: string;
    docType?: string;
    docStatus?: string;
    draft?: boolean;
    supersededBy?: string;
    relatedTo?: string[];
    author?: string;
    contentUrl?: string;
    memberOf?: string[];
    email?: string;
  };
}
