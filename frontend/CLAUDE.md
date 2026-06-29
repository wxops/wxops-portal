@AGENTS.md

See the root `CLAUDE.md` §Frontend (Next.js) for the complete stack reference,
BFF proxy pattern explanation, and rendering strategy table.

## Commands

```bash
npm ci                              # install (respects lock file)
npx tsc --noEmit                    # type check
npx eslint src/ --ext .ts,.tsx      # lint
npm run dev                         # dev server
npm run build                       # production build
npx shadcn@latest add <component>   # generate a new UI primitive (shadcn not in package.json)
```

## Key conventions

- **Node ≥ 22** — enforced by `engines` in `package.json`
- **BFF routes live in `src/app/api/`** — they proxy to Go and handle the session
  cookie server-side. Browser code never calls Go directly.
- **Server components fetch via `BACKEND_URL`** (internal loopback). Read the
  session cookie with `getSession()` / `requireSession()` from `src/lib/session.ts`.
- **`"use client"` components** fetch through BFF routes at `/api/…` with
  `{ credentials: "include" }`.
- **`cn()` from `src/lib/utils.ts`** — always use this to compose Tailwind classes,
  never concatenate strings directly.
- **`src/components/ui/`** — source files owned by this repo (wrapping Base UI
  primitives). Do not treat them as a third-party library; edit freely.
- **`lucide-react` for icons only** — it is not a component library.
- **`shadcn` is not in `package.json`** — use `npx shadcn@latest add` when you
  need to generate a new component.
