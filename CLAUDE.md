# CLAUDE.md — SpatialTimber-Web

Project website for **SpatialTimber** (Zukunft Bau, funding code 10.08.18.7-24.50).
Published via **GitHub Pages**: <https://bauhaus-infau.github.io/SpatialTimber-Web/>
Repo: `Bauhaus-InfAU/SpatialTimber-Web` (push with the `bielik` GitHub account).

## What this site is

Right now the site serves **one thing**: the *Zukunft Bau Projekttage 2026* end-of-project
presentation deck (a self-contained HTML/CSS/JS slide deck), at the **site root**.

**Roadmap:** this repo will grow into the full SpatialTimber project website. When that
happens the website takes over root and **the deck moves to `/presentation/`**. Until then
the deck is at root for the cleanest shareable URL.

## The deck is NOT hand-edited here

The deck is authored in **Claude Design** (claude.ai/design). We never edit the slide HTML by
hand — we re-fetch it. Local processing (font embedding, future UI tweaks) is applied
**deterministically by `build.mjs`** so it survives every re-fetch.

### Getting a new deck out of Claude Design — TWO routes

Claude Design's **Export** button no longer hands over a file directly. It now emits an **MCP
import instruction** that points an agent at the `claude_design` MCP connector
(`https://api.anthropic.com/v1/design/mcp`) plus a project URL like
`https://claude.ai/design/p/<projectId>?file=SpatialTimber+Deck+vN.html`.

**Route A — MCP connector (does NOT work for the full deck):** the connector (the `DesignSync`
tool: `list_projects` / `list_files` / `get_file` …) is fine for *listing* and metadata, but
its **`get_file` caps reads at 256 KiB**. A deck HTML is ~270 KB+, so `get_file` returns it
**silently truncated** (cut off mid-CSS, no `</body></html>`). Do not build from it — the cut is
not flagged as an error. Confirmed dead end as of deck v33 (2026-06-19). *(The same RPC called
directly in the browser returns the full file, but it's wrapped in the editor's
`data-omelette-injected` preview script/style and is exactly the kind of hand-massaging this
repo avoids — don't go there.)*

**Route B — ZIP handoff (the one that works):** in Claude Design, next to Export choose
**Download ZIP**. This produces a full bundle **`<project name>-handoff.zip`** (~322 MB) that the
user drops into **`version/`** in this repo. It contains a `project/` dir with every deck version
(`SpatialTimber Deck vN.html`), `deck-stage.js` (the runtime), an `assets/` folder, plus a README.
This is the current canonical way to get a new deck in. (The older expiring tar.gz handoff URL
`https://api.anthropic.com/v1/design/h/<id>?open_file=…` still works with `--handoff` if a user
ever produces one, but Export stopped offering it.)

**Build from the ZIP** (GNU `tar` in Git Bash can't read zip — use PowerShell to unpack, then
feed the extracted `project/` dir to `build.mjs --src`):

```sh
# 1. unpack (PowerShell — bsdtar/GNU tar won't autodetect zip here):
powershell -c "Expand-Archive -LiteralPath 'version/<name>-handoff.zip' -DestinationPath .work/zip-extract -Force"
# 2. process the extracted bundle (pin the version you want; build.mjs finds the project/ dir):
node build.mjs --src ".work/zip-extract/<slug>/project" --version "SpatialTimber Deck vN.html"
```

`build.mjs`'s `findProjectDir()` walks the tree for the dir holding `deck-stage.js` + a
`SpatialTimber Deck v*.html`, so pointing `--src` at the extract root also works. The `.zip`
itself can be deleted after a successful build (it's huge; `version/` is git-ignored scratch).

## The build pipeline — `build.mjs`

`fetch → process → publish`, idempotent. Node ≥ 20, uses only `curl`, `tar`, `git` (all on PATH).

```sh
# fetch a fresh handoff and process (auto-picks the latest deck vN):
node build.mjs --handoff "<expiring url>"

# process an already-downloaded tarball or extracted dir instead:
node build.mjs --tarball .work/handoff.tar.gz
node build.mjs --src <extracted-dir>

# from a Download-ZIP handoff in version/ (current canonical route — see "Getting a new deck" above):
powershell -c "Expand-Archive -LiteralPath 'version/<name>-handoff.zip' -DestinationPath .work/zip-extract -Force"
node build.mjs --src ".work/zip-extract/<slug>/project" --version "SpatialTimber Deck vN.html"

# pin a specific version (default = highest vN):
node build.mjs --handoff "<url>" --version "SpatialTimber Deck v15.html"

# review locally, then publish (commit + push -> Pages redeploys):
python -m http.server 8000          # open http://localhost:8000/
node build.mjs --reprocess --publish "Update deck to v16"
```

**Standard processing steps — confirmed, applied automatically to EVERY fetched version**
(user-approved 2026-06-10; keep them on for all upcoming deck versions unless told otherwise):
1. **stamp-version** — injects `<meta name="deck-version">`/`deck-source`/`deck-built` before `</head>` (see Version tracking).
2. **embed-fonts** — injects `<link rel="stylesheet" href="fonts.css">` before `</head>`.
3. **nav-toggle** — injects `<script src="deck-controls.js"></script>` before `</body>`.
4. **svg-swaps** — replaces baked scheme **videos** with **click- + keyboard-driven animated SVGs**
   (persistent build cue, `→`/click to build, then next slide; see below).
5. **bullet-fix** — the eyebrow accent dot is the text glyph `●` from the `--sans` stack. Söhne
   (the Claude Design viewer's font) draws it near cap-height; absent Söhne, neither Inter nor
   the Helvetica/Arial fallbacks carry `●`, so it drops to a tiny OS last-resort glyph (~0.44em
   vs ~0.7em) and the dots look shrunken. This step tags the round-bullet `.acc` spans
   (`om-acc-dot`) and injects a `<style>` that draws each dot as a **CSS disc sized in em** —
   font-independent, identical on every machine. The lone `✓` eyebrow is left untouched.
6. **qr-fix** — the closing-slide contact-QR `<img>` (`assets/contact_qr_bielik.svg`) ships with a
   garbled inline `style` from the editor (a drag-resize artifact, e.g. `width:41px;height:414px`)
   that **overrides** the deck's own `.s29-qr img` rule (a square `var(--s29-qr-size,360px)` with the
   right padding/border/radius). The override squashes the QR into a thin vertical strip. This step
   **strips that inline `style` attribute** so the stylesheet governs and the QR renders square.
   Idempotent (keyed on the QR asset; no-op once the attribute is gone). Added deck v35 / web 1.7.0.
7. *(future UI patches go here as discrete, idempotent steps.)*

`build.mjs` re-applies all of these on every `--handoff`/`--reprocess` run, so a new version
(v16, v17, …) is fetched and shipped with fonts + nav-toggle + the SVG swaps already in place —
no manual redo.

Each step is a self-contained repo file (`fonts.css`, `deck-controls.js`, the SVGs in
`patch-assets/`) + a one-line injection. To add a UI tweak: write the patch file, add an
idempotent injection block in `applyProcessing()`, re-run `node build.mjs --reprocess`.

### svg-swaps — click-driven scheme animations

Some deck slides bake an animated scheme as an MP4. We replace those with the **live source
SVG** the video was rendered from, rewired to be **click- and keyboard-driven** (each click /
`→` / Space builds the next part of the diagram). This is **data-driven**: the `SVG_SWAPS` table
at the top of `build.mjs` maps each deck `…mp4` → an SVG in `patch-assets/`. The step embeds each
via `<object>` (so the SVG's pictograms + `../fonts.css` load and its `<script>` runs/receives
clicks; clicks inside it don't bubble out, so slide-advance still works outside the box). A
manifest row whose video the deck no longer references prints a `⚠` warning, not a silent skip.

**Build interaction (web v1.6.0):** each scheme has a **persistent cue** at the bottom of the box
that counts progress (`Click or press → to build  (1 / 2)`) and flips to a terracotta done state
(`✓ Built — press → for next slide`) when complete. `→`/Space/PageDown advance the build, then
move to the **next slide** once built; `←` always goes to the **previous slide**; **clicking a
fully-built scheme restarts it** (it no longer auto-loops). This needs both halves: each SVG
exposes `window.__scheme = {total, built(), forward(), restart()}` + its own keydown handler, and
`deck-controls.js` adds a capture-phase keydown + `__deckNext/__deckPrev` so `→` builds the scheme
(instead of changing slide) whenever the current slide holds a not-yet-built scheme. See
**`patch-assets/README.md`** for the full contract.

**To add another scheme:** author its click-driven SVG, drop it + its pictograms in
`patch-assets/`, add one `SVG_SWAPS` row, bump `WEB_VERSION`, reprocess. Full authoring recipe +
reusable script/CSS template: **`patch-assets/README.md`**. Currently swapped (slide numbers as of
deck v27 — they drift with deck content): slide 18 (adapter training — 5 adapters, click/`→` to
train, blinks), slide 14 (LoRA — base → adapters → layout generator), slide 15 (typology —
apartment → floor → building rows).

Then it copies `deck-stage.js`, copies **only the assets the deck references** (≈25 of ~65 in
the bundle, keeps the repo lean), and **verifies there are no broken asset references** before
allowing publish. It aborts if any referenced asset is missing.

## Fonts (self-hosted / embedded)

The deck's font stacks and the free faces we embed to match them:

| CSS var | stack | embedded face |
|---|---|---|
| `--sans`  | `"Söhne","Inter",…` | **Inter** (Söhne is Anthropic-licensed → unavailable; Inter is the intended free face) |
| `--mono`  | `"JetBrains Mono",…` | **JetBrains Mono** |
| `--serif` | `"Tiempos Text","Source Serif Pro",…` | **Source Serif 4** (named `Source Serif Pro` in `fonts.css` to match the stack) |

- `fonts/` holds variable woff2 files (latin + latin-ext; German umlauts covered). Source:
  fontsource via jsDelivr (`@fontsource-variable/{inter,jetbrains-mono,source-serif-4}`).
- `fonts.css` `@font-face` **family names match the deck stacks exactly**, so the deck picks
  them up with zero edits to its own CSS. Variable axis 100–900 covers all weights + italics.
- Fonts are committed once and reused; `build.mjs` only re-injects the link per version.

## Repo layout

```
index.html        deck (Claude Design export, processed). Served at root.
deck-stage.js      deck runtime (slide staging, nav, scaling)
assets/            only the media the current deck references
fonts/             self-hosted woff2 (Inter, JetBrains Mono, Source Serif 4)
fonts.css          @font-face, injected into index.html by build.mjs
deck-controls.js   nav-toggle: collapse control for the left rail (injected by build.mjs)
patch-assets/      committed assets injected by processing steps (click-driven scheme SVGs +
                   their pictograms); copied into assets/ on every build. See its README.md.
build.mjs          fetch → process → publish pipeline (incl. SVG_SWAPS manifest)
.nojekyll          serve files verbatim on Pages
.work/             (git-ignored) downloaded/extracted handoff scratch
version/           (git-ignored) Download-ZIP handoff bundles the user drops in (~300 MB each)
project-docs/      (git-ignored junction) → OneDrive "SpatialTimber - Documents"
```

## Source of truth for deck content

`SpatialTimber - Documents/04_Publications and Presentations/03_ZukunftBau Projektetage 2026/`
holds the design brief, asset bundle, and the Claude Design handoff history. The
`project-docs/` junction points there for convenience during local work.

## Version tracking — TWO axes

A published build is identified by two independent versions:

| Axis | What it is | How it changes |
|---|---|---|
| **`deckVersion`** (`v15`) | Claude Design deck **content** | auto from the handoff filename (highest `vN`) |
| **`webVersion`** (`1.0.0`) | **our layer** here — processing steps + patch files (`fonts.css`, `deck-controls.js`) + build logic | **manual:** bump `WEB_VERSION` in `build.mjs` |

This matters because the *same* deck `vN` can be republished with different local changes —
`webVersion` is what distinguishes "v15 with just fonts" from "v15 with fonts + nav-toggle".

**Bump `WEB_VERSION` (top of `build.mjs`) whenever you change this repo's processing/patch layer:**
patch = fix/tweak to an existing patch · minor = new processing step / feature · major = rework.
(Don't bump it for a pure deck-content update — that moves `deckVersion` instead.)

Both are stamped on every build:
- **`version.json`** (repo root) — `{ deckVersion, webVersion, sourceFile, builtAt, slides, assets, processing }`. Committed.
- **`<meta name="deck-version">` / `web-version` / `deck-source` / `deck-built`** injected into `index.html`
  (the `stamp-version` step) — the **live site self-reports**:
  ```sh
  curl -s https://bauhaus-infau.github.io/SpatialTimber-Web/version.json
  curl -s https://bauhaus-infau.github.io/SpatialTimber-Web/ | grep -E 'deck-version|web-version'
  ```

No git tags (by choice).

## Navigator collapse control

The left thumbnail rail can be collapsed for presenting: a small button (bottom-left,
auto-fades when the mouse is idle) or the **`N`** key toggles it. This is `deck-controls.js`,
which drives the deck's *own* built-in rail show/hide via `postMessage({type:
'__deck_rail_visible', on})` — so the collapse animates, persists across reloads
(`localStorage['deck-stage.railVisible']`), and the slide re-fits to full width. The control
exists because the standalone export ships the rail machinery but not the host's toggle UI.

## Gotchas

- **Deep-linking by URL hash on load doesn't switch slides** — the deck navigates via
  thumbnail clicks / keyboard; `#N` reflects state but doesn't drive it on initial load.
- The deck has a **loading screen** that preloads media before showing slide 1 — expected.
- Title-slide date is **16.06.2026** (confirmed correct).
- `index.html` is a build output — don't hand-edit it; change `build.mjs`/`fonts.css` and re-run.
