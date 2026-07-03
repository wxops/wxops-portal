// Session-scoped notification store.
// Backed by sessionStorage — notifications survive client-side navigation but
// are wiped when the tab/browser session ends (no cross-session persistence).

export type NotificationType =
  | "pr_opened"         // portal PR opened in gitops-infra
  | "pr_merged"         // portal PR merged in gitops-infra
  | "pr_closed"         // portal PR closed without merge (rejected / superseded)
  | "scaffold_created"
  | "project_imported";

export interface PortalNotification {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  at: number;        // Unix ms timestamp
  read: boolean;
}

const KEY = "wxops_notifications";
const MAX = 50;
const EVENT = "notifications:update";

// ── Internal helpers ────────────────────────────────────────────────────────

function load(): PortalNotification[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function save(items: PortalNotification[]) {
  sessionStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(EVENT));
}

// ── Public API ──────────────────────────────────────────────────────────────

export function addNotification(
  n: Pick<PortalNotification, "type" | "title" | "body">,
) {
  const next: PortalNotification = {
    ...n,
    id: crypto.randomUUID(),
    at: Date.now(),
    read: false,
  };
  save([next, ...load()].slice(0, MAX));
}

export function markAllRead() {
  save(load().map((n) => ({ ...n, read: true })));
}

export function clearAll() {
  save([]);
}

export function getAll(): PortalNotification[] {
  return load();
}

export function getUnreadCount(): number {
  return load().filter((n) => !n.read).length;
}

export const NOTIFICATION_EVENT = EVENT;
