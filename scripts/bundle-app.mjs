// ADR-002: apps/api and apps/worker depend on workspace packages (@helpflow/config,
// @helpflow/types, @helpflow/database, ...) that ship as raw .ts with no build step, so a plain
// `node dist/main.js` can't resolve their extensionless relative imports in a container that only
// has production node_modules. esbuild bundles the app's own code AND every @helpflow/* workspace
// package into one file, while leaving real npm dependencies (and node: builtins) as external
// requires — those are the packages actually installed into the runtime image's node_modules.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const [, , appDir, entry, outfile] = process.argv;
if (!appDir || !entry || !outfile) {
  console.error("Usage: node scripts/bundle-app.mjs <appDir> <entry> <outfile>");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(new URL(`../${appDir}/package.json`, import.meta.url)));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith("@helpflow/"));

await esbuild.build({
  entryPoints: [fileURLToPath(new URL(`../${appDir}/${entry}`, import.meta.url))],
  outfile: fileURLToPath(new URL(`../${appDir}/${outfile}`, import.meta.url)),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  external,
  logLevel: "info",
});
