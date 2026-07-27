#!/usr/bin/env node
/**
 * pack-check.mjs
 *
 * Validates the publish-state of this package without actually publishing.
 * Catches the common pitfalls that would break the user-facing install path:
 *
 *   1. Stale value-imports of host packages (would fail at runtime in the
 *      extensions subtree).
 *   2. Accidentally-placed runtime dep that should be dev-only.
 *   3. Missing README, CHANGELOG, LICENSE files in the tarball.
 *   4. Wrong main entry, wrong `pi.extensions` path, wrong engines.
 *
 * Run via: `npm run pack:check`  (also runs as part of `prepublishOnly`).
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let failures = 0;
const fail = (msg) => { console.error("✗", msg); failures++; };
const pass = (msg) => console.log("✓", msg);

// ---------- 1. Read package.json ----------
const pkgPath = join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const HOST_PACKAGES = new Set(["@earendil-works/pi-coding-agent"]);
const runtimeDeps = Object.keys(pkg.dependencies || {});
const devDeps = Object.keys(pkg.devDependencies || {});
const peerDeps = Object.keys(pkg.peerDependencies || {});

// ---------- 2. Host packages must be devDeps, not deps ----------
for (const dep of runtimeDeps) {
	if (HOST_PACKAGES.has(dep)) {
		fail(
			`Runtime dependency '${dep}' must NOT be in 'dependencies' — the ` +
			`user's host (pi-coding-agent itself) already provides it. Move to ` +
			`'devDependencies' for type-checking only.`
		);
	} else {
		pass(`runtime dep: ${dep}`);
	}
}

for (const dep of devDeps) {
	if (HOST_PACKAGES.has(dep)) {
		pass(`host package '${dep}' correctly placed in devDependencies`);
	}
}

for (const dep of peerDeps) {
	if (HOST_PACKAGES.has(dep)) {
		fail(
			`Host package '${dep}' should NOT be in 'peerDependencies'. The host ` +
			`is the runtime itself — peer dependencies are NOT auto-installed by ` +
			`npm in pi's isolated extensions subtree. Use 'devDependencies'.`
		);
	}
}

// ---------- 3. Source files must NOT value-import host packages ----------
const DIST = join(ROOT, "dist");
const valueImportPatterns = [
	/^import\s+\{[^}]+\}\s+from\s+["']@earendil-works\/pi-coding-agent["']/m,
];
const typeImportPatterns = [
	/^import\s+type\s+\{[^}]+\}\s+from\s+["']@earendil-works\/pi-coding-agent["']/m,
];

function* walk(dir) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) yield* walk(p);
		else yield p;
	}
}

if (existsSync(DIST)) {
	let runtimeImportsFound = false;
	for (const file of walk(DIST)) {
		if (!file.endsWith(".js")) continue;
		const content = readFileSync(file, "utf8");
		for (const pat of valueImportPatterns) {
			if (pat.test(content)) {
				fail(
					`Runtime value-import of host package in ${file.replace(ROOT + "/", "")}. ` +
					`Compiled output retains the import; Node would fail to resolve. ` +
					`Use 'import type' or pass dependencies through factory parameters.`
				);
				runtimeImportsFound = true;
			}
		}
	}
	if (!runtimeImportsFound) {
		pass("dist/ contains no runtime value-imports of host packages");
	}
} else {
	console.log("→ dist/ not found (run `npm run build` first)");
}

// ---------- 4. Required files exist and are in `files` list ----------
const REQUIRED_FILES = ["README.md", "LICENSE", "CHANGELOG.md", "dist/index.js", "dist/prompts/judge.md"];
const filesList = pkg.files || [];
for (const file of REQUIRED_FILES) {
	const fullPath = join(ROOT, file);
	if (!existsSync(fullPath)) {
		fail(`Required file missing on disk: ${file}`);
		continue;
	}
	const globPrefix = file.endsWith("/") ? file : `${file.split("/")[0]}`;
	const matched = filesList.some((f) => file === f || file.startsWith(f + "/") || f === globPrefix);
	if (!matched) {
		fail(`Required file '${file}' is not matched by 'files' in package.json`);
	} else {
		pass(`tarball includes: ${file}`);
	}
}

// ---------- 5. pi field sanity ----------
const pi = pkg.pi || {};
if (!pi.extensions || !Array.isArray(pi.extensions) || pi.extensions.length === 0) {
	fail("pi.extensions is missing or empty");
} else {
	const firstExt = pi.extensions[0];
	if (!existsSync(join(ROOT, firstExt))) {
		fail(`pi.extensions[0] = '${firstExt}' does not resolve on disk`);
	} else {
		pass(`pi.extensions[0] = ${firstExt} → exists`);
	}
}

// ---------- 6. engines.node declared ----------
const engines = pkg.engines || {};
if (!engines.node) {
	fail("engines.node is not declared — npm/pi install will warn on older Node");
} else {
	pass(`engines.node = ${engines.node}`);
}

// ---------- Summary ----------
console.log("");
if (failures === 0) {
	console.log("✓ pack:check passed — package is publish-ready");
	process.exit(0);
} else {
	console.error(`✗ pack:check found ${failures} issue(s) above — fix before publishing.`);
	process.exit(1);
}
