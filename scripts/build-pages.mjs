import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "_site");
const pageFiles = Object.freeze([
  ".nojekyll",
  "index.html",
  "assets/docs.css",
  "assets/favicon.svg",
  "assets/site-attribution.mjs",
  "assets/site-brand.mjs",
  "compare/index.html",
  "docs/index.html",
  "examples/index.html",
  "identity-sets/index.html",
  "llms.txt",
  "private-avatars/index.html",
  "react/index.html",
  "robots.txt",
  "sitemap.xml",
  "examples/batch-uniqueness.png",
  "examples/deterministic-output.png",
  "examples/hero-agent-dashboard.png",
  "examples/private-seed-flow.png",
  "src/browser-clipboard.mjs",
  "src/browser-zip.mjs",
  "src/catalog-cache.mjs",
  "src/index.mjs",
  "src/render-descriptor.mjs",
  "src/visual-distance.mjs",
]);

function buildPages() {
  rmSync(output, { recursive: true, force: true });
  for (const relativePath of pageFiles) {
    const destination = join(output, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, relativePath), destination);
  }
  console.log(`Built GitHub Pages artifact with ${pageFiles.length} files in _site/.`);
  return { output, files: pageFiles.slice() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildPages();

export { buildPages, pageFiles };
