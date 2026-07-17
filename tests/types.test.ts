import {
  createHashAvatar,
  createAvatarDescriptor,
  createIdentitySet,
  createIdentitySetWithFallback,
  hash32,
  STYLE_VERSION,
  type AvatarOptions,
  type HashOptions,
  type IdentityManifest,
  type IdentitySetOptions,
} from "agent-avatars";
import { createAvatarPng, createAvatarPngFromDescriptor, writeAvatarPngSet } from "agent-avatars/png";
import { derivePrivateSeed } from "agent-avatars/private";
import { AgentAvatar, type AgentAvatarProps } from "agent-avatars/react";

const options: AvatarOptions = {
  namespace: "acme",
  theme: "dark",
};

const svg: string = createHashAvatar("agent", { ...options, size: 64 });
const descriptor = createAvatarDescriptor("agent", options);
const result = createIdentitySet(["a", "b", "c"], options);
const identityOptions: IdentitySetOptions = {
  ...options,
  minimumShapeDistance: 2,
  minimumPaletteDistance: 12.5,
  distanceMode: "both",
};
const policyResult = createIdentitySet(["a", "b"], identityOptions);
const fallbackResult = createIdentitySetWithFallback(["a", "b"], identityOptions);
if (fallbackResult.policyAdjustment) {
  const adjustmentReason: "manifest-policy" | "capacity" = fallbackResult.policyAdjustment.reason;
  void adjustmentReason;
}
const explicitManifest: IdentityManifest = {
  schema: "deterministic-agent-avatars-manifest/v1",
  styleVersion: "1",
  namespaceKey: "namespace-key",
  optionsKey: "options-key",
  distinguishability: {
    schema: "visual-distance/v1",
    minimumShapeDistance: 2,
    minimumPaletteDistance: 12.5,
    mode: "both",
  },
  entries: {},
};
const returnedPolicy = policyResult.manifest.distinguishability;
if (returnedPolicy) {
  const schema: "visual-distance/v1" = returnedPolicy.schema;
  const shapeDistance: number = returnedPolicy.minimumShapeDistance;
  const paletteDistance: number = returnedPolicy.minimumPaletteDistance;
  const mode: "either" | "both" = returnedPolicy.mode;
  void schema;
  void shapeDistance;
  void paletteDistance;
  void mode;
}
// @ts-expect-error unsupported distance mode
const invalidIdentityOptions: IdentitySetOptions = { distanceMode: "all" };
// @ts-expect-error identity-set allocation owns per-identity collision nonces
const invalidIdentityNonce: IdentitySetOptions = { collisionNonce: 1 };
const signature: string = result.items[0].signature;
const png: Uint8Array = createAvatarPng("agent", { ...options, size: 32 });
const descriptorPng: Uint8Array = createAvatarPngFromDescriptor(descriptor, 32, { supersample: 2 });
// @ts-expect-error descriptor rendering does not reselect an avatar namespace
const invalidDescriptorPng: Uint8Array = createAvatarPngFromDescriptor(descriptor, 32, { namespace: "other" });
const reactProps: AgentAvatarProps = { seed: "agent", size: 40, options, alt: "Agent" };
// @ts-expect-error AgentAvatar owns the generated src attribute
const invalidReactProps: AgentAvatarProps = { seed: "agent", src: "manual.svg" };
// @ts-expect-error AgentAvatar size is controlled by the component prop
const invalidReactOptions: AgentAvatarProps = { seed: "agent", options: { size: 40 } };
const version: "1" = STYLE_VERSION;
const hashOptions: HashOptions = { namespace: "acme", domain: "consumer-test" };
const hash: number = hash32("agent", hashOptions);
void AgentAvatar;
void reactProps;
void invalidReactProps;
void descriptor;
void signature;
void explicitManifest;
void invalidIdentityOptions;
void invalidIdentityNonce;
void png;
void descriptorPng;
void invalidDescriptorPng;
void invalidReactOptions;
void png.byteLength;
void version;
void hash;
void svg;
void writeAvatarPngSet("agent", "./icons", options);
void derivePrivateSeed("person@example.com", { ...options, secret: "0123456789abcdef0123456789abcdef" });
