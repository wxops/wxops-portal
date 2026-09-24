# Changelog

All notable changes to this project are documented in this file, starting with **v0.5.2**.
Versions follow [Semantic Versioning](https://semver.org/).
Commits follow [Conventional Commits](https://www.conventionalcommits.org/).

- **v0.5.2 and later** — each version below links to its [GitHub Release](https://github.com/wxops/wxops-portal/releases),
  which carries the release notes, the container image and the CLI binaries.
- **v0.1.0 – v0.5.1** — archived and frozen in [CHANGELOG-ARCHIVE.md](CHANGELOG-ARCHIVE.md).
  GitHub Releases begin at v0.5.2; those earlier versions were never published there.

> This file is regenerated from git history by running `make changelog`.
> Do not edit it manually.

---

## [0.5.2](https://github.com/wxops/wxops-portal/releases/tag/v0.5.2) — 2026-09-24

### Bug Fixes

- Correct routing with nginx and allow update secrets from catalog ([`8ba8ae2`](https://github.com/wxops/wxops-portal/commit/8ba8ae2d0a58f99b778bdb6bc4838d455749d27b))

### CI/CD

- **ci**: Fix pipeline and chart for release the package ([`95f5085`](https://github.com/wxops/wxops-portal/commit/95f50854db8f4bd8c93210c2cd5751cd24a28b09))
- **ci**: Fix break ci with new actions and update NodeJS and documentation ([`744bbbb`](https://github.com/wxops/wxops-portal/commit/744bbbbe73df7238d080bbd04e264d0106b3dc7e))
- **ci**: Ignore main push event and set up the right concept for update changelog.md and release ([`33db150`](https://github.com/wxops/wxops-portal/commit/33db150d5bb5ddb93a705faa58e94926a3a966ea))

### Chores

- Fix changing locked by release-notes and update template ([`150eaf9`](https://github.com/wxops/wxops-portal/commit/150eaf91f199e91eeeee573f65af4eb977daf0e4))
- Enhance the monitoring for xtenantapp and refactor to friendly UI ([`03cd202`](https://github.com/wxops/wxops-portal/commit/03cd202a9d23227cacf7b303cda8863c9af935ac))
- Support cli command for updated ([`3c29856`](https://github.com/wxops/wxops-portal/commit/3c298561a75a64fd92c11c08b7a2e498da8418ff))
- Add handler for CLI versioning and update overview UI for latest release ([`772ca30`](https://github.com/wxops/wxops-portal/commit/772ca309cc4d2e2c9dbd5d1838ab180dc4940558))
- Enhance cli darlane and enhance devEx with portal ([`b1867ec`](https://github.com/wxops/wxops-portal/commit/b1867eca779392353f526d17e5da255b40303f19))
- Add support health-check for probing portal ([`3010203`](https://github.com/wxops/wxops-portal/commit/3010203ceb7cbc3fb1591081fcfae61493a3d882))
- Refine documentation for correct format and workflow release ([`a935781`](https://github.com/wxops/wxops-portal/commit/a9357819cc57954c362a802e48811e694fec4471))
- Fix the lint error of FE ([`de210fb`](https://github.com/wxops/wxops-portal/commit/de210fbb516d264f670990bcdd57f31469a31841))

### Documentation

- Update README.md and changelog to cover project release ([`d5f7085`](https://github.com/wxops/wxops-portal/commit/d5f70857b252fedb420009719d6b352dcfbb8c15))
- Add new research about wxops ecosystem and alternative solution ([`909f0ce`](https://github.com/wxops/wxops-portal/commit/909f0cee97af73e27d4ad19be0dd4ceed6e4d9f5))
- Organize docs for entire portal project ([`f29033c`](https://github.com/wxops/wxops-portal/commit/f29033cca8f7a541a0aac71473384f2d792d95cc))
- Update generated changelog for correct format and update API Reference ([`51ffb16`](https://github.com/wxops/wxops-portal/commit/51ffb168c649d56a171a9d330cd5ed3289274fd1))

### Features

- Integrate runtime observability into Portal with LGTM stack and ArgoCD Status for XRs and Application Synced ([`40ac926`](https://github.com/wxops/wxops-portal/commit/40ac926e562e8fd7bdc3df7609a58ef4af2b1175))
- Support new CLI and Darlane panel for DevExperience for Debug, Feature Flag and A/B Testing Dynamically ([`d204015`](https://github.com/wxops/wxops-portal/commit/d20401506c115f93520305dd262fb1f56732566b))
- Integrate search with flexsearch and introduce promotion-system for multi-env handler ([`6324d41`](https://github.com/wxops/wxops-portal/commit/6324d41a38025add8c7f9467605c4da6da5495af))
- Support service scaffolding template for create and import new project ([`2a9edd9`](https://github.com/wxops/wxops-portal/commit/2a9edd901919a0b7edf4796e1a50688308d64016))
- Setup phase2 for service-catalog and refine cache phase 1 ([`0833042`](https://github.com/wxops/wxops-portal/commit/0833042fc3c92e8319c42f26c1f7ed460aaf177e))
- Init new portal for multi-cluster authentication workflows ([`979be72`](https://github.com/wxops/wxops-portal/commit/979be7238565cc0b0f6e3f096d693575d9fd1155))

### Refactoring

- Update UI with modern visualization and introduce couple of new look for entire portal ([`4932704`](https://github.com/wxops/wxops-portal/commit/4932704845f9bd8c4bd68dc95224520ae2f007ca))
- Update ui for visualization ([`fe5ce41`](https://github.com/wxops/wxops-portal/commit/fe5ce418fbd13c92a50e44c82feee7dea7978475))
- Update the feature for service-catalog ([`95152f9`](https://github.com/wxops/wxops-portal/commit/95152f9336b9d910d9fc2f173f3fb6cf98c709a8))

