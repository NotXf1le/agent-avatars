# Contributing

## Setup

Development and release checks require Node.js 24.8 or newer and npm 11.11.0. Runtime compatibility with Node.js 18 is tested separately against the packed artifact.

Install the pinned dependency graph with:

```bash
npm ci
```

## Checks

Run the full release gate before submitting a change:

```bash
npm test
```

Maximum-size PNG allocation is intentionally separate:

```bash
npm run test:stress
```

Release maintainers must also install Chromium once and run the complete non-publishing gate:

```bash
npx playwright install chromium
npm run test:release
```

Changes to deterministic selection, palettes, rendering, or manifests must preserve existing golden outputs unless the style version is intentionally advanced and the migration is documented.

Security reports follow [SECURITY.md](SECURITY.md) and must not be filed publicly with exploit details.

## Distribution policy

Direct Git URL installs are not supported. Publish consumers through the npm tarball, which contains generated `dist` artifacts.

If a source ZIP is required, create it from a clean Git commit rather than the working directory:

```bash
git archive --format=zip --output deterministic-agent-avatars-source.zip HEAD
```

Do not archive a workspace containing `node_modules`, temporary tarballs, coverage output, or local build artifacts.
