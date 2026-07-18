import { createHashAvatar } from "../src/index.mjs";

const BRAND_SEEDS = Object.freeze([
  "brand-constellation",
  "brand-orbit",
  "brand-signal",
  "brand-spark",
  "brand-radar",
  "brand-pulse",
  "brand-vector",
  "brand-comet",
]);

const brandAvatars = [...document.querySelectorAll("[data-brand-avatar]")];
let brandAvatarIndex = 0;

function svgDataUri(svg) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function renderBrandAvatar() {
  const svg = createHashAvatar(BRAND_SEEDS[brandAvatarIndex], {
    size: 34,
    namespace: "site-brand",
    theme: "light",
  });

  for (const avatar of brandAvatars) {
    avatar.src = svgDataUri(svg);
    avatar.classList.remove("is-changing");
    void avatar.offsetWidth;
    avatar.classList.add("is-changing");
  }
}

if (brandAvatars.length > 0) {
  renderBrandAvatar();
  window.setInterval(() => {
    if (document.hidden) return;
    brandAvatarIndex = (brandAvatarIndex + 1) % BRAND_SEEDS.length;
    renderBrandAvatar();
  }, 2600);
}
