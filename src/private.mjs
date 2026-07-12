import { webcrypto } from "node:crypto";
import {
  STYLE_VERSION,
  canonicalSeed,
  createAvatarDescriptor,
  createHashAvatarFromDescriptor,
} from "./index.mjs";

// Compatibility identifier: changing this would change deterministic outputs.
const LIBRARY_ID = "deterministic-agent-avatars";
const DEFAULT_NAMESPACE = "default";
const UTF8 = new TextEncoder();
const MIN_SECRET_BYTES = 32;

function assertSecretLength(secret) {
  if (secret.byteLength < MIN_SECRET_BYTES) {
    throw new TypeError(`secret must contain at least ${MIN_SECRET_BYTES} encoded bytes.`);
  }
  return secret;
}

function encodePart(value) {
  return `${value.length}:${value}`;
}

function canonicalNamespace(value, mode = "human") {
  const normalized = canonicalSeed(value ?? DEFAULT_NAMESPACE, mode);
  if (normalized.length === 0) {
    throw new TypeError("namespace must not be empty after canonicalization.");
  }
  return normalized;
}

function domainMessage(domain, canonical, namespace, nonce = 0) {
  return `${LIBRARY_ID}\u0000${STYLE_VERSION}\u0000${domain}\u0000${encodePart(namespace)}\u0000${encodePart(canonical)}\u0000${nonce}`;
}

function secretBytes(secret) {
  if (typeof secret === "string") {
    if (secret.length === 0) throw new TypeError("secret must not be empty.");
    return assertSecretLength(UTF8.encode(secret));
  }
  if (secret instanceof Uint8Array) {
    if (secret.byteLength === 0) throw new TypeError("secret must not be empty.");
    return assertSecretLength(secret);
  }
  throw new TypeError("secret must be a non-empty string or Uint8Array.");
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function derivePrivateSeed(value, options = {}) {
  const secret = secretBytes(options.secret);
  const seedMode = options.seedMode ?? "human";
  const namespaceMode = options.namespaceMode ?? "human";
  const canonical = canonicalSeed(value, seedMode);
  const namespace = canonicalNamespace(options.namespace ?? DEFAULT_NAMESPACE, namespaceMode);
  const key = await webcrypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const message = UTF8.encode(domainMessage("private-seed", canonical, namespace, 0));
  const signature = await webcrypto.subtle.sign("HMAC", key, message);
  return `hmac-sha256:${bytesToHex(new Uint8Array(signature))}`;
}

async function createPrivateAvatarDescriptor(seed, options = {}) {
  const privateSeed = await derivePrivateSeed(seed, options);
  const avatarOptions = { ...options, seedMode: "raw" };
  delete avatarOptions.secret;
  return createAvatarDescriptor(privateSeed, avatarOptions);
}

async function createPrivateHashAvatar(seed, options = {}) {
  const descriptor = await createPrivateAvatarDescriptor(seed, options);
  return createHashAvatarFromDescriptor(descriptor, options.size ?? 96);
}

export {
  derivePrivateSeed,
  createPrivateAvatarDescriptor,
  createPrivateHashAvatar,
};
