# patch-assets/ — click-driven scheme SVGs

Files here are **committed** repo assets that `build.mjs` copies verbatim into `assets/` on
**every** build (after the bundle copy, so they survive the `assets/` wipe). They are how we
replace baked scheme videos in the deck with **live, click-driven animated SVGs** — and have
that replacement re-apply automatically to every future deck version (v16, v17, …).

## How a swap works (the mechanical half — fully automatic)

1. The SVG of a diagram (+ any pictograms it references) lives here.
2. A row in the **`SVG_SWAPS`** table at the top of `build.mjs` maps the deck's baked
   `…mp4` filename → this SVG filename (+ display height + aria label).
3. The `svg-swaps` processing step replaces `<video src="assets/<mp4>">` with
   `<object type="image/svg+xml" data="assets/<svg>">`. `<object>` (not `<img>`) is required so
   the SVG's **sub-resources load** (pictograms in `assets/`, Inter via `../fonts.css`) **and its
   internal `<script>` runs and receives clicks**.
4. Clicks inside the embedded SVG document **don't bubble to the page**, so the deck's own
   click-to-advance-slide still works everywhere *outside* the box.

If a future deck no longer references a swap's `mp4` (e.g. it was renamed in Claude Design),
the build prints a `⚠ svg-swap: … NOT applied (deck changed?)` warning instead of silently
skipping — so you notice and fix the manifest row.

## How to add a new click-driven scheme (the authoring half — per diagram)

The deck's scheme videos were rendered from source SVGs in
`SpatialTimber - Documents/…/_assets/_shared/` (e.g. `scheme_lora_annotated.svg`). Those source
SVGs animate on a **timed CSS loop**. We convert that into a **click-driven state machine**.

1. **Copy** the source SVG here, plus every raster it `<image href>`s (pictograms). Bare
   `href="foo.png"` resolves next to the SVG → `assets/foo.png`, so the pictogram filenames must
   land in `assets/` too (they're in `patch-assets/`, so they do).
2. **Repoint fonts**: change any `@import url('https://fonts.googleapis.com/…')` →
   `@import url('../fonts.css')` so text uses our self-hosted Inter (works offline + online).
3. **Identify the build steps** — usually one click per "thing revealed" (an adapter, a box, an
   arrow). Note the element `id`s each step should reveal/flash. Agree the step list with the user
   (granularity, end behavior, forward-only) before coding.
4. **Replace the timed `@keyframes` + `#id { animation: … }` bindings** with the state CSS below.
5. **Add the click `<script>`** below before `</svg>`.
6. **Drop a row** in `build.mjs`'s `SVG_SWAPS`, **bump `WEB_VERSION`** (minor for a new scheme),
   and run `node build.mjs --reprocess`.

### Reusable pattern (state CSS + script)

The script keeps a `step` counter and writes cumulative classes onto the root `<svg>`:
`on-<key>` per revealed item (cumulative), `head-<n>` for the current headline (exclusive),
`flash-<key>` transiently on the just-activated item, and `cue` only at step 0. CSS does the
rest, so reveals/flashes stay declarative and animate via `transition` / `@keyframes`.

```html
<script type="text/javascript"><![CDATA[
  (function(){
    var KEYS = ['apt','archq','floor','bldg','struct'];   // one per click, in order
    var root = document.documentElement;                  // the <svg> element
    var step = 0, timer = null;
    function paint(flashKey){
      var c = [];
      if (step === 0) c.push('cue');
      for (var i = 0; i < step; i++) c.push('on-' + KEYS[i]);
      if (step >= 1) c.push('head-' + step);
      if (flashKey) c.push('flash-' + flashKey);
      root.setAttribute('class', c.join(' '));
    }
    function advance(){
      if (timer){ clearTimeout(timer); timer = null; }
      if (step >= KEYS.length){ step = 0; paint(null); return; }   // past last -> replay
      step += 1;
      paint(KEYS[step - 1]);
      if (step < KEYS.length){ timer = setTimeout(function(){ paint(null); }, 2300); }
      // omit the timer on the last step if you want it to keep blinking
    }
    root.addEventListener('click', advance);
    paint(null);
  })();
]]></script>
```

CSS skeleton (adapt ids per diagram): default everything hidden / ghosted; `.on-<key> #id`
rules reveal cumulatively; `.head-n #q-…` selects the headline; a `trainFlash` keyframe driven
by `.flash-<key>` gives the terracotta activation blink. See
`scheme_adapters_training_v6_anim.svg` in this folder for a complete worked example
(2 blinks per item; the last item blinks forever; arrow shafts draw via `stroke-dashoffset`).

## Current swaps

| Deck video (slide) | SVG here | Steps |
|---|---|---|
| `15_scheme_adapters_training.mp4` (17) | `scheme_adapters_training_v6_anim.svg` | 5 adapters, click-to-train (2× blink; last keeps blinking), loops. *Cumulative-class state machine.* |
| `14_scheme_lora_annotated.mp4` (13) | `scheme_lora_annotated.svg` | **2 clicks**, each plays a timed sub-sequence: (1) base-model arrow→head→box; (2) plates green→blue→terracotta → adapters box → outline+label. Loops. |
| `15_scheme_typology_annotated.mp4` (14) | `scheme_typology_annotated.svg` | **3 clicks** (apartment/floor/building); each row draws element-by-element (pic → arrow shaft→head → card → transfer arrow → box). Loops. |

**Two authoring patterns are in use** (both fine — pick per diagram): the *cumulative-class state machine* (slide 17 — instant reveals + transitions, good when each click is one discrete reveal), and the *timed-sequence* pattern (slides 13/14 — each click adds a cumulative phase class `p1`/`p2`/… that fires delayed `@keyframes … both` animations, good when one click should play several ordered sub-steps). For the timed pattern: arrows draw shaft first, then the head at a later `animation-delay`; `both` fill keeps each element hidden until its delay and frozen in its end state after, and phase classes are cumulative so earlier phases stay drawn.
