export type AvatarStyleVersion = "1";
export type SeedMode = "human" | "raw";
export type AvatarTheme = "light" | "dark";
export type VariantChoice<T extends string> = "auto" | T | number;

export interface ThemeColors {
  background: string;
  foreground: string;
}

export interface AvatarPaletteInput {
  id?: string;
  light?: ThemeColors | readonly [string, string];
  dark?: ThemeColors | readonly [string, string];
  background?: string;
  foreground?: string;
}

export interface NormalizedPalette {
  id: string;
  light: ThemeColors;
  dark: ThemeColors;
  visualKey?: string;
}

export interface AvatarConstraints {
  minPixels: number;
  maxPixels: number;
  minDensity: number;
  maxDensity: number;
  maxDiagonalConnections: number;
  connectivity: 4 | 8;
  maxHoles: number;
}

export interface AvatarOptions {
  size?: number | `${number}`;
  seedMode?: SeedMode;
  namespace?: string | number;
  namespaceMode?: SeedMode;
  theme?: AvatarTheme;
  minPixels?: number;
  maxPixels?: number;
  minDensity?: number;
  maxDensity?: number;
  maxDiagonalConnections?: number;
  connectivity?: 4 | 8;
  maxHoles?: number;
  palette?: VariantChoice<string> | AvatarPaletteInput;
  palettes?: readonly (AvatarPaletteInput | readonly [string, string])[];
  collisionNonce?: number;
  minimumContrast?: number;
  allowLowContrast?: boolean;
}

export interface HashOptions {
  seedMode?: SeedMode;
  namespace?: string | number;
  namespaceMode?: SeedMode;
  domain?: string;
}

export interface AvatarBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface AvatarMetrics {
  cellCount: number;
  density: number;
  bounds: AvatarBounds;
  connectedComponents4: number;
  connectedComponents8: number;
  holeCount: number;
  diagonalTouchCount: number;
  diagonalTouchCountIgnoringMirror: number;
}

export interface AvatarValidation extends AvatarMetrics {
  valid: boolean;
  mirrored: boolean;
  constraints: AvatarConstraints;
}

export interface AvatarDescriptor {
  styleVersion: AvatarStyleVersion;
  namespace: string;
  canonicalSeed: string;
  identityKey: string;
  collisionNonce: number;
  hash: number;
  shapeId: string;
  shapeMask: number;
  shapeIndex: number;
  rows: number[];
  grid: boolean[][];
  paletteId: string;
  paletteIndex: number;
  palette: NormalizedPalette;
  theme: AvatarTheme;
  colors: ThemeColors;
  constraints: AvatarConstraints;
  stateSpace: number;
  signature: string;
  metrics: AvatarMetrics;
}

export interface CatalogShape extends AvatarMetrics {
  id: string;
  mask: number;
  rows: number[];
}

export interface CatalogStats {
  styleVersion: AvatarStyleVersion;
  rawSymmetricMasks: 4096;
  validShapes: number;
  availablePalettes: number;
  signatureStates: number;
  constraints: AvatarConstraints;
}

export interface IdentityManifestEntry {
  nonce: number;
  signature: string;
  shapeId: string;
  paletteId: string;
}

export interface IdentityDistinguishabilityPolicy {
  schema: "visual-distance/v1";
  minimumShapeDistance: number;
  minimumPaletteDistance: number;
  mode: "either" | "both";
}

export interface IdentityManifest {
  schema: "deterministic-agent-avatars-manifest/v1";
  styleVersion: AvatarStyleVersion;
  namespaceKey: string;
  optionsKey: string;
  distinguishability?: IdentityDistinguishabilityPolicy;
  entries: Record<string, IdentityManifestEntry>;
}

export interface IdentitySetOptions extends Omit<AvatarOptions, "collisionNonce"> {
  ensureUnique?: boolean;
  includeSvg?: boolean;
  manifest?: IdentityManifest;
  maxAttempts?: number;
  minimumShapeDistance?: number;
  minimumPaletteDistance?: number;
  distanceMode?: "either" | "both";
}

export interface IdentitySetItem<T = unknown> {
  input: T;
  identityKey: string;
  nonce: number;
  signature: string;
  descriptor: AvatarDescriptor;
  svg?: string;
}

export interface IdentitySetResult<T = unknown> {
  items: IdentitySetItem<T>[];
  manifest: IdentityManifest;
  stateSpace: number;
}

export const STYLE_VERSION: AvatarStyleVersion;
export const GRID_W: 5;
export const GRID_H: 4;
export const RAW_SYMMETRIC_MASKS: 4096;
export const BUILTIN_PALETTES: readonly NormalizedPalette[];
export function canonicalSeed(value: unknown, mode?: SeedMode): string;
export function hash32(value: unknown, options?: HashOptions): number;
export function contrastRatio(first: string, second: string): number;
export function rowsFromSymmetricMask(mask: number): number[];
export function symmetricMaskFromRows(rows: readonly number[]): number;

export function getAvatarCatalog(options?: AvatarOptions): CatalogShape[];
export function getCatalogStats(options?: AvatarOptions): CatalogStats;
export function validateAvatarBitmap(gridOrRows: boolean[][] | number[], options?: AvatarOptions): AvatarValidation;
export function createAvatarDescriptor(seed: unknown, options?: AvatarOptions): AvatarDescriptor;

export function createHashAvatarFromDescriptor(descriptor: AvatarDescriptor, size?: number | `${number}`): string;
export function createHashAvatar(seed: unknown, size?: number | `${number}`, options?: AvatarOptions): string;
export function createHashAvatar(seed: unknown, options?: AvatarOptions): string;
export function avatarDataUri(seed: unknown, size?: number | `${number}`, options?: AvatarOptions): string;
export function avatarDataUri(seed: unknown, options?: AvatarOptions): string;

export function createIdentitySet<T>(seeds: readonly T[], options?: IdentitySetOptions): IdentitySetResult<T>;
