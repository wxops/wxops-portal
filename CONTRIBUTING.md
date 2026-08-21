# Contributing to W'xOps Portal

Thanks for being here. This project is small and actively maintained by one
person, so a good issue is as welcome as a good pull request — and a question
that exposes confusing documentation is genuinely useful work.

## Ways to contribute

You do not need to write Go or TypeScript to help:

- **Report a bug** — what you did, what happened, what you expected
- **Improve the docs** — if something confused you, it will confuse the next person
- **Try the deployment path** and tell us where it broke
- **Propose a feature** — open an issue describing the problem first, before writing code
- **Fix something** — see the setup below

For anything security-related, do **not** open a public issue. Follow
[SECURITY.md](SECURITY.md) instead.

## Read this before writing code

The portal has five constraints that are not style preferences. A pull request
that violates one will be turned down no matter how well it is written, so it is
only fair to state them up front:

1. **The portal is read-only for clusters.** It never writes to a Kubernetes API.
   Every change goes through a Gitea pull request reconciled by ArgoCD.
2. **Vault secrets: no read, no delete.** Create and update only, and only after
   confirming the remote resource already exists.
3. **Delete actions are platform-team only.** Never exposed to tenant developers.
4. **No `gitops-infra` URLs in responses to developers.** They have no access to
   that repository; return status text, not links.
5. **Lifecycle promotion is role-gated.** Only `platform-team` or the owning
   team's `{team}:Managers` group may promote to staging or production.

The reasoning behind each lives in
[`docs/security/security-assurance.md`](docs/security/security-assurance.md) —
these are structural properties of the code, and the project's main claim to
being trustworthy rests on them.

Beyond that, [`CLAUDE.md`](CLAUDE.md) is the working reference for architecture
decisions and conventions. It is written for AI assistants, but it is the most
complete and current description of how this codebase expects to be worked on,
and it is worth reading whether or not you use one.

## Setting up

**Prerequisites**

| Tool | Version |
|---|---|
| Go | 1.23+ |
| Node | 22+ (enforced by `engines` in `frontend/package.json`) |
| pre-commit | any recent — `pip install pre-commit` |
| swag | `go install github.com/swaggo/swag/cmd/swag@v1.16.4` |

**Install the hooks first.** They run the same checks CI does, so they save you a
round trip:

```bash
make hooks
```

**Run it locally.** `make dev` prints the commands for each service.
`DEV_BYPASS_AUTH=true` skips OIDC and logs you in as `dev / platform-team`, and
`CATALOG_LOCAL_DIR` points the catalog at a local directory — together they let
you work without standing up Pinniped, Vault, or Gitea. See
[`docs/development/local-development.md`](docs/development/local-development.md).

`make help` lists every target.

## The checks

Run these before pushing. The pre-commit hooks run them automatically on the
files they apply to:

```bash
cd backend  && go build ./... && go vet ./... && go test ./...
cd frontend && npx tsc --noEmit && npm run lint
```

Two hooks surprise people the first time:

- **The OpenAPI spec is generated, not hand-written.** Editing anything in
  `backend/internal/handlers/` or `backend/cmd/main.go` triggers `swag init` and
  stages `backend/docs/`. Commit the regenerated spec along with your change —
  do not edit those files directly. `make openapi-sync` runs it on demand.
- **`go mod tidy` is enforced.** A stray dependency fails the commit.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), enforced by a
`commit-msg` hook. The allowed types are exactly those the changelog generator
knows about — adding a new one means editing both `.pre-commit-config.yaml` and
`cliff.toml`:

`feat` · `fix` · `perf` · `refactor` · `docs` · `test` · `chore` · `revert`

```
feat(catalog): add lifecycle filter to entity list
fix(scaffold): derive appName from the vault-path annotation
```

`CHANGELOG.md` is generated from these by `make changelog`. Never edit it by hand.

## Pull requests

- **Small and single-purpose.** One thing per PR.
- **Never mix a refactor with a feature.** This is the rule most likely to get a
  PR sent back — the two are hard to review together, and a behaviour change
  hidden inside a large diff is how regressions get in.
- **Behaviour-preserving changes stay behaviour-preserving.** API response
  shapes, generated manifest output, and CLI output are contracts.
- **Say what you verified.** If you could not test a path — most cluster
  behaviour needs a real cluster — say so plainly. That is expected and fine;
  silently untested is not.
- Open an issue first for anything large, so you do not build something that
  turns out to conflict with a design decision.

Tests are thin right now. Adding one alongside your change is welcome and never
required — see the plan in
[`docs/development/refactor-and-hardening.md`](docs/development/refactor-and-hardening.md).

## Things that are easy to get wrong

Each of these has bitten before and fails silently rather than loudly:

- **Adding an environment variable takes three edits** — `config.go`, an
  **append** to `backend/.env.example` (never a rewrite; it holds hand-written
  setup snippets), and a row in
  [`environment-variables.md`](docs/getting-started/environment-variables.md).
- **Prefer a runtime backend variable over `NEXT_PUBLIC_*`.** A `NEXT_PUBLIC_`
  value is sealed into the JS bundle at image build time, so changing it forces a
  CI rebuild instead of a Deployment env edit.
- **Never add `images:` to a generated overlay `kustomization.yaml`.** ArgoCD
  Image Updater owns that section and will fight you on every reconcile.
- **The frontend is Next.js 16.** Read [`frontend/AGENTS.md`](frontend/AGENTS.md)
  — several APIs differ from what most references describe. `node_modules/next/dist/docs/`
  has the version you actually have installed.
- **Client components cannot reach the backend directly.** They go through a
  Route Handler in `src/app/api/`; see the BFF proxy section in `CLAUDE.md`.

## Where things live

```
backend/     Go API (Gin) — handlers, scaffold manifest builders, Gitea client
frontend/    Next.js 16 App Router — pages, BFF route handlers, UI components
cli/         wxops CLI (Cobra)
deploy/      nginx + supervisord config for the combined image
docs/        Architecture, deployment, catalog, security, roadmap
```

`README.md` has a documentation index pointing at the right doc for each area.
`CLAUDE.md` lists which one to read before touching a given subsystem.

## Licensing

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), the same licence as the project. There is no CLA
to sign and no copyright assignment — the inbound licence is the outbound
licence.

If you add a third-party dependency, check its licence is compatible and update
[`NOTICE`](NOTICE).

## Conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Reports
go to **security@wxops.cloud**.
