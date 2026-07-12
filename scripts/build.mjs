import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const dist = join(root, "dist");

function read(name) {
  return readFileSync(join(src, name), "utf8");
}

function write(name, content) {
  writeFileSync(join(dist, name), content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function parseSpecifiers(body) {
  return body
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/);
      return match ? { local: match[1], exported: match[2] } : { local: item, exported: item };
    });
}

function parseSource(source, sourceLabel) {
  const sourceFile = ts.createSourceFile(
    sourceLabel,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostics = sourceFile.parseDiagnostics.map((diagnostic) => {
      const location = diagnostic.start === undefined
        ? ""
        : (() => {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
            return `:${line + 1}:${character + 1}`;
          })();
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      return `${sourceLabel}${location} TS${diagnostic.code}: ${message}`;
    });
    throw new SyntaxError(`Unable to transform invalid source:\n${diagnostics.join("\n")}`);
  }
  return sourceFile;
}

function transformCommonJsImports(source, importMap, sourceLabel = "./module.mjs") {
  const sourceFile = parseSource(source, sourceLabel);
  const replacements = [];
  for (const declaration of sourceFile.statements) {
    if (!ts.isImportDeclaration(declaration) || !ts.isStringLiteral(declaration.moduleSpecifier)) continue;

    const commonJsSpecifier = importMap.get(declaration.moduleSpecifier.text);
    if (commonJsSpecifier === undefined) continue;
    const importClause = declaration.importClause;
    let replacement;
    if (!importClause) {
      replacement = `require("${commonJsSpecifier}");`;
    } else if (importClause.name) {
      throw new Error(`Default imports are not supported when building ${sourceLabel} as CommonJS.`);
    } else if (importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
      replacement = `const ${importClause.namedBindings.name.text} = require("${commonJsSpecifier}");`;
    } else if (
      importClause.namedBindings
      && ts.isNamedImports(importClause.namedBindings)
      && importClause.namedBindings.elements.length > 0
    ) {
      const bindings = importClause.namedBindings.elements.map((specifier) => {
        const imported = specifier.propertyName?.text ?? specifier.name.text;
        const local = specifier.name.text;
        return imported === local ? imported : `${imported}: ${local}`;
      });
      replacement = `const { ${bindings.join(", ")} } = require("${commonJsSpecifier}");`;
    } else {
      throw new Error(`Unsupported import from ${declaration.moduleSpecifier.text} in ${sourceLabel}.`);
    }

    replacements.push({
      start: declaration.getStart(sourceFile),
      end: declaration.end,
      replacement,
    });
  }

  let transformed = source;
  for (let index = replacements.length - 1; index >= 0; index--) {
    const { start, end, replacement } = replacements[index];
    transformed = transformed.slice(0, start) + replacement + transformed.slice(end);
  }
  return transformed;
}

function transformVisualDistanceImport(source) {
  return transformCommonJsImports(
    source,
    new Map([["./visual-distance.mjs", "./visual-distance.cjs"]]),
    "./visual-distance.mjs"
  );
}

function assertNoStaticImports(body, name) {
  try {
    new Script(body, { filename: `${name}.cjs` });
  } catch (error) {
    throw new Error(`Unable to build ${name} as CommonJS: output is not valid CommonJS syntax.`, { cause: error });
  }
}

function buildCommonJs(name, transform = (source) => source) {
  const source = transform(read(`${name}.mjs`));
  const match = source.match(/\nexport\s*\{([\s\S]*?)\};\s*$/);
  if (!match) throw new Error(`Unable to locate the ${name} export block.`);
  const specifiers = parseSpecifiers(match[1]);
  const body = source.slice(0, match.index).trimEnd();
  assertNoStaticImports(body, name);
  const exports = specifiers.map(({ local, exported }) =>
    local === exported ? `  ${local},` : `  ${exported}: ${local},`
  );
  write(`${name}.cjs`, `${body}\n\nmodule.exports = {\n${exports.join("\n")}\n};`);
}

function buildDeclarationPair(name) {
  const source = read(`${name}.d.ts`);
  const forFormat = (runtimeExtension) => source.replaceAll(
    'from "./index.d.ts"',
    `from "./index.${runtimeExtension}"`
  );
  write(`${name}.d.mts`, forFormat("mjs"));
  write(`${name}.d.cts`, forFormat("cjs"));
}

function prepareOutputDirectory(outputDirectory) {
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
}

function build() {
  prepareOutputDirectory(dist);

  for (const name of [
    "index.mjs",
    "catalog-cache.mjs",
    "visual-distance.mjs",
    "render-descriptor.mjs",
    "png-options.mjs",
    "png.mjs",
    "react.mjs",
    "private.mjs",
  ]) {
    copyFileSync(join(src, name), join(dist, name));
  }

  for (const name of ["index", "png", "react", "private"]) buildDeclarationPair(name);

  buildCommonJs("catalog-cache");
  buildCommonJs("visual-distance");
  buildCommonJs("render-descriptor");
  buildCommonJs("png-options");
  buildCommonJs("index", (source) => transformCommonJsImports(source, new Map([
    ["./visual-distance.mjs", "./visual-distance.cjs"],
    ["./render-descriptor.mjs", "./render-descriptor.cjs"],
    ["./catalog-cache.mjs", "./catalog-cache.cjs"],
  ]), "./index.mjs"));
  buildCommonJs("png", (source) => transformCommonJsImports(source, new Map([
    ["node:zlib", "node:zlib"],
    ["node:fs", "node:fs"],
    ["node:path", "node:path"],
    ["./index.mjs", "./index.cjs"],
    ["./render-descriptor.mjs", "./render-descriptor.cjs"],
    ["./png-options.mjs", "./png-options.cjs"],
  ]), "./png.mjs"));
  buildCommonJs("react", (source) => transformCommonJsImports(source, new Map([
    ["react", "react"],
    ["./index.mjs", "./index.cjs"],
  ]), "./react.mjs"));
  buildCommonJs("private", (source) => transformCommonJsImports(source, new Map([
    ["node:crypto", "node:crypto"],
    ["./index.mjs", "./index.cjs"],
  ]), "./private.mjs"));

  console.log("Built ESM, CommonJS, and format-specific TypeScript declarations in dist/.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();

export {
  assertNoStaticImports,
  buildDeclarationPair,
  prepareOutputDirectory,
  transformCommonJsImports,
  transformVisualDistanceImport,
};
