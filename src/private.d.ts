import type { AvatarDescriptor, AvatarOptions } from "./index.d.ts";

export interface PrivateAvatarOptions extends AvatarOptions {
  secret: string | Uint8Array;
}

export function derivePrivateSeed(value: unknown, options: PrivateAvatarOptions): Promise<string>;
export function createPrivateAvatarDescriptor(seed: unknown, options: PrivateAvatarOptions): Promise<AvatarDescriptor>;
export function createPrivateHashAvatar(seed: unknown, options: PrivateAvatarOptions): Promise<string>;
