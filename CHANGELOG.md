# Changelog

## [1.0.3] - 2026-10-09

### Changed

- Updated all 16 built-in palettes. Switching themes swaps background and foreground colors.

## [1.0.2] - 2026-09-18

### Added

- Added integration guides for React, identity sets, and private avatars.

### Fixed

- Reduced memory use during visual-distance allocation.
- Aligned input validation and error types across public APIs, including sparse arrays, invalid option containers, and numeric palette selections.
- Added rollback when PNG set replacement fails.
- Enforced the 10,000-entry manifest limit during identity-set growth.

## [1.0.1] - 2026-07-17

### Added

- Added `createIdentitySetWithFallback()` to reuse a stored manifest policy or relax an infeasible allocation policy.
- Added identity-set generation and SVG, PNG, and ZIP export to the demo.

## [1.0.0] - 2026-07-14

### Added

- Deterministic SVG and PNG avatar generation.
- Browser and React entry points, plus Node.js PNG and private HMAC helpers.
- Batch identity allocation with reusable manifests and optional visual-distance constraints.
- ESM, CommonJS, and format-specific TypeScript declarations.
- Resource limits for custom palettes, identity sets, manifests, and PNG sets.

### Migration

- Regenerate manifests created with `1.0.0-rc.1` to include `seedMode` in compatibility checks.
