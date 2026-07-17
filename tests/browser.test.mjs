import assert from "node:assert/strict";
import { createReadStream, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testsDirectory, "..");

function importSpecifier(fromDirectory, path) {
  const specifier = relative(fromDirectory, path).replaceAll("\\", "/");
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

export async function runBrowserTests() {
  const scratchDirectory = mkdtempSync(join(tmpdir(), "agent-avatars-browser-"));
  let browser;
  let server;
  try {
    const entryPath = join(scratchDirectory, "entry.mjs");
    const bundlePath = join(scratchDirectory, "bundle.js");
    const rootEntry = importSpecifier(scratchDirectory, join(projectRoot, "dist", "index.mjs"));
    const reactEntry = importSpecifier(scratchDirectory, join(projectRoot, "dist", "react.mjs"));
    writeFileSync(entryPath, `
      import * as React from "react";
      import { createRoot } from "react-dom/client";
      import { createHashAvatar } from ${JSON.stringify(rootEntry)};
      import { AgentAvatar } from ${JSON.stringify(reactEntry)};

      const rootSvg = createHashAvatar("browser-smoke", { namespace: "browser", size: 48 });
      const mount = document.getElementById("mount");
      createRoot(mount).render(React.createElement(AgentAvatar, {
        seed: "browser-react-smoke",
        size: 40,
        options: { namespace: "browser", theme: "dark" },
        alt: "Browser avatar",
      }));
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const image = mount.querySelector("img");
        globalThis.__avatarSmoke = {
          rootSvg: rootSvg.startsWith("<svg"),
          reactImage: image instanceof HTMLImageElement,
          src: image?.getAttribute("src") ?? "",
          width: image?.getAttribute("width") ?? "",
          alt: image?.getAttribute("alt") ?? "",
        };
      }));
    `, "utf8");
    writeFileSync(join(scratchDirectory, "index.html"), "<!doctype html><div id=\"mount\"></div><script src=\"/bundle.js\"></script>\n", "utf8");

    await build({
      entryPoints: [entryPath],
      bundle: true,
      format: "iife",
      platform: "browser",
      nodePaths: [join(projectRoot, "node_modules")],
      outfile: bundlePath,
      logLevel: "silent",
    });

    const demoFiles = new Map([
      ["/demo/index.html", join(projectRoot, "index.html")],
      ["/demo/src/browser-clipboard.mjs", join(projectRoot, "src", "browser-clipboard.mjs")],
      ["/demo/src/browser-zip.mjs", join(projectRoot, "src", "browser-zip.mjs")],
      ["/demo/src/catalog-cache.mjs", join(projectRoot, "src", "catalog-cache.mjs")],
      ["/demo/src/index.mjs", join(projectRoot, "src", "index.mjs")],
      ["/demo/src/render-descriptor.mjs", join(projectRoot, "src", "render-descriptor.mjs")],
      ["/demo/src/visual-distance.mjs", join(projectRoot, "src", "visual-distance.mjs")],
    ]);

    server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      const path = pathname === "/bundle.js"
        ? bundlePath
        : demoFiles.get(pathname) ?? join(scratchDirectory, "index.html");
      response.writeHead(200, {
        "Content-Type": /\.m?js$/.test(path) ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8",
      });
      createReadStream(path).pipe(response);
    });
    await new Promise((resolvePromise, rejectPromise) => {
      server.once("error", rejectPromise);
      server.listen(0, "127.0.0.1", resolvePromise);
    });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const address = server.address();
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(globalThis.__avatarSmoke));
    const result = await page.evaluate(() => globalThis.__avatarSmoke);

    assert.deepEqual(pageErrors, []);
    assert.equal(result.rootSvg, true);
    assert.equal(result.reactImage, true);
    assert.match(result.src, /^data:image\/svg\+xml;charset=UTF-8,/);
    assert.equal(result.width, "40");
    assert.equal(result.alt, "Browser avatar");

    await page.setViewportSize({ width: 500, height: 900 });
    await page.goto(`http://127.0.0.1:${address.port}/demo/index.html#playground`, { waitUntil: "networkidle" });
    await page.locator("#set-mode-tab").click();
    await page.waitForFunction(() => document.querySelector("#set-count")?.textContent?.includes("ready"));
    const mobileLayout = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
      const header = rect(".set-workspace-head");
      const title = rect(".set-title-block");
      const sizeControl = rect(".set-size-control");
      const grid = document.querySelector(".set-grid");
      return {
        headerHeight: header.height,
        titleHeight: title.height,
        sizeControlHeight: sizeControl.height,
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    assert.ok(mobileLayout.headerHeight < 360, `Mobile set header is unexpectedly tall: ${mobileLayout.headerHeight}px.`);
    assert.ok(mobileLayout.titleHeight < 90, `Mobile set title is unexpectedly tall: ${mobileLayout.titleHeight}px.`);
    assert.ok(mobileLayout.sizeControlHeight < 80, `Mobile size control is unexpectedly tall: ${mobileLayout.sizeControlHeight}px.`);
    assert.equal(mobileLayout.columns, 1);
    assert.ok(mobileLayout.horizontalOverflow <= 0, `Mobile demo overflows horizontally by ${mobileLayout.horizontalOverflow}px.`);

    await page.locator(".set-item-main").first().click();
    const mobileActions = await page.locator(".set-item.is-selected .set-item-actions").evaluate((actions) => {
      const bounds = actions.getBoundingClientRect();
      return [...actions.children].map((child) => {
        const rect = child.getBoundingClientRect();
        return {
          withinBounds: rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1,
          contentFits: child.scrollWidth <= child.clientWidth + 1,
        };
      });
    });
    assert.ok(mobileActions.every((action) => action.withinBounds));
    assert.ok(mobileActions.every((action) => action.contentFits));
    assert.deepEqual(pageErrors, []);

    return { chromium: true, browserRoot: true, browserReact: true, responsiveDemo: true };
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolvePromise) => server.close(resolvePromise));
    rmSync(scratchDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({ ok: true, ...(await runBrowserTests()) }, null, 2));
}
