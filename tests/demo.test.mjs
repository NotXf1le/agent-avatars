import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { copyTextToClipboard } from "../src/browser-clipboard.mjs";

function createClipboardDocument(copyResult) {
  const state = { appended: undefined, removed: false, selected: false };
  const textarea = {
    value: "",
    style: {},
    setAttribute() {},
    select() {
      state.selected = true;
    },
    remove() {
      state.removed = true;
    },
  };
  return {
    state,
    document: {
      body: {
        append(node) {
          state.appended = node;
        },
      },
      createElement(name) {
        assert.equal(name, "textarea");
        return textarea;
      },
      execCommand(command) {
        assert.equal(command, "copy");
        return copyResult;
      },
    },
  };
}

export async function runDemoTests() {
  const demoUrl = new URL("../index.html", import.meta.url);
  const oldDemoUrl = new URL("../examples/demo.html", import.meta.url);
  const noJekyllUrl = new URL("../.nojekyll", import.meta.url);

  assert.equal(existsSync(demoUrl), true, "GitHub Pages root index.html is missing.");
  assert.equal(existsSync(oldDemoUrl), false, "Only one public demo page should exist.");
  assert.equal(existsSync(noJekyllUrl), true, ".nojekyll is required for static GitHub Pages delivery.");

  const html = readFileSync(demoUrl, "utf8");
  const moduleMatch = html.match(/from\s*["']([^"']*src\/index\.mjs)["']/);

  assert.ok(moduleMatch, "Demo must import the source module with a relative path.");
  assert.equal(moduleMatch[1], "./src/index.mjs");
  assert.equal(html.includes("/dist/"), false, "Demo must not depend on generated dist files.");
  assert.equal(html.includes("width: min(100% - 24px, 1180px)"), false, "Mobile container math must use calc().");
  assert.match(html, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(html, /\.showcase-page\s*\{[^}]*flex:\s*0 0 100%/);
  assert.match(html, /copyTextToClipboard/);
  assert.equal(html.includes("acme"), false, "Demo defaults must use audience-friendly example names.");
  assert.match(html, /Identity seed/);
  assert.match(html, /Project namespace/);
  assert.match(html, /value="research-assistant"/);
  assert.match(html, /value="My Project"/);
  assert.equal(html.includes("storage.ko-fi.com"), false, "Demo must not execute mutable third-party scripts.");
  assert.match(html, /href="https:\/\/ko-fi\.com\/felixkoba"/);

  const moduleUrl = new URL(moduleMatch[1], demoUrl);
  assert.equal(existsSync(moduleUrl), true, `Demo module is missing: ${moduleUrl.pathname}`);

  const module = await import(moduleUrl.href);
  assert.equal(typeof module.createHashAvatar, "function");

  const writes = [];
  assert.equal(await copyTextToClipboard("primary", {
    clipboard: { writeText: async (value) => writes.push(value) },
    document: null,
  }), "clipboard-api");
  assert.deepEqual(writes, ["primary"]);

  const fallback = createClipboardDocument(true);
  assert.equal(await copyTextToClipboard("fallback", {
    clipboard: { writeText: async () => { throw new Error("denied"); } },
    document: fallback.document,
  }), "legacy-copy");
  assert.equal(fallback.state.appended.value, "fallback");
  assert.equal(fallback.state.selected, true);
  assert.equal(fallback.state.removed, true);

  const rejected = createClipboardDocument(false);
  await assert.rejects(
    copyTextToClipboard("rejected", { clipboard: null, document: rejected.document }),
    /Clipboard copy was rejected by the browser/
  );
  assert.equal(rejected.state.removed, true);

  return {
    entry: "index.html",
    sourceModule: moduleMatch[1],
    githubPagesRoot: true,
    friendlyDefaults: true,
    thirdPartyScripts: false,
    clipboardFallback: true,
  };
}
