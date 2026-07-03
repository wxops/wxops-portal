# Performance & Caching

A map of every caching layer in the WxOps Portal — where it lives, what it
protects, how long it lasts, and why it was designed that way.

The portal is entirely dependent on external APIs: Gitea (catalog, PRs, CI
runs, packages), Vault (secrets), and Kubernetes/Pinniped (cluster data).
None of those are under our control, so caching is the primary performance
lever. Understanding the layer stack is essential before adding new features
that touch any of these data sources.

---

## Layer Map

```
Browser
  │
  ├── FlexSearch in-memory index      5 min (client, module-level singleton)
  ├── sessionStorage notifications    session lifetime (cleared on tab close)
  │
nginx :80
  │
Next.js :3000
  ├── Template BFF route cache        5 min (Next.js fetch cache + Cache-Control)
  ├── stale-while-revalidate          +60 s (serves stale while refreshing)
  │
Go backend :8080
  ├── Catalog entity store            5 min (in-process, RWMutex, invalidatable)
  └── Cluster registry                60 s  (in-process, RWMutex)

External
  ├── Gitea REST API                  (no portal cache — live on each request)
  ├── Pinniped mTLS cert              5–15 min (issued by Concierge, not cached by portal)
  └── Vault KV v2                     write-only — no reads, no portal cache
```

---

## Backend Caches

### 1. Catalog Entity Store — 5 min TTL

**File:** `backend/internal/catalog/store.go`
**Constant:** `cacheTTL = 5 * time.Minute`

The most important cache in the portal. All catalog reads — entity list,
entity detail, promo status checks — go through a single `Store` that holds
the full entity slice in memory.

**Read pattern (double-checked locking):**
```go
// Fast path: RLock → check age → return slice
// Slow path: upgrade to Lock → re-check → fetch from Gitea → store
```

Two lock acquisitions prevent a thundering herd: if 50 requests arrive
during a cache miss, only one goroutine fetches from Gitea; the rest wait
and are served the result without redundant API calls.

**Why 5 minutes:**
- Gitea API has no rate-limit headers we can read — 5 min is conservative
  enough to avoid hitting any realistic limit even under load
- The catalog changes infrequently (scaffolds, entity edits) — 5 min
  staleness is acceptable for browsing
- The `InvalidateCache()` escape hatch (see §Invalidation below) covers the
  cases where freshness matters most

**Why in-process instead of Redis:**
The portal is a single-process binary (Go + Next.js in one container). A
Redis dependency would add a third service, a network hop, and a new failure
mode with no measurable benefit at current catalog sizes (< 500 entities).
Re-evaluate when catalog size exceeds ~2,000 entities or when the portal
runs as multiple replicas.

**`InvalidateCache()`:**
```go
func (s *Store) InvalidateCache() {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.cached = nil   // next read re-fetches from Gitea
}
```

Called by `RefreshCatalog` handler (`POST /api/v1/webhooks/catalog/refresh`).

---

### 2. Cluster Registry — 60 s TTL

**File:** `backend/internal/cluster/discovery.go`
**Constant:** `cacheTTL = 60 * time.Second`

Cluster list is stored in Kubernetes Secrets on the hub cluster (or a static
`clusters.json` file in dev). Reading K8s Secrets on every request would add
a hub-cluster API call to every page that lists clusters — unnecessary given
that the cluster roster changes rarely.

60 s is much shorter than the catalog TTL because:
- Cluster Secrets can be added/removed by the platform team at any time
- A new cluster appearing within 60 s is reasonable; 5 minutes is not
- The data is tiny (a handful of cluster structs) — short TTL costs nothing

Same RWMutex double-check pattern as the catalog store.

---

### 3. Pinniped mTLS Certificates — 5–15 min (Concierge-issued)

**File:** `backend/internal/cluster/pinniped.go`

The portal does not cache these certificates itself. The Concierge issues
short-lived mTLS client certificates (5–15 min lifetime) per user per
cluster. They are returned to the client as part of the kubeconfig download
and are not stored server-side.

For cluster API calls made server-side (pods, deployments), the portal
performs a fresh `TokenCredentialRequest` per request using the user's
Pinniped session token. This is intentional — the portal must never store
cluster credentials on behalf of a user.

If this becomes a latency concern (each cluster page adds one Concierge
round-trip), a short per-request credential cache keyed by `(userID,
clusterID)` could be added with a TTL below the cert lifetime. Not done
yet because cluster views are not high-traffic.

---

## Frontend Caches

### 4. Template BFF Route — 5 min, stale-while-revalidate 60 s

**Files:**
- `frontend/src/app/api/scaffold/templates/route.ts`
- `frontend/src/app/api/scaffold/templates/[id]/tree/route.ts`

Templates change rarely (only when the platform team pushes a new version to
the template repo). Caching aggressively here avoids a Gitea API call on
every wizard open.

**Two-layer approach:**
```ts
// Layer 1: Next.js fetch cache (server-side, shared across requests)
fetch(BACKEND_URL + "/api/v1/scaffold/templates", {
  next: { revalidate: 300 }   // 5-min server-side revalidation
});

// Layer 2: Cache-Control header sent to browser/BFF caller
response.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
```

`stale-while-revalidate=60` means the browser serves the cached response
immediately and revalidates in the background. The user never waits for
templates to load after the first open.

**Layer 3 — `sessionStorage` (client-side):**

The scaffold wizard stores the fetched template list in `sessionStorage`.
On subsequent wizard opens within the same browser session, templates are
served from `sessionStorage` instantly — no network request at all.

Cleared automatically when the tab/session ends. No stale data across
sessions.

**Total template cache lifetime without a refresh:**
```
sessionStorage (session) → Next.js cache (5 min) → backend Gitea fetch
```

---

### 5. FlexSearch Client-Side Index — 5 min TTL

**File:** `frontend/src/lib/catalog-index.ts`
**Constant:** `INDEX_TTL = 5 * 60 * 1000` (matches backend cache TTL)

The command palette (Ctrl+K / Cmd+K) searches all catalog entities
client-side using a FlexSearch `Document` index. Building this index
requires fetching the full entity list (`GET /api/catalog/entities?limit=0`).

**Module-level singleton:**
```ts
let index: Document | null = null;
let builtAt = 0;

// On palette open:
const isStale = Date.now() - builtAt > INDEX_TTL;
if (!index || isStale) {
  await buildIndex();   // fetch + reindex
}
```

The index is built once per 5-minute window, shared across all palette
opens in that window. Concurrent opens are deduplicated — if a build is
already in progress, subsequent calls wait for the same promise.

**Why 5 min matches the backend TTL:**
The index is a snapshot of the catalog. If the index TTL were shorter than
the backend TTL, the index would be rebuilt with the same stale data — a
wasted fetch. If it were longer, searches would miss recently merged
entities. 5 min aligns both layers so a cache miss in one implies a miss
in the other.

**Search is synchronous:**
FlexSearch operates entirely in-memory. Once the index is built, searches
return in microseconds — no debounce is needed. The palette feels
instantaneous.

**`resetCatalogIndex()`:**
Called after the cache refresh webhook fires (via the inline `promostatus`
refresh in `handleCreateOverlay` and `handleConfirm`). Sets `builtAt = 0`
so the next palette open rebuilds from fresh data.

---

### 6. Client-Side Catalog Filtering

**File:** `frontend/src/app/dashboard/catalog/page.tsx`

The catalog list page fetches the **full entity dataset** once per page
navigation and filters lifecycle tabs, kind pills, search, and owner in
the browser. The backend returns all entities in a single response.

**Why not server-side per-tab pagination:**

If lifecycle tabs triggered separate backend requests, tab counts would be
computed from different response pages — a user on page 2 of
"experimental" would see a count that doesn't match what's actually in the
backend slice. Client-side filtering on the full dataset guarantees counts
are always accurate.

**Why this is fast enough:**
The backend cache returns the full slice in < 5 ms. JSON parsing 200
entities in the browser takes < 10 ms. Filtering in JS is sub-millisecond.
The visible cost is the single network round-trip, which is dominated by
the BFF proxy hop (loopback, < 1 ms) not the data size.

**When to reconsider:**
If the catalog grows beyond ~1,000 entities, the single-payload approach
starts to matter for initial page load time. At that point, move lifecycle
filtering server-side (`?lifecycle=` already supported by the backend) and
accept that tab counts may be slightly inaccurate or require a separate
`?count=true` endpoint.

---

### 7. Polling Intervals

Two client-side pollers run in the background while the portal is open.
Both use `setInterval` and clean up on component unmount.

| Poller | Interval | Endpoint | What it does |
|---|---|---|---|
| CI status card | 30 s | `GET /api/catalog/entities/:kind/:name/ci` | Refreshes Gitea Actions run status on entity detail pages |
| Notification bell | 3 min | `GET /api/catalog/entities?limit=1` | Checks catalog entity count; fires "Catalog updated: N new entries" if count changed since session baseline |

**Why 30 s for CI:**
Gitea Actions runs typically complete in 1–5 minutes. 30 s is fast enough
to show build status changing without hammering the API. The response is
small (5 recent runs).

**Why 3 min for notifications:**
The notification poll only fetches one entity (`?limit=1`) to get the
total count header. It is cheap. 3 min is chosen so that a scaffolded
entity (which triggers catalog/refresh → cache flush) appears in the
notification within 3 minutes even if the webhook is not configured.

**Why `sessionStorage` for notifications:**
Notifications are session-scoped — events from a previous login are not
relevant to the current session. `sessionStorage` is cleared automatically
on tab close, preventing stale notifications from surfacing after a
relogin. `localStorage` would persist across sessions; a database would
require a migration strategy.

---

## Cache Invalidation

### Webhook path (recommended)

```
gitops-infra push
  → Gitea fires push webhook
  → POST /api/v1/webhooks/catalog/refresh (Bearer WEBHOOK_TOKEN)
  → store.InvalidateCache()         ← catalog store cleared
  → next catalog read hits Gitea    ← fresh entities
  → notification bell sees new count ← notifies user within next poll
```

The FlexSearch index is NOT invalidated by the webhook directly — it is
rebuilt on the next palette open (within 5 min, or immediately if the
user opens the palette before the TTL expires).

### Inline path (Promotion panel)

After a successful `create-overlay` or `confirm` action in the Promotion
panel, the panel immediately re-fetches `promostatus` to update its own
state. It also calls `resetCatalogIndex()` so the command palette reflects
any new lifecycle the entity just moved into.

### Manual path

```sh
curl -sf -X POST "$PORTAL_URL/api/v1/webhooks/catalog/refresh" \
  -H "Authorization: Bearer $WEBHOOK_TOKEN"

# Or with the CLI (v0.4.0):
wxops catalog refresh
```

---

## nginx — No Static Asset Caching Yet

**File:** `deploy/nginx.conf`

All requests — including `/_next/static/` and `/public/` — are currently
proxied to Next.js. nginx does not serve static files directly.

The config has the correct future setup commented in:

```nginx
# FUTURE — static asset serving from disk:
location /_next/static/ {
    alias /app/.next/static/;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
location /public/ {
    alias /app/public/;
    add_header Cache-Control "public, max-age=86400";
}
```

`max-age=31536000, immutable` for `/_next/static/` is correct because
Next.js content-hashes all static asset filenames — a changed file gets
a new URL, so it is safe to cache forever.

**Why not enabled yet:**
The portal runs as a combined container. Enabling static serving from disk
requires the Next.js standalone build output to be accessible at the same
path inside the nginx process. Not complex, but not a bottleneck at current
traffic. Enable this when nginx becomes a measurable part of page load time.

---

## Performance Decision Log

| Decision | Choice | Rationale |
|---|---|---|
| Catalog cache granularity | Full slice, not per-entity | Avoids partial-cache inconsistency; catalog is small |
| Catalog TTL | 5 min | Conservative Gitea API rate limit buffer; escape hatch via webhook |
| Cluster TTL | 60 s | Roster changes matter faster; data is tiny |
| Template cache | 3-layer (server + BFF + sessionStorage) | Templates change rarely; instant load after first open |
| FlexSearch TTL | 5 min = catalog TTL | Prevents wasted rebuilds against stale backend data |
| Catalog filtering | Client-side on full dataset | Accurate tab counts; backend cache makes full fetch fast |
| Notifications | sessionStorage, 3-min poll | No cross-session leakage; cheap poll (`?limit=1`) |
| CI poll | 30 s | Balances freshness vs Gitea API load |
| Static assets | Proxied through Next.js | Simpler container, acceptable until traffic grows |
| Redis | Not used | Single-process; cache is in-process; add Redis at multi-replica scale |
| Pinniped cert | Not cached by portal | Security boundary — portal must not store user credentials |

---

## Scaling Thresholds

These are the points where the current design needs re-evaluation:

| Threshold | Symptom | Recommended change |
|---|---|---|
| Catalog > ~1,000 entities | Slow initial page load; large JSON payload | Move lifecycle filtering server-side; add `?lifecycle=` pagination |
| Catalog > ~2,000 entities | FlexSearch index build time noticeable on palette open | Paginate index build; index only name/title/tags not full entity |
| Multiple portal replicas | Cache inconsistency between pods | Add Redis (or sticky sessions) so `InvalidateCache()` propagates |
| CI poll causing Gitea rate limit | HTTP 429 on CI card fetch | Add exponential backoff + jitter to `setInterval` pollers |
| Template repo growth > 50 templates | Template wizard is slow on first open | Add pagination to template list endpoint; lazy-load tree on select |
