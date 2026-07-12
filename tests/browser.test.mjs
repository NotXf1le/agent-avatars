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

    server = createServer((request, response) => {
      const path = request.url === "/bundle.js" ? bundlePath : join(scratchDirectory, "index.html");
      response.writeHead(200, {
        "Content-Type": path.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8",
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

    return { chromium: true, browserRoot: true, browserReact: true };
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolvePromise) => server.close(resolvePromise));
    rmSync(scratchDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({ ok: true, ...(await runBrowserTests()) }, null, 2));
}
