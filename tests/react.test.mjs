import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentAvatar, HashAvatar } from "../src/react.mjs";

export async function runReactTests() {
  assert.equal(HashAvatar, AgentAvatar);
  assert.equal(AgentAvatar.$$typeof, Symbol.for("react.forward_ref"));

  const markup = renderToStaticMarkup(React.createElement(AgentAvatar, {
    seed: "react-render",
    size: 48,
    width: "100%",
    height: 50,
    options: { namespace: "react-tests", theme: "dark" },
    alt: "Rendered agent",
    className: "agent-avatar",
    loading: "lazy",
    "data-avatar-test": "rendered",
  }));

  assert.match(markup, /<img\b/);
  assert.match(markup, /src="data:image\/svg\+xml;charset=UTF-8,/);
  assert.match(markup, /alt="Rendered agent"/);
  assert.match(markup, /width="100%"/);
  assert.match(markup, /height="50"/);
  assert.match(markup, /class="agent-avatar"/);
  assert.match(markup, /loading="lazy"/);
  assert.match(markup, /data-avatar-test="rendered"/);

  return {
    reactVersion: React.version,
    staticRender: true,
    forwardedRefComponent: true,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runReactTests();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}
