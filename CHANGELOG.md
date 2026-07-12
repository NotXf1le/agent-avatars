# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-rc.2] - 2026-07-12

### Added

- Resource limits for custom palettes, identity sets, manifests, and PNG sets.
- Runtime support verification for Node.js 18 and React 19.

### Changed

- Manifest compatibility now includes `seedMode`; manifests created by `1.0.0-rc.1` must be regenerated.
- `IdentitySetOptions` no longer exposes `collisionNonce`.
- PNG descriptor and React option types now include only effective inputs.
- Private HMAC helpers require at least 32 encoded secret bytes.
- Shape catalogs are initialized lazily, and visual-distance structures are reused through bounded caches.

### Fixed

- `allowLowContrast`, `includeSvg`, and `ensureUnique` now reject non-boolean values.
- Aggregate PNG rendering and large identity collections now fail before expensive processing.

## [1.0.0-rc.1] - 2026-07-12

### Added

- Deterministic SVG and PNG avatar generation.
- Browser-safe root and React entry points.
- Node.js-only PNG and private HMAC entry points.
- Batch identity allocation with reusable manifests and optional visual-distance constraints.
- ESM, CommonJS, and format-specific TypeScript declarations.

### Changed

- Public style-version export is named `STYLE_VERSION`.
- Catalog capacity is exposed as `signatureStates`.
- PNG byte-returning APIs are typed as `Uint8Array`.

### Removed

- Removed the ambiguous `createAvatarBitmap` alias before the initial public release.
- Removed private/HMAC helpers from the browser-visible root entry.
