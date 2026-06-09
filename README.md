# SpatialTimber-Web

Project website for **SpatialTimber** — *Optimierte Grundrisslösungen für nachhaltige Holz-Raumtragwerke zur Nachverdichtung im Wohnungsbau* (Zukunft Bau, funding code 10.08.18.7-24.50).

Published via **GitHub Pages**: <https://bauhaus-infau.github.io/SpatialTimber-Web/>

## What's here now

The site currently serves the **Zukunft Bau Projekttage 2026** end-of-project presentation deck — a self-contained HTML/CSS/JS slide deck.

| Path | Purpose |
|---|---|
| `index.html` | The deck (Claude Design export, *SpatialTimber Deck v15*). Served at site root. |
| `deck-stage.js` | Deck runtime — slide staging, navigation, scaling. Loaded by `index.html`. |
| `assets/` | Images, video (`.mp4`), and animations referenced by the deck. Only assets used by v15 are committed. |
| `.nojekyll` | Tells GitHub Pages to serve files verbatim (no Jekyll processing). |

## Roadmap

This repo is intended to grow into the full SpatialTimber project website. When that lands, the website takes over the site root and **the deck moves to `/presentation/`**. Until then the deck is served at root for the cleanest shareable URL.

## Source of truth

The deck is authored in **Claude Design** (claude.ai/design), not hand-edited here. The handoff bundle (HTML prototypes, chat transcripts, all asset variants) lives in the project documents folder:

```
SpatialTimber - Documents/04_Publications and Presentations/03_ZukunftBau Projektetage 2026/
```

To update the deck: request a fresh handoff link from Claude Design (links expire quickly), fetch the bundle, and re-copy the target deck version + its referenced assets into this repo.

> A local junction `project-docs/` (git-ignored) points at the OneDrive project documents folder for convenience during local work.

## Local preview

```sh
python -m http.server 8000
# open http://localhost:8000/
```

## Publishing

GitHub Pages is configured to serve the `main` branch root. Pushing to `main` redeploys the site.
