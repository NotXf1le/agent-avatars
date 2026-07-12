# Security Policy

## Supported versions

Security fixes are provided for the latest `1.x` release. Prerelease builds are supported only until the next prerelease or stable release is available.

## Security boundaries

- The root and `react` entries are browser-safe and must not import Node.js built-ins.
- The `private` entry is Node.js-only. Its secret is trusted server configuration, must contain at least 32 encoded bytes, and must not be supplied by an end user.
- Public rows, grids, colors, manifests, sizes, and avatar options may originate from untrusted application data and are validated at the library boundary.
- The PNG API is synchronous and enforces per-image and aggregate set budgets, but applications must still impose request quotas and a smaller allowlisted size for remotely supplied input.
- The demo must not execute third-party JavaScript automatically.

Deterministic avatars are not anonymization. A namespace is public domain separation, not a secret.

## Reporting a vulnerability

Use the [private security-advisory form](https://github.com/NotXf1le/deterministic-agent-avatars/security/advisories/new). Do not include secrets, personal data, or exploit details in a public issue. Include affected versions, a minimal reproducer, impact, and any known mitigations.

You should receive an acknowledgement within seven days. Valid reports will be coordinated through a private advisory until a fix and disclosure timeline are ready.
