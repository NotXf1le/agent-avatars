import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const portValue = Number(process.env.PORT ?? 4173);
if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65_535) {
  throw new TypeError("PORT must be an integer in [1, 65535].");
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
]);

const server = createServer((request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const relativePath = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    let path = resolve(root, `.${relativePath}`);
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (statSync(path).isDirectory()) {
      if (!requestUrl.pathname.endsWith("/")) {
        response.writeHead(301, { Location: `${requestUrl.pathname}/${requestUrl.search}` }).end();
        return;
      }
      path = join(path, "index.html");
    }
    if (!statSync(path).isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": contentTypes.get(extname(path)) ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(portValue, "127.0.0.1", () => {
  console.log(`Demo available at http://127.0.0.1:${portValue}/`);
});
