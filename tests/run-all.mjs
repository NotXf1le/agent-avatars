import { performance } from "node:perf_hooks";
import { runCoreTests } from "./core.test.mjs";
import { runDemoTests } from "./demo.test.mjs";
import { runPngTests } from "./png.test.mjs";
import { runReactTests } from "./react.test.mjs";
import { runSecurityRegressionTests } from "./security-regressions.test.mjs";

const started = performance.now();
const core = await runCoreTests();
const demo = await runDemoTests();
const png = await runPngTests();
const react = await runReactTests();
const security = await runSecurityRegressionTests();
const durationMs = Math.round(performance.now() - started);

console.log(JSON.stringify({
  ok: true,
  durationMs,
  core,
  demo,
  png,
  react,
  security,
}, null, 2));
