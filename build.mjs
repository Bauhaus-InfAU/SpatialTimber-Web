#!/usr/bin/env node
/**
 * SpatialTimber-Web build pipeline:  fetch latest deck  ->  process  ->  (optionally) publish.
 *
 * The deck is authored in Claude Design and handed off as a ~200 MB gzip tarball via a
 * link that EXPIRES quickly (must be re-requested each time). This script takes that
 * handoff, picks the latest deck version, applies repeatable processing (font embedding +
 * any future UI patches), copies only the assets the deck actually uses, and verifies the
 * result. Publishing (git commit + push -> GitHub Pages) is a separate explicit flag.
 *
 * Usage:
 *   node build.mjs --handoff "<url>"            fetch tarball from an expiring handoff URL, process
 *   node build.mjs --tarball handoff.tar.gz     process an already-downloaded tarball
 *   node build.mjs --src <dir>                  process an already-extracted bundle dir
 *   node build.mjs ... --version "SpatialTimber Deck v15.html"   pin a version (default: latest vN)
 *   node build.mjs ... --publish "commit message"               commit + push after processing
 *   node build.mjs --reprocess                  re-run processing on the current handoff in .work (no re-download)
 *
 * Processing is idempotent — re-running on a fresh deck version reproduces the same site.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const WORK = join(ROOT, ".work");
const ASSETS = join(ROOT, "assets");
const FONT_LINK = '<link rel="stylesheet" href="fonts.css">';

const log = (...a) => console.log(...a);
const die = (m) => { console.error("\n✗ " + m + "\n"); process.exit(1); };
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
const human = (n) => n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : (n / 1e3).toFixed(0) + " KB";

// ---- args ----
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) {
      const name = k.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { a[name] = next; i++; } else { a[name] = true; }
    }
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));

// ---- 1. resolve handoff -> bundle project dir ----
function findProjectDir(start) {
  // a "project dir" contains deck-stage.js and at least one "SpatialTimber Deck v*.html"
  const stack = [start];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    const names = entries.map((e) => e.name);
    if (names.includes("deck-stage.js") && names.some((n) => /^SpatialTimber Deck v\d+\.html$/.test(n))) return d;
    for (const e of entries) if (e.isDirectory()) stack.push(join(d, e.name));
  }
  return null;
}

function resolveBundle() {
  if (args.src) {
    const d = resolve(args.src);
    if (!existsSync(d)) die(`--src dir not found: ${d}`);
    return findProjectDir(d) ?? die(`no deck project dir found under --src ${d}`);
  }
  // download or reuse a tarball, extract into .work/extract
  const extractDir = join(WORK, "extract");
  if (args.reprocess) {
    if (!existsSync(extractDir)) die("--reprocess given but .work/extract is empty; run a --handoff/--tarball build first");
    log("• Reprocessing existing bundle in .work/extract (no re-download)");
    return findProjectDir(extractDir) ?? die("no deck project dir found in .work/extract");
  }
  let tarball = args.tarball ? resolve(args.tarball) : null;
  if (args.handoff) {
    mkdirSync(WORK, { recursive: true });
    tarball = join(WORK, "handoff.tar.gz");
    log(`• Fetching handoff (link expires) …`);
    sh("curl", ["-sSL", String(args.handoff), "-o", tarball]);
  }
  if (!tarball) {
    // fall back to a handoff.tar.gz sitting in repo root
    const fallback = join(ROOT, "handoff.tar.gz");
    if (existsSync(fallback)) tarball = fallback;
    else die("no handoff source: pass --handoff <url>, --tarball <path>, or --src <dir>");
  }
  if (!existsSync(tarball)) die(`tarball not found: ${tarball}`);
  log(`• Extracting ${tarball} (${human(statSync(tarball).size)}) …`);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  sh("tar", ["-xzf", tarball, "-C", extractDir]);
  return findProjectDir(extractDir) ?? die("no deck project dir found inside the tarball");
}

// ---- 2. pick deck version ----
function pickDeck(projectDir) {
  if (args.version) {
    const p = join(projectDir, String(args.version));
    if (!existsSync(p)) die(`--version not found in bundle: ${args.version}`);
    return p;
  }
  const versioned = readdirSync(projectDir)
    .map((n) => ({ n, m: n.match(/^SpatialTimber Deck v(\d+)\.html$/) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(b.m[1]) - Number(a.m[1]));
  if (!versioned.length) die("no 'SpatialTimber Deck vN.html' files in bundle");
  return join(projectDir, versioned[0].n);
}

// ---- 3. process: inject fonts (+ future UI patches) ----
function applyProcessing(html) {
  const applied = [];
  // embed fonts: link fonts.css before </head> (idempotent)
  if (!html.includes('href="fonts.css"')) {
    if (!html.includes("</head>")) die("deck HTML has no </head> to inject fonts into");
    html = html.replace("</head>", `  ${FONT_LINK}\n</head>`);
    applied.push("embed-fonts");
  }
  // --- future UI patches go here (kept as discrete, idempotent steps) ---
  return { html, applied };
}

// ---- 4. copy referenced assets ----
function refs(html) {
  return [...new Set([...html.matchAll(/assets\/[^"')\s]+/g)].map((m) => m[0].replace(/^assets\//, "")))];
}

function main() {
  const projectDir = resolveBundle();
  const deckPath = pickDeck(projectDir);
  log(`• Deck version: ${deckPath.split(/[\\/]/).pop()}`);

  let html = readFileSync(deckPath, "utf8");
  const { html: out, applied } = applyProcessing(html);
  writeFileSync(join(ROOT, "index.html"), out);
  log(`• Processing applied: ${applied.length ? applied.join(", ") : "(none — already current)"}`);

  // deck-stage.js
  const stageSrc = join(projectDir, "deck-stage.js");
  if (!existsSync(stageSrc)) die("deck-stage.js missing from bundle");
  copyFileSync(stageSrc, join(ROOT, "deck-stage.js"));

  // assets (only what the deck references)
  const used = refs(out);
  rmSync(ASSETS, { recursive: true, force: true });
  mkdirSync(ASSETS, { recursive: true });
  const missing = [];
  let bytes = 0;
  for (const a of used) {
    const src = join(projectDir, "assets", a);
    if (!existsSync(src)) { missing.push(a); continue; }
    copyFileSync(src, join(ASSETS, a));
    bytes += statSync(src).size;
  }

  // verify
  const slideCount = (out.match(/<section/g) || []).length;
  log(`\n── summary ─────────────────────────────`);
  log(`  slides (sections) : ${slideCount}`);
  log(`  assets referenced : ${used.length}  (${human(bytes)})`);
  log(`  deck-stage.js     : ok`);
  log(`  fonts             : ${existsSync(join(ROOT, "fonts.css")) ? "fonts.css present" : "MISSING fonts.css"}`);
  if (missing.length) { log(`  ✗ MISSING ASSETS  : ${missing.join(", ")}`); die(`${missing.length} referenced asset(s) missing from bundle — aborting before publish`); }
  log(`  broken refs       : none`);
  log(`────────────────────────────────────────`);

  // publish
  if (args.publish) {
    const msg = typeof args.publish === "string" ? args.publish : `Update deck (${deckPath.split(/[\\/]/).pop()})`;
    log(`\n• Publishing: git add/commit/push …`);
    sh("git", ["add", "-A"], { cwd: ROOT });
    sh("git", ["-c", "user.name=Martin Bielik", "-c", "user.email=martin.bielik@gmail.com", "commit", "-m", msg], { cwd: ROOT });
    sh("git", ["push"], { cwd: ROOT });
    log(`\n✓ Published. GitHub Pages will redeploy: https://bauhaus-infau.github.io/SpatialTimber-Web/`);
  } else {
    log(`\n✓ Processed. Review locally (python -m http.server), then publish:`);
    log(`    node build.mjs --reprocess --publish "your message"   # or just: git add -A && git commit && git push`);
  }
}

main();
