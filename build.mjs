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

// Web-layer version — OUR changes here (processing steps, patch files like fonts.css /
// deck-controls.js, build logic), independent of the Claude Design deck content version (vN).
// BUMP THIS when you change anything in this repo's processing/patch layer:
//   patch (x.x.+1) = fix/tweak to an existing patch; minor (x.+1.0) = new processing step /
//   feature; major (+1.0.0) = a reworking. The deck's own vN is tracked separately.
// 1.7.0 briefly carried a `qr-fix` step that stripped a garbled inline style from the
// closing-slide contact-QR <img> (a stale-bundle artifact). The bug was corrected at the
// Claude Design source, so the step was removed — patch layer is back to the 1.6.0 state.
const WEB_VERSION = "1.6.0";
const ASSETS = join(ROOT, "assets");
const PATCH_ASSETS = join(ROOT, "patch-assets");   // committed assets injected by processing steps (survive every re-fetch)
const FONT_LINK = '<link rel="stylesheet" href="fonts.css">';

// Click-driven SVG swaps: each baked scheme MP4 in the deck is replaced by an <object> embedding
// the click-driven source SVG of the same diagram (authored in patch-assets/ — see
// patch-assets/README.md for the authoring recipe). This table is re-applied on EVERY deck
// re-fetch, so new deck versions (v16, v17, …) ship these animations automatically with no redo.
// To add a scheme: author its click-driven SVG, drop it + its pictograms in patch-assets/, then
// add one row here. `mp4` is the deck's referenced filename; `svg` is the patch-assets filename;
// `style` is the original <video>'s style copied verbatim, so the <object> keeps the exact slide
// layout (the SVG's viewBox gives it the same intrinsic aspect ratio the video had).
const SVG_SWAPS = [
  {
    mp4: "15_scheme_adapters_training.mp4",
    svg: "scheme_adapters_training_v6_anim.svg",
    style: "width:100%; height:659px; object-fit:contain; display:block;",
    label: "Adapter training scheme — click to train each adapter in turn (apartment, arch. quality, floor, building, structural efficiency)",
  },
  {
    mp4: "14_scheme_lora_annotated.mp4",
    svg: "scheme_lora_annotated.svg",
    style: "width:100%; max-width:100%; max-height:680px; object-fit:contain; display:block; height:auto;",
    label: "LoRA scheme — click to build: base model, then stacked adapters, then the layout generator",
  },
  {
    mp4: "15_scheme_typology_annotated.mp4",
    svg: "scheme_typology_annotated.svg",
    style: "width:100%; max-width:760px; max-height:560px; object-fit:contain; display:block;",
    label: "Typology scheme — click to build each data scale in turn (apartment, floor, building) into nested adapters",
  },
];

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
  sh("tar", ["--force-local", "-xzf", tarball, "-C", extractDir]);
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
// Standard steps below are CONFIRMED STANDING PROCESSING (user-approved 2026-06-10) and run
// on every fetched deck version: embed-fonts + nav-toggle. Keep them applied to all upcoming
// versions unless explicitly told to drop one. Each step is idempotent.
function applyProcessing(html, meta) {
  const applied = [];
  const warnings = [];
  // stamp-version: record the source deck version + build time so the live site
  // self-reports what's deployed (queryable via curl/JS). Source HTML never
  // carries these, so this injects fresh on every build.
  if (!html.includes('name="deck-version"')) {
    if (!html.includes("</head>")) die("deck HTML has no </head> to stamp version into");
    const stamp = `  <meta name="deck-version" content="${meta.deckVersion}">\n` +
                  `  <meta name="web-version" content="${meta.webVersion}">\n` +
                  `  <meta name="deck-source" content="${meta.sourceFile}">\n` +
                  `  <meta name="deck-built" content="${meta.builtAt}">\n`;
    html = html.replace("</head>", `${stamp}</head>`);
    applied.push("stamp-version");
  }
  // embed fonts: link fonts.css before </head> (idempotent)
  if (!html.includes('href="fonts.css"')) {
    if (!html.includes("</head>")) die("deck HTML has no </head> to inject fonts into");
    html = html.replace("</head>", `  ${FONT_LINK}\n</head>`);
    applied.push("embed-fonts");
  }
  // nav-toggle: collapse control for the left thumbnail rail (hide during talks)
  if (!html.includes('deck-controls.js')) {
    if (!html.includes("</body>")) die("deck HTML has no </body> to inject controls into");
    html = html.replace("</body>", `  <script src="deck-controls.js"></script>\n</body>`);
    applied.push("nav-toggle");
  }
  // svg-swaps: replace each baked scheme MP4 (SVG_SWAPS) with its click-driven source SVG.
  // Embedded via <object> so the SVG's sub-resources load (its pictograms in assets/, Inter via
  // fonts.css) AND its internal <script> runs + receives clicks. Clicks inside the embedded SVG
  // document don't bubble to the page, so the deck's own click-to-advance-slide is unaffected
  // outside the box. Idempotent (keyed on a per-swap marker). A swap whose video the deck no
  // longer references is reported as a warning, not fatal — so a deck change is noticed, not silent.
  for (const sw of SVG_SWAPS) {
    const marker = `data-swap="${sw.svg}"`;
    if (html.includes(marker)) continue;                       // already applied this pass
    const mp4Esc = sw.mp4.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const videoRe = new RegExp(`<video\\b[^>]*\\bassets/${mp4Esc}[^>]*></video>`);
    if (!videoRe.test(html)) {
      warnings.push(`svg-swap: deck no longer references assets/${sw.mp4} — '${sw.svg}' NOT applied (deck changed?)`);
      continue;
    }
    const obj = `<object type="image/svg+xml" data="assets/${sw.svg}" ${marker}` +
      ` aria-label="${sw.label.replace(/"/g, "&quot;")}"` +
      ` style="${sw.style} border:0;"></object>`;
    html = html.replace(videoRe, obj);
    applied.push(`svg-swap:${sw.svg}`);
  }
  // bullet-fix: the eyebrow accent bullet is the text glyph "●" rendered from the --sans
  // stack ("Söhne","Inter",…). In the Claude Design viewer Söhne is installed and draws "●"
  // near cap-height (~0.7em); here Söhne is unavailable and neither Inter nor the Helvetica/
  // Arial fallbacks actually carry "●" — it drops to a small OS last-resort glyph (~0.44em),
  // so every eyebrow dot looks shrunken vs the viewer. Fix is font-independent: tag the round-
  // bullet spans and draw the dot as a CSS disc sized in em (scales with each eyebrow's font-
  // size, identical on every machine). The lone "✓" eyebrow is left untouched — only spans
  // whose content is "●" / "&#9679;" are tagged. Idempotent: the <style> is keyed by id, and
  // the span rewrite stops matching once class="acc" has become class="acc om-acc-dot".
  const BULLET_STYLE_ID = "om-bullet-fix";
  if (!html.includes(`id="${BULLET_STYLE_ID}"`)) {
    if (!html.includes("</head>")) die("deck HTML has no </head> to inject bullet-fix style into");
    const css = `  <style id="${BULLET_STYLE_ID}">/* font-independent eyebrow bullet — Söhne "●" fallback fix */\n` +
      `  .acc.om-acc-dot{display:inline-block;width:.6em;height:.6em;border-radius:50%;background:var(--accent);color:transparent;vertical-align:.02em;overflow:hidden;line-height:0;}</style>\n`;
    html = html.replace("</head>", `${css}</head>`);
    applied.push("bullet-fix:style");
  }
  const beforeDots = html;
  html = html.replace(/(<span\b[^>]*\bclass=")acc("[^>]*>)(\s*(?:●|&#9679;)\s*)(<\/span>)/g, "$1acc om-acc-dot$2$3$4");
  if (html !== beforeDots) applied.push("bullet-fix:tag");
  // --- future UI patches go here (kept as discrete, idempotent steps) ---
  return { html, applied, warnings };
}

// ---- 4. copy referenced assets ----
function refs(html) {
  return [...new Set([...html.matchAll(/assets\/[^"')\s]+/g)].map((m) => m[0].replace(/^assets\//, "")))];
}

function main() {
  const projectDir = resolveBundle();
  const deckPath = pickDeck(projectDir);
  const sourceFile = deckPath.split(/[\\/]/).pop();
  const deckVersion = "v" + (sourceFile.match(/\bv(\d+)\b/)?.[1] ?? "?");
  const builtAt = new Date().toISOString();
  log(`• Deck version: ${deckVersion}  (${sourceFile})   ·   web v${WEB_VERSION}`);

  let html = readFileSync(deckPath, "utf8");
  const { html: out, applied, warnings } = applyProcessing(html, { deckVersion, webVersion: WEB_VERSION, sourceFile, builtAt });
  writeFileSync(join(ROOT, "index.html"), out);
  log(`• Processing applied: ${applied.length ? applied.join(", ") : "(none — already current)"}`);
  for (const w of warnings) log(`  ⚠ ${w}`);

  // deck-stage.js
  const stageSrc = join(projectDir, "deck-stage.js");
  if (!existsSync(stageSrc)) die("deck-stage.js missing from bundle");
  copyFileSync(stageSrc, join(ROOT, "deck-stage.js"));

  // assets: (1) what the deck references from the bundle, then (2) committed patch-assets/
  // (SVGs/pictograms our processing steps inject — not in the bundle, must survive re-fetch).
  const used = refs(out);
  rmSync(ASSETS, { recursive: true, force: true });
  mkdirSync(ASSETS, { recursive: true });
  let bytes = 0;
  for (const a of used) {
    const src = join(projectDir, "assets", a);
    if (!existsSync(src)) continue;                  // may be supplied by patch-assets below
    const dest = join(ASSETS, a);
    mkdirSync(dirname(dest), { recursive: true });   // assets may live in subfolders (e.g. surrogate/)
    copyFileSync(src, dest);
    bytes += statSync(src).size;
  }
  let patchCount = 0;
  if (existsSync(PATCH_ASSETS)) {
    for (const f of readdirSync(PATCH_ASSETS)) {
      const src = join(PATCH_ASSETS, f);
      if (!statSync(src).isFile()) continue;
      if (f.toLowerCase().endsWith(".md")) continue;   // docs (README) stay in patch-assets/, never shipped to assets/
      copyFileSync(src, join(ASSETS, f));
      bytes += statSync(src).size;
      patchCount++;
    }
  }
  // anything index.html references that still isn't in assets/ is a genuine broken ref
  const missing = used.filter((a) => !existsSync(join(ASSETS, a)));

  // verify
  const slideCount = (out.match(/<section/g) || []).length;

  // stamp version.json (in-repo record of what's deployed)
  const version = {
    deckVersion, webVersion: WEB_VERSION, sourceFile, builtAt,
    slides: slideCount, assets: used.length,
    processing: applied,
  };
  writeFileSync(join(ROOT, "version.json"), JSON.stringify(version, null, 2) + "\n");

  log(`\n── summary ─────────────────────────────`);
  log(`  deck version      : ${deckVersion}  ·  web v${WEB_VERSION}  (built ${builtAt.slice(0, 10)})`);
  log(`  slides (sections) : ${slideCount}`);
  log(`  assets referenced : ${used.length}  (${human(bytes)})`);
  log(`  patch-assets      : ${patchCount} copied (svg + pictograms)`);
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
