# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.2] - 2026-09-18

### Added

- Added canonical, social preview, crawler discovery, sitemap, and structured software metadata to the GitHub Pages demo.
- Added a prominent live-generator link to the package README.
- Added indexable documentation, React, identity-set, private-avatar, examples, and comparison pages with contextual internal links.
- Added `llms.txt` plus provider-neutral AI referral and conversion events that do not transmit visitor data.

### Changed

- Unified the main demo and documentation pages around the same warm neutral palette, typography, pill controls, radii, shadows, and animated brand avatar.
- Reworked the package README into a shorter integration guide focused on stable IDs, runtime entry points, limits, and security boundaries.

### Fixed

- Bounded visual-distance allocation memory by removing retained quadratic shape-neighbor tables.
- Rejected sparse arrays consistently at public rows, grids, seeds, palettes, descriptor, and PNG-size boundaries.
- Aligned numeric runtime validation, TypeScript declarations, and documented error classes.
- Made PNG set replacement exception-atomic with staging, rollback, and a manifest-last commit.
- Prevented identity-set growth from returning manifests above the 10,000-entry read limit.
- Rejected invalid option containers consistently across SVG, PNG descriptor, bitmap-validation, and React APIs.
- Rejected `null` and non-finite numeric palette selections with the documented error type.
- Corrected the documentation of the npm package dry-run workflow.

### Removed

- Removed four redundant README mockup images from the repository, npm package, and Pages artifact.

## [1.0.1] - 2026-07-17

### Added

- Added `createIdentitySetWithFallback()` for interactive tools that may safely adopt a stored manifest policy or deterministically relax an infeasible new allocation policy.
- Added interactive Identity set generation with per-avatar SVG/PNG copy and download actions plus ZIP export containing individual avatar files and `manifest.json`.

### Changed

- Redesigned the Single avatar and Identity set demo workspaces around avatar preview, compact customization, and consistent export controls.

## [1.0.0] - 2026-07-14

### Added

- Deterministic SVG and PNG avatar generation.
- Browser-safe root and React entry points.
- Node.js-only PNG and private HMAC entry points.
- Batch identity allocation with reusable manifests and optional visual-distance constraints.
- ESM, CommonJS, and format-specific TypeScript declarations.
- Resource limits for custom palettes, identity sets, manifests, and PNG sets.
- Runtime support verification for Node.js 18 and React 19.

### Changed

- Manifest compatibility includes `seedMode`; manifests created by `1.0.0-rc.1` are incompatible with `1.0.0` and must be regenerated.
- `IdentitySetOptions` no longer exposes `collisionNonce`.
- PNG descriptor and React option types now include only effective inputs.
- Private HMAC helpers require at least 32 encoded secret bytes.
- Shape catalogs are initialized lazily, and visual-distance structures are reused through bounded caches.
- Public style-version export is named `STYLE_VERSION`.
- Catalog capacity is exposed as `signatureStates`.
- PNG byte-returning APIs are typed as `Uint8Array`.

### Fixed

- `allowLowContrast`, `includeSvg`, and `ensureUnique` now reject non-boolean values.
- Aggregate PNG rendering and large identity collections now fail before expensive processing.

### Removed

- Removed the ambiguous `createAvatarBitmap` alias before the initial public release.
- Removed private/HMAC helpers from the browser-visible root entry.
