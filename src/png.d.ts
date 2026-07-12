import type { AvatarDescriptor, AvatarOptions } from "./index.d.ts";

export interface PngRenderOptions {
  supersample?: number;
}

export interface PngOptions extends AvatarOptions, PngRenderOptions {}

export interface PngSetOptions extends PngOptions {
  sizes?: readonly number[];
  baseName?: string;
}

export interface AvatarPngSet {
  descriptor: AvatarDescriptor;
  files: Record<number, Uint8Array>;
}

export interface WrittenAvatarPngSet extends AvatarPngSet {
  paths: Record<string, string>;
  manifestPath: string;
  manifest: {
    schema: "deterministic-agent-avatars-png-export/v1";
    styleVersion: string;
    identityKey: string;
    signature: string;
    namespace: string;
    theme: string;
    paletteId: string;
    files: Record<string, string>;
  };
}

export const PLATFORM_PNG_SIZES: readonly [32, 64, 192, 200];
export function createAvatarPngFromDescriptor(descriptor: AvatarDescriptor, size?: number, options?: PngRenderOptions): Uint8Array;
export function createAvatarPng(seed: unknown, size?: number, options?: PngOptions): Uint8Array;
export function createAvatarPng(seed: unknown, options?: PngOptions): Uint8Array;
export function avatarPngDataUri(seed: unknown, size?: number, options?: PngOptions): string;
export function avatarPngDataUri(seed: unknown, options?: PngOptions): string;
export function createAvatarPngSet(seed: unknown, options?: PngSetOptions): AvatarPngSet;
export function writeAvatarPngSet(seed: unknown, directory: string, options?: PngSetOptions): WrittenAvatarPngSet;
