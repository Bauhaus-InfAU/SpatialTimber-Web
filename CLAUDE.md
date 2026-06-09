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

What processing does (`applyProcessing()` in build.mjs):
1. **embed-fonts** — injects `<link rel="stylesheet" href="fonts.css">` before `</head>` (idempotent).
2. *(future UI patches go here as discrete, idempotent steps — to be discussed.)*

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
build.mjs          fetch → process → publish pipeline
.nojekyll          serve files verbatim on Pages
.work/             (git-ignored) downloaded/extracted handoff scratch
project-docs/      (git-ignored junction) → OneDrive "SpatialTimber - Documents"
```

## Source of truth for deck content

`SpatialTimber - Documents/04_Publications and Presentations/03_ZukunftBau Projektetage 2026/`
holds the design brief, asset bundle, and the Claude Design handoff history. The
`project-docs/` junction points there for convenience during local work.

## Gotchas

- **Deep-linking by URL hash on load doesn't switch slides** — the deck navigates via
  thumbnail clicks / keyboard; `#N` reflects state but doesn't drive it on initial load.
- The deck has a **loading screen** that preloads media before showing slide 1 — expected.
- Title-slide date is **16.06.2026** (confirmed correct).
- `index.html` is a build output — don't hand-edit it; change `build.mjs`/`fonts.css` and re-run.
