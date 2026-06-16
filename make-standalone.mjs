#!/usr/bin/env node
/**
 * make-standalone.mjs — collapse the processed deck (index.html + its external
 * fonts/JS/assets) into ONE self-contained HTML file you can hand to anyone.
 *
 * It inlines, in order:
 *   1. fonts.css      -> <style> with every woff2 embedded as a data: URI
 *   2. the 3 click-driven scheme SVGs -> each becomes a `data:image/svg+xml`
 *      <object> (its own pictograms + fonts inlined first). Kept as <object>
 *      so each scheme stays an ISOLATED document: clicks build it in place and
 *      don't bubble out to advance the slide. The cross-document keyboard build
 *      bridge (deck-controls.js <-> contentWindow.__scheme) can't survive a
 *      data: URI's opaque origin, so arrow-key build is lost for those 3 slides
 *      only — they fall back to plain click-to-build via the SVG's own handler.
 *   3. deck-stage.js + deck-controls.js -> inline <script>
 *   4. every remaining assets/* (images, posters, MP4, GIF, logos) -> data: URI
 *
 * Run AFTER build.mjs has produced index.html. Output:
 *   SpatialTimber-Deck-<deckVersion>-standalone.html  (git-ignored; share it directly)
 *
 * Usage:  node make-standalone.mjs
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const die = (m) => { console.error("\n✗ " + m + "\n"); process.exit(1); };
const human = (n) => n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : (n / 1e3).toFixed(0) + " KB";

const MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".mp4": "video/mp4", ".webm": "video/webm", ".woff2": "font/woff2",
};
const mimeOf = (p) => MIME[extname(p).toLowerCase()] || "application/octet-stream";
const dataUri = (absPath) => {
  if (!existsSync(absPath)) die(`referenced file missing: ${absPath}`);
  return `data:${mimeOf(absPath)};base64,${readFileSync(absPath).toString("base64")}`;
};

// fonts.css with each url("fonts/X.woff2") swapped for a data: URI. Returned as
// raw CSS (no @font-face changes other than the url), reused for the page <style>
// and inside each scheme SVG (whose @import url('../fonts.css') is replaced by it).
function inlineFontsCss() {
  const cssPath = join(ROOT, "fonts.css");
  if (!existsSync(cssPath)) die("fonts.css not found — run build.mjs first");
  return readFileSync(cssPath, "utf8").replace(
    /url\(\s*["']?(fonts\/[^"')]+)["']?\s*\)/g,
    (_, rel) => `url(${dataUri(join(ROOT, rel))})`
  );
}

// One scheme SVG -> its fully self-contained markup as base64: inline its
// pictograms (relative hrefs, live in assets/) and replace its @import of
// ../fonts.css with the already-inlined font CSS. Returned as base64 (no data:
// prefix) — at runtime a small bootstrap turns each into a Blob URL and assigns
// it to the <object>. We can't use a data: URI here: Chrome caps a data: URL
// used as an <object> source at ~2 MB, and the LoRA scheme alone is ~7 MB once
// its pictograms are inlined. Blob URLs have no such limit and still load as a
// separate document, so each scheme stays isolated (clicks build it in place,
// don't bubble out) and its click-to-build script runs.
function inlineSvgBase64(svgName, fontsCss) {
  const svgPath = join(ROOT, "assets", svgName);
  if (!existsSync(svgPath)) die(`scheme SVG missing: ${svgName}`);
  let svg = readFileSync(svgPath, "utf8");
  // pictograms: href / xlink:href to a sibling file in assets/
  svg = svg.replace(
    /((?:xlink:)?href)\s*=\s*"([^":/][^":]*\.(?:png|jpg|jpeg|gif|webp|svg))"/g,
    (_, attr, rel) => `${attr}="${dataUri(join(ROOT, "assets", rel))}"`
  );
  // @import url('../fonts.css')  ->  the inlined font CSS (now origin-independent).
  // The SVG's <style> is parsed as XML (not raw text like an HTML <style>), so any '<'
  // or '&' in the CSS would be read as markup. fonts.css's header comment contains the
  // literal "<head>", which breaks XML parsing — strip CSS comments before embedding.
  // The actual @font-face rules + base64 url()s carry no '<'/'&', so this is sufficient.
  const xmlSafeFonts = fontsCss.replace(/\/\*[\s\S]*?\*\//g, "");
  svg = svg.replace(/@import\s+url\(\s*["']?\.\.\/fonts\.css["']?\s*\)\s*;?/g, xmlSafeFonts);
  return Buffer.from(svg, "utf8").toString("base64");
}

function inlineScript(file) {
  const p = join(ROOT, file);
  if (!existsSync(p)) die(`${file} not found — run build.mjs first`);
  // guard: a literal </script> inside the JS would close the tag early
  return readFileSync(p, "utf8").replace(/<\/script>/gi, "<\\/script>");
}

function main() {
  const indexPath = join(ROOT, "index.html");
  if (!existsSync(indexPath)) die("index.html not found — run build.mjs first");
  let html = readFileSync(indexPath, "utf8");

  const deckVersion =
    html.match(/name="deck-version"\s+content="([^"]+)"/)?.[1] ?? "vX";

  const fontsCss = inlineFontsCss();

  // 1. scheme <object data="assets/X.svg"> -> a `data-scheme="N"` marker; the
  //    self-contained SVG markup is banked (base64) and turned into a Blob URL at
  //    runtime (see bootstrap below). Must run before the generic assets/ sweep,
  //    which would otherwise rewrite the .svg path. Logos are <img> (src=), not
  //    <object> (data=), so this only matches the click-driven scheme objects.
  const schemeBank = [];
  html = html.replace(/data="assets\/([^"]+\.svg)"/g, (m, svgName) => {
    if (!/^scheme_/.test(svgName)) return m;
    const id = schemeBank.length;
    schemeBank.push(inlineSvgBase64(svgName, fontsCss));
    return `data-scheme="${id}"`;
  });
  const schemes = schemeBank.length;

  // 2. fonts.css <link> -> inline <style>
  html = html.replace(
    /<link\s+rel="stylesheet"\s+href="fonts\.css"\s*\/?>/,
    `<style>\n${fontsCss}\n</style>`
  );

  // 3. external scripts -> inline
  html = html.replace(
    /<script\s+src="deck-stage\.js"><\/script>/,
    `<script>\n${inlineScript("deck-stage.js")}\n</script>`
  );
  html = html.replace(
    /<script\s+src="deck-controls\.js"><\/script>/,
    `<script>\n${inlineScript("deck-controls.js")}\n</script>`
  );

  // 4. every remaining assets/* (images, posters, MP4, GIF, logos) -> data: URI
  let mediaCount = 0;
  html = html.replace(/="assets\/([^"]+)"/g, (_, rel) => {
    mediaCount++;
    return `="${dataUri(join(ROOT, "assets", rel))}"`;
  });

  // 5. bank the scheme SVGs + a bootstrap that turns each into a Blob URL and
  //    assigns it to its <object> on load. The base64 alphabet contains no '<',
  //    so it can't break out of either the JSON <script> or this <script>.
  if (schemeBank.length) {
    if (!html.includes("</body>")) die("deck HTML has no </body> to inject the scheme bootstrap into");
    const bank =
      `<script type="application/json" id="__standalone_scheme_bank">` +
      `${JSON.stringify(schemeBank)}</script>\n` +
      `<script>(function(){\n` +
      `  var bank=JSON.parse(document.getElementById('__standalone_scheme_bank').textContent);\n` +
      `  function boot(){\n` +
      `    var objs=document.querySelectorAll('object[data-scheme]');\n` +
      `    for(var i=0;i<objs.length;i++){\n` +
      `      var o=objs[i],b64=bank[+o.getAttribute('data-scheme')];\n` +
      `      if(b64==null)continue;\n` +
      `      var bin=atob(b64),bytes=new Uint8Array(bin.length);\n` +
      `      for(var j=0;j<bin.length;j++)bytes[j]=bin.charCodeAt(j);\n` +
      `      o.data=URL.createObjectURL(new Blob([bytes],{type:'image/svg+xml'}));\n` +
      `    }\n` +
      `  }\n` +
      `  if(document.readyState!=='loading')boot();else document.addEventListener('DOMContentLoaded',boot);\n` +
      `})();</script>\n`;
    html = html.replace("</body>", `${bank}</body>`);
  }

  // sanity: no external media/font path should remain as a real tag attribute.
  // (deck-stage.js's own doc-comment contains a harmless literal `src="deck-stage.js"`,
  //  so the script self-references are deliberately not checked here.)
  const leftovers = [...html.matchAll(/(?:src|href|data|poster)="(?:assets\/|fonts\.css|fonts\/)/g)];
  if (leftovers.length) {
    console.error("leftovers:", leftovers.slice(0, 10).map((m) => html.slice(m.index, m.index + 60)));
    die(`${leftovers.length} external reference(s) still present after inlining`);
  }

  const outName = `SpatialTimber-Deck-${deckVersion}-standalone.html`;
  const outPath = join(ROOT, outName);
  writeFileSync(outPath, html);

  console.log(`\n✓ Standalone deck written`);
  console.log(`  file     : ${outName}`);
  console.log(`  size     : ${human(statSync(outPath).size)}`);
  console.log(`  deck     : ${deckVersion}`);
  console.log(`  schemes  : ${schemes} inlined (click-to-build)`);
  console.log(`  media    : ${mediaCount} assets embedded as data: URIs`);
  console.log(`  fonts/js : embedded`);
  console.log(`\n  Open it by double-clicking — fully self-contained, no server needed.\n`);
}

main();
