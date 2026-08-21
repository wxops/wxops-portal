---
name: Feature request
about: Suggest an idea for this project
title: "[FEATURE] "
labels: enhancement
assignees: ''

---

**Is your feature request related to a problem? Please describe.**
A clear and concise description of what the problem is. Ex. I'm always frustrated when [...]

**Describe the solution you'd like**
A clear and concise description of what you want to happen.

**Describe alternatives you've considered**
A clear and concise description of any alternative solutions or features you've considered.

A few boundaries are structural to this project, not just current priorities
— a request that runs into one of these will likely be closed as out of
scope rather than implemented:
- The portal is read-only for clusters — it never writes to the Kubernetes API.
- Vault: no read, no delete — create/update only.
- Delete is platform-team only, never exposed to tenant developers.
- No `gitops-infra` PR URLs surfaced to developers.

**Additional context**
Add any other context or screenshots about the feature request here.
