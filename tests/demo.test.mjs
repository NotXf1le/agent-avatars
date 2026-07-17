import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { copyTextToClipboard } from "../src/browser-clipboard.mjs";
import { createStoredZip, uniqueArchiveFilename } from "../src/browser-zip.mjs";

function testCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function readStoredZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const compression = view.getUint16(offset + 8, true);
    const checksum = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const data = bytes.slice(dataStart, dataStart + size);
    assert.equal(compression, 0);
    assert.equal(testCrc32(data), checksum);
    entries.push({ name: decoder.decode(bytes.slice(nameStart, nameStart + nameLength)), data });
    offset = dataStart + size;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length - 12, true), entries.length);
  return entries;
}

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
  assert.match(html, /from "\.\/src\/browser-zip\.mjs"/);
  assert.equal(html.includes("/dist/"), false, "Demo must not depend on generated dist files.");
  assert.equal(html.includes("width: min(100% - 24px, 1180px)"), false, "Mobile container math must use calc().");
  assert.match(html, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(html, /\.showcase-page\s*\{[^}]*flex:\s*0 0 100%/);
  assert.match(html, /copyTextToClipboard/);
  assert.equal(html.includes("acme"), false, "Demo defaults must use audience-friendly example names.");
  assert.match(html, /Identity seed/);
  assert.match(html, /class="single-workspace"/);
  assert.match(html, /\.playground-shell\.is-dark-avatar-theme\s*\{[^}]*color:\s*var\(--ink\)/);
  assert.match(html, /function syncGeneratorSurfaceTheme\(generator, avatarTheme\)/);
  assert.match(html, /syncGeneratorSurfaceTheme\(singleGenerator, theme\.value\)/);
  assert.match(html, /syncGeneratorSurfaceTheme\(setGenerator, setTheme\.value\)/);
  assert.match(html, /class="single-head-actions"/);
  assert.match(html, /\.single-export-bar\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center/);
  assert.match(html, /\.single-workspace-head\s*\{[^}]*min-height:\s*86px/);
  assert.match(html, /\.set-workspace-head\s*\{[^}]*min-height:\s*86px/);
  assert.match(html, /\.set-preview-panel\s*\{[^}]*gap:\s*16px/);
  assert.match(html, /\.single-seed-field > \.field-label, \.set-title-block h3\s*\{[^}]*font-size:\s*\.88rem/);
  assert.match(html, /id="preview-title">Avatar preview<\/h3>/);
  assert.equal(html.includes('id="png-size"'), false, "PNG size should be chosen only after opening the download action.");
  assert.match(html, /id="single-download-menu"/);
  assert.match(html, />Download<\/summary>/);
  assert.match(html, /single-download-section-title">PNG sizes<\/p>[\s\S]*single-download-svg-title">SVG<\/p>[\s\S]*id="download-svg"[^>]*>Download SVG<\/button>[\s\S]*<\/details>[\s\S]*id="copy-png"[\s\S]*id="copy-svg"/);
  assert.match(html, /\.single-download-options\s*\{[^}]*top:\s*calc\(100% \+ 8px\);[^}]*bottom:\s*auto;[^}]*width:\s*100%/);
  for (const size of [32, 64, 192, 200]) assert.match(html, new RegExp(`data-png-size="${size}"`));
  assert.match(html, /singleDownloadMenu\.open = false/);
  assert.match(html, /singleSettingsMenu\.open && !singleSettingsMenu\.contains\(event\.target\)/);
  assert.match(html, /if \(singleSettingsMenu\.open\) singleDownloadMenu\.open = false/);
  assert.match(html, /if \(singleDownloadMenu\.open\) singleSettingsMenu\.open = false/);
  assert.match(html, /theme\.addEventListener\("input", \(\) => \{\s*render\(\);\s*singleSettingsMenu\.open = false;/);
  assert.equal(html.includes("More formats"), false, "Single-avatar export choices should be visible without opening a menu.");
  assert.equal(html.includes("Same input, same avatar"), false, "Single-avatar UI should avoid redundant deterministic-value badges.");
  assert.equal(html.includes("View generated SVG"), false, "Generated source should not compete with the export actions.");
  assert.equal(html.includes("identity-caption"), false, "Single-avatar preview should not repeat identity metadata in a floating caption.");
  assert.match(html, /Identity set/);
  assert.match(html, /id="random-seed"/);
  assert.match(html, /id="random-set-seeds"/);
  assert.match(html, /class="set-size-control"[\s\S]*id="random-set-seeds"[\s\S]*<\/div>\s*<div class="set-workspace-actions"/);
  assert.match(html, /\.random-seed-button\.is-rolling svg\s*\{[^}]*animation:\s*random-die-roll/);
  assert.match(html, /@keyframes random-die-roll/);
  assert.match(html, /prefers-reduced-motion:\s*reduce/);
  assert.match(html, /function animateRandomizeButton\(button\)/);
  assert.match(html, /animateRandomizeButton\(randomSeedButton\)/);
  assert.match(html, /animateRandomizeButton\(randomSetSeedsButton\)/);
  assert.match(html, /const identitySeedPool = \[/);
  assert.match(html, /randomIdentitySeeds\(desiredSetSize\)/);
  assert.match(html, /Project namespace/);
  assert.match(html, /value="research-assistant"/);
  assert.match(html, /value="My Project"/);
  assert.match(html, /id="set-size-range"[^>]*min="2"[^>]*max="64"/);
  assert.match(html, /class="set-size-control"/);
  assert.match(html, /\.set-item:hover \.set-item-main strong[^}]*opacity:\s*0/);
  assert.match(html, /id="set-separation"/);
  assert.match(html, /value="basic">Subtle/);
  assert.match(html, /value="balanced" selected>Balanced/);
  assert.match(html, /value="strong">Strong/);
  assert.equal(html.includes('id="set-shape-range"'), false);
  assert.equal(html.includes('id="set-palette-range"'), false);
  assert.equal(html.includes('id="set-distance-mode"'), false);
  assert.equal(html.includes("Include SVG source"), false);
  assert.equal(html.includes("Maximum allocation attempts"), false);
  assert.match(html, /id="set-manifest-file"/);
  assert.match(html, /createIdentitySetWithFallback/);
  assert.match(html, /class="generator-section" id="playground"/);
  assert.match(html, /height:\s*calc\(100dvh - 202px\)/);
  assert.match(html, /id="set-grid-wrap"|class="set-grid-wrap"/);
  assert.match(html, /id="set-export-actions">/);
  assert.match(html, /id="set-download-menu"[\s\S]*<summary class="button button-accent" aria-disabled="true">Download/);
  assert.match(html, /data-set-png-size="32"[\s\S]*data-set-png-size="64"[\s\S]*data-set-png-size="192"[\s\S]*data-set-png-size="200"/);
  assert.match(html, /id="copy-set-png"/);
  assert.match(html, /id="copy-set-svg"/);
  assert.match(html, /id="download-set-svg"/);
  assert.equal(html.includes("setExportActions.hidden"), false, "Export controls must stay mounted so the header does not shift while generating.");
  assert.match(html, /setDownloadMenu\.open = false/);
  assert.match(html, /createSetPngArchive\(currentSetResult, size\)/);
  assert.match(html, /createSetSvgArchive\(currentSetResult\)/);
  assert.match(html, /createStoredZip\(files\)/);
  assert.match(html, /files\.push\(\{ name: "manifest\.json"/);
  assert.match(html, /identity-set-png-\$\{size\}\.zip/);
  assert.match(html, /identity-set-svg\.zip/);
  assert.match(html, /copyText\(createSetSvgSheet\(currentSetResult\), "Identity set SVG copied\./);
  assert.match(html, /className = "set-item-download-menu"/);
  assert.match(html, /copyPngImage\(svg, defaultPngSize, copyPngButton/);
  assert.match(html, /download\(blob, `\$\{safeFilename\(itemName\)\}-\$\{size\}\.png`\)/);
  assert.match(html, /id="set-seeds-preview"/);
  assert.match(html, /id="set-seed-dialog"/);
  assert.match(html, /id="open-set-seed-editor"/);
  assert.match(html, /id="close-set-seed-editor"/);
  assert.match(html, /id="set-seed-editor-count"/);
  assert.match(html, /previewSeeds\.join/);
  assert.match(html, /setSeedDialog\.hidden = false/);
  assert.match(html, /setSeedDialog\.hidden = true/);
  assert.match(html, /id="set-settings-dialog"/);
  assert.match(html, /id="open-set-settings"/);
  assert.match(html, /id="close-set-settings"/);
  assert.match(html, /setSettingsDialog\.showModal\(\)/);
  assert.match(html, /setSettingsDialog\.close\(\)/);
  assert.match(html, /html:has\(\.set-settings-dialog\[open\]\) \{ overflow:\s*hidden/);
  assert.match(html, /<h3 id="set-preview-title">Agent avatars<\/h3>/);
  assert.equal(html.includes('id="set-summary"'), false, "Identity set header must not repeat the project namespace.");
  assert.match(html, /class="set-grid" id="set-grid"/);
  assert.match(html, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(html, /setCount\.textContent = `\$\{result\.items\.length\} avatars ready`/);
  assert.equal(html.includes("scrollbar-width: none"), false, "Native scrollbars must remain visible where scrolling is necessary.");
  assert.equal(html.includes("scrollbar-gutter: stable"), false, "Generator panels must not reserve space for nested scrollbar chrome.");
  assert.equal(html.includes('id="generate-set"'), false, "Identity sets must update without a generate button.");
  assert.match(html, /scheduleIdentitySetGeneration/);
  assert.match(html, /setSizeRange\.addEventListener\("input"/);
  assert.match(html, /function getDisplayedSetItems\(result\)/);
  assert.match(html, /return \[\.\.\.result\.items\]\.reverse\(\)/);
  assert.match(html, /@media \(max-width: 640px\)[\s\S]*\.set-title-block \{ flex: 0 0 auto; \}/);
  assert.match(html, /@media \(max-width: 640px\)[\s\S]*\.set-size-control \{[^}]*flex: 0 0 auto;/);
  assert.match(html, /@media \(max-width: 560px\)[\s\S]*\.set-grid \{ grid-template-columns: 1fr; \}/);
  assert.equal(html.includes("Advanced settings"), false, "Identity set controls must not use a nested advanced panel.");
  assert.equal(html.includes("catalog-stats"), false, "Generator workspace must not contain marketing statistic cards.");
  assert.equal(html.includes("Never reuse the same avatar"), false, "Package invariants must not be rendered as disabled settings.");
  assert.equal(html.includes("storage.ko-fi.com"), false, "Demo must not execute mutable third-party scripts.");
  assert.match(html, /href="https:\/\/ko-fi\.com\/felixkoba"/);

  const moduleUrl = new URL(moduleMatch[1], demoUrl);
  assert.equal(existsSync(moduleUrl), true, `Demo module is missing: ${moduleUrl.pathname}`);

  const module = await import(moduleUrl.href);
  assert.equal(typeof module.createHashAvatar, "function");
  assert.equal(typeof module.createIdentitySet, "function");
  assert.equal(typeof module.createIdentitySetWithFallback, "function");
  const identitySet = module.createIdentitySet(["research", "support"], {
    namespace: "demo-test",
    minimumShapeDistance: 2,
    distanceMode: "either",
  });
  assert.equal(identitySet.items.length, 2);
  assert.equal(Object.keys(identitySet.manifest.entries).length, 2);

  const encoder = new TextEncoder();
  const zip = createStoredZip([
    { name: "avatar.svg", data: encoder.encode("<svg/>") },
    { name: "manifest.json", data: encoder.encode('{"ok":true}') },
  ], new Date("2026-07-17T12:00:00Z"));
  assert.equal(zip.type, "application/zip");
  const zipEntries = await readStoredZip(zip);
  assert.deepEqual(zipEntries.map((entry) => entry.name), ["avatar.svg", "manifest.json"]);
  assert.equal(new TextDecoder().decode(zipEntries[0].data), "<svg/>");
  assert.equal(new TextDecoder().decode(zipEntries[1].data), '{"ok":true}');

  const usedArchiveNames = new Set();
  const longArchiveName = uniqueArchiveFilename("a".repeat(70_000), "png", usedArchiveNames);
  assert.ok(longArchiveName.length <= 90);
  assert.match(longArchiveName, /^a+-[0-9a-f]{8}\.png$/);
  assert.equal(uniqueArchiveFilename("same", "svg", usedArchiveNames), "same.svg");
  assert.equal(uniqueArchiveFilename("same", "svg", usedArchiveNames), "same-2.svg");
  assert.throws(
    () => createStoredZip([{ name: "a".repeat(70_000), data: new Uint8Array() }]),
    /ZIP entry names must contain/
  );

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
    zipBinaryValidation: true,
  };
}
