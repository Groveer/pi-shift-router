// Copy non-TS assets from src/ to dist/ after tsc compilation.
// Run via `npm run build` after tsc.

import { cpSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const srcPrompts = resolve(root, "src/prompts");
const distPrompts = resolve(root, "dist/prompts");

if (!existsSync(srcPrompts)) {
  console.error(`[copy-assets] Source not found: ${srcPrompts}`);
  process.exit(1);
}

mkdirSync(distPrompts, { recursive: true });
cpSync(srcPrompts, distPrompts, { recursive: true });
console.log(`[copy-assets] ${srcPrompts} → ${distPrompts}`);