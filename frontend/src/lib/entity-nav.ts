// Client-side only — localStorage persisted, no server calls.

export interface NavEntity {
  kind:        string;
  name:        string;
  title:       string;
  description: string;
  lifecycle:   string;
}

export interface RecentEntity extends NavEntity {
  visitedAt: number;
}

const RECENT_KEY = "wxops:recent_v1";
const PINNED_KEY = "wxops:pinned_v1";
const MAX_RECENT = 8;

function safeGet<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
}

function safeSet(key: string, value: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function getRecent(): RecentEntity[] {
  return safeGet<RecentEntity>(RECENT_KEY).slice(0, MAX_RECENT);
}

export function trackVisit(e: NavEntity): void {
  const list = getRecent().filter((r) => !(r.kind === e.kind && r.name === e.name));
  list.unshift({ ...e, visitedAt: Date.now() });
  safeSet(RECENT_KEY, list.slice(0, MAX_RECENT));
}

export function getPinned(): NavEntity[] {
  return safeGet<NavEntity>(PINNED_KEY);
}

export function isPinned(kind: string, name: string): boolean {
  return getPinned().some((p) => p.kind === kind && p.name === name);
}

/** Returns the new pinned state (true = now pinned). */
export function togglePin(e: NavEntity): boolean {
  const list = getPinned();
  const idx  = list.findIndex((p) => p.kind === e.kind && p.name === e.name);
  if (idx !== -1) {
    list.splice(idx, 1);
    safeSet(PINNED_KEY, list);
    return false;
  }
  list.unshift({ kind: e.kind, name: e.name, title: e.title, description: e.description, lifecycle: e.lifecycle });
  safeSet(PINNED_KEY, list);
  return true;
}
