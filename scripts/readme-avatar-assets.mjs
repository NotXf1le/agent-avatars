import { createAvatarDescriptor, createIdentitySet } from "../src/index.mjs";
import { createAvatarPng, createAvatarPngFromDescriptor } from "../src/png.mjs";
import { shapeHammingDistance } from "../src/visual-distance.mjs";

const SUPERSAMPLE = 4;

function avatar(seed, size, options = {}) {
  const descriptorOptions = {
    namespace: options.namespace,
    palette: options.palette,
    theme: options.theme ?? "light",
    collisionNonce: options.collisionNonce ?? 0,
  };
  const descriptor = createAvatarDescriptor(seed, descriptorOptions);
  const png = createAvatarPng(seed, {
    ...descriptorOptions,
    size,
    supersample: SUPERSAMPLE,
  });
  return {
    seed,
    namespace: descriptor.namespace,
    paletteId: descriptor.paletteId,
    shapeId: descriptor.shapeId,
    signature: descriptor.signature,
    collisionNonce: descriptor.collisionNonce,
    theme: descriptor.theme,
    size,
    png: png.toString("base64"),
  };
}

function avatarFromDescriptor(descriptor, size, colors = descriptor.colors) {
  const renderable = { ...descriptor, colors };
  const png = createAvatarPngFromDescriptor(renderable, size, { supersample: SUPERSAMPLE });
  return {
    seed: descriptor.canonicalSeed,
    namespace: descriptor.namespace,
    paletteId: descriptor.paletteId,
    shapeId: descriptor.shapeId,
    signature: descriptor.signature,
    collisionNonce: descriptor.collisionNonce,
    theme: descriptor.theme,
    size,
    png: png.toString("base64"),
  };
}

const heroSpecs = [
  ["research-agent", "leaf"],
  ["coding-agent", "aqua"],
  ["support-agent", "sand"],
  ["billing-agent", "sky"],
  ["reviewer", "coral"],
  ["deployment-bot", "lilac"],
];

const gallerySpecs = [
  ["research-agent", "leaf"],
  ["support-agent", "indigo"],
  ["billing-agent", "aqua"],
  ["security-agent", "sand"],
  ["planner", "orchid"],
  ["reviewer", "coral"],
  ["deploy-bot", "apricot"],
  ["analytics", "ice"],
];

const themeSpecs = [
  ["research-agent", "apricot"],
  ["coding-agent", "ice"],
  ["reviewer", "violet"],
  ["deployment-bot", "lime"],
];

const cycleSpecs = [
  ["avatar-cycle", "leaf"],
  ["avatar-cycle", "indigo"],
  ["avatar-cycle", "aqua"],
  ["avatar-cycle", "sand"],
  ["avatar-cycle", "orchid"],
  ["avatar-cycle", "coral"],
  ["avatar-cycle", "apricot"],
  ["avatar-cycle", "ice"],
];

function allocateDiverse(specs, namespace, minimumShapeDistance = 7) {
  const allocated = [];
  for (const [seed, palette] of specs) {
    let selected;
    for (let collisionNonce = 0; collisionNonce < 10_000; collisionNonce++) {
      const descriptor = createAvatarDescriptor(seed, {
        namespace,
        palette,
        collisionNonce,
      });
      if (allocated.every((item) => (
        shapeHammingDistance(item.descriptor.rows, descriptor.rows) >= minimumShapeDistance
      ))) {
        selected = { seed, palette, collisionNonce, descriptor };
        break;
      }
    }
    if (!selected) {
      throw new Error(`Could not allocate a diverse README avatar for ${seed}.`);
    }
    allocated.push(selected);
  }
  return allocated;
}

const diverseHero = allocateDiverse(heroSpecs, "readme-hero-diverse");
const diverseGallery = allocateDiverse(gallerySpecs, "readme-gallery-diverse");
const diverseThemes = allocateDiverse(themeSpecs, "readme-themes-diverse");
const diverseCycle = allocateDiverse(cycleSpecs, "readme-avatar-cycle");

const batch = createIdentitySet(
  ["research", "coding", "support", "billing", "reviewer", "deployment"],
  {
    namespace: "readme-batch",
    includeSvg: false,
    minimumShapeDistance: 4,
    minimumPaletteDistance: 20,
    distanceMode: "either",
  },
);

const mutedNaiveColors = Object.freeze({ background: "#E3E0EA", foreground: "#5B5861" });

const output = {
  provenance: {
    renderer: "src/png.mjs#createAvatarPng/createAvatarPngFromDescriptor",
    supersample: SUPERSAMPLE,
    minimumShapeDistance: 7,
  },
  hero: diverseHero.map((item) => avatar(item.seed, 52, {
    namespace: "readme-hero-diverse",
    palette: item.palette,
    collisionNonce: item.collisionNonce,
  })),
  heroChat: [0, 1, 4].map((index) => {
    const item = diverseHero[index];
    return avatar(item.seed, 48, {
      namespace: "readme-hero-diverse",
      palette: item.palette,
      collisionNonce: item.collisionNonce,
    });
  }),
  gallery: diverseGallery.map((item) => ({
    light: avatar(item.seed, 84, {
      namespace: "readme-gallery-diverse",
      palette: item.palette,
      theme: "light",
      collisionNonce: item.collisionNonce,
    }),
    dark: avatar(item.seed, 84, {
      namespace: "readme-gallery-diverse",
      palette: item.palette,
      theme: "dark",
      collisionNonce: item.collisionNonce,
    }),
  })),
  deterministic: avatar("research-agent", 128, { namespace: "acme-agents" }),
  batchNaive: batch.items.map((item, index) => (
    avatarFromDescriptor(batch.items[index % 3].descriptor, 72, mutedNaiveColors)
  )),
  batch: batch.items.map((item) => avatarFromDescriptor(item.descriptor, 88)),
  themes: diverseThemes.map((item) => ({
    light: avatar(item.seed, 48, {
      namespace: "readme-themes-diverse",
      palette: item.palette,
      theme: "light",
      collisionNonce: item.collisionNonce,
    }),
    dark: avatar(item.seed, 48, {
      namespace: "readme-themes-diverse",
      palette: item.palette,
      theme: "dark",
      collisionNonce: item.collisionNonce,
    }),
  })),
  cycle: diverseCycle.map((item) => avatar(item.seed, 256, {
    namespace: "readme-avatar-cycle",
    palette: item.palette,
    collisionNonce: item.collisionNonce,
  })),
  private: avatar("person@example.com", 104, {
    namespace: "private-demo",
    palette: "rose",
  }),
};

process.stdout.write(JSON.stringify(output));
