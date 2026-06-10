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

### Handoff links expire

To get a new deck, the user pastes a fresh handoff URL like
`https://api.anthropic.com/v1/design/h/<id>?open_file=<file>.html`.
**These links expire quickly and must be re-requested from the user every time.** Never
assume an old link still works. The link returns a ~200 MB gzip tarball containing many deck
versions (`SpatialTimber Deck vN.html`), `deck-stage.js` (the runtime), an `assets/` folder,
plus chat transcripts and a README.

## The build pipeline — `build.mjs`

`fetch → process → publish`, idempotent. Node ≥ 20, uses only `curl`, `tar`, `git` (all on PATH).

```sh
# fetch a fresh handoff and process (auto-picks the latest deck vN):
node build.mjs --handoff "<expiring url>"

# process an already-downloaded tarball or extracted dir instead:
node build.mjs --tarball .work/handoff.tar.gz
node build.mjs --src <extracted-dir>

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
4. *(future UI patches go here as discrete, idempotent steps.)*

`build.mjs` re-applies all of these on every `--handoff`/`--reprocess` run, so a new version
(v16, v17, …) is fetched and shipped with fonts + nav-toggle already in place — no manual redo.

Each step is a self-contained repo file (`fonts.css`, `deck-controls.js`) + a one-line
injection. To add a UI tweak: write the patch file, add an idempotent injection block in
`applyProcessing()`, re-run `node build.mjs --reprocess`.

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
build.mjs          fetch → process → publish pipeline
.nojekyll          serve files verbatim on Pages
.work/             (git-ignored) downloaded/extracted handoff scratch
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
