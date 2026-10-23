# AGENTS.md

Guidance for AI agents working on this repository. The game design is in `docs/HotAir-GDD.md`; controls are in `README.md`.

## Project overview

Hot Air is a calm hot-air balloon game: fly as far from the launch field as the propane allows, steering only by height (every height has its own wind), and land softly on dry, flat ground. Score = distance in metres × the landing multiplier (EXCEPTIONAL ×1.5, GOOD ×1, ROUGH ×0.5, CRASH ×0). Low-poly 3D, a mobile-first browser game: portrait on phones (a phone held sideways gets a "turn your phone" card and the flight pauses), landscape only on a computer. The target host is GitHub Pages. A sister project of *Tram* (`../Tram`, repo `thesigns/Tram`) – same rules and many patterns carried over. Current state: **M0 prototype** (GDD §14) – the Netherlands, simplified (polder with ditches, roads, canals, farms, trees); the flight model; three-plus wind layers that drift; the pibal; the wind ladder; propane with a reserve and the last vapour; landing check and rating; results and a record; the burner sound.

## Technical rules

- **Vanilla JS + ES modules, no bundler and no npm.** Three.js `0.160.0` from jsDelivr via the `importmap` in `index.html`. Don't add a build step or `package.json` unless explicitly asked.
- **Fonts** (GDD §12.1): Grandstander from Google Fonts (700, 900) for the logo, headings, buttons and HUD popups; the system font stack `ui-rounded, system-ui, …` for everything small. Numbers that change use tabular figures (`font-variant-numeric` in CSS, fixed digit cells – `Hud.digits` – on the canvas).
- **`index.html` must stay in the repo root.** Everything else goes into subfolders. All paths are relative.
- **No PWA** until the user asks for it; no fullscreen request.
- Everything is **in English**: UI text, code comments, docs.
- Code style: 2 spaces, semicolons, single quotes, brief comments only where something isn't obvious. Scratch objects used in hot loops live at module level.
- Tuning belongs in `js/config.js`. The flight model must keep matching the GDD §5.1 table – check with `node tools/feel.mjs` after any change to `BALLOON`, `ATMOS` or `PROPANE`; whole flights over many seeds with `node tools/fly.mjs [flights] [height]`.

## Conventions

- Units: meters, seconds, radians, kelvin. Y is up, **−Z is north, +X is east**. Headings are clockwise from north: a heading `h` points along `(sin h, 0, −cos h)`; an object facing it has `rotation.y = −h`. Wind directions are meteorological (where the wind comes **from**); the air moves towards `dir + π`.
- Gameplay logic doesn't import Three.js, so it runs in Node: `js/core/balloon.js` (the physics), `wind.js`, `flight.js` (phases, landing, rating, the ladder, the pibal), `js/world/polder.js` (the terrain as data). Rendering lives in `js/world/polderView.js`, `props.js`, `js/models/balloon.js`.
- **The flight model** (`Balloon`, GDD §5): envelope temperature → buoyancy against weight and quadratic drag, with the envelope's air and added mass in the inertia. `y` is the basket floor (altitude). The burner heats (fading near `tMax` – the natural ceiling), the envelope cools towards the air, the vent cools fast. The pressure falls off with `ATMOS.scaleHeight` (compressed, so flying high costs more propane – the main trade-off). Propane is counted in seconds of burning; the balloon gets lighter as it burns. With the propane gone, BURN gives `BALLOON.vapour` of the heat – a ROUGH landing, not a crash.
- **The flight** (`Flight`): phases `launch` (tethered) → `air` ⇄ `ground` (a touchdown; climbing above `GROUND.hop` again is a hop) → `done` | `crashed`. The distance is measured **at the touchdown** (the drag adds nothing). The rating uses the hardest touchdown since the balloon was last clearly airborne. Water under the basket at a touchdown or during the drag, a house, or more than `LANDING.crash` is a CRASH; ending in the trees is ROUGH. VENT on the ground deflates; the crew ends the flight after `GROUND.crew` seconds anyway. Events go to `onEvent` (liftoff, touchdown, hop, reserve, empty, done, crash).
- **The wind ladder** (`flight.ladder`, one entry per `LADDER.bin` m): learned from the pibal and from the balloon's own height. Arrows are drawn relative to `flight.ref` – "away from the launch" – so they don't spin with the camera.
- **The polder** (`Polder`): square blocks (`POLDER.block`) between border lines whose type (road, canal, ditch) depends on the line index only, so roads run straight for kilometres. A block is a wood, or field strips across one axis separated by narrow ditches, maybe a farm (yard at the end of a strip, house and barn) and rows of trees along its roads. Everything is axis-aligned and deterministic from `hash(seed, i, j)`; block (0, 0) is the launch block (a pasture strip, roads all round). `surfaceAt`, `near` (trees and houses) and `height` are what the landing and collisions use. Later countries get their own terrain class with the same interface.
- **Rendering the polder**: chunks of `POLDER.chunk²` blocks, one merged vertex-coloured mesh each (double-sided Lambert), built one per frame around the balloon within `POLDER.viewRadius`, dropped beyond. Water is drawn slightly below the fields, with banks.
- Simulation runs at a fixed 60 Hz step; rendering interpolates the balloon position.

## Mobile view and controls

- `resize()` in `js/main.js` moves the optical centre with `camera.setViewOffset` (40% from the top in portrait). The HUD canvas is laid out for a 390 px phone and scaled up on bigger screens (`VIEW.hud*`).
- BURN and VENT are held buttons (`js/core/input.js`, Pointer Events with pointer capture, so both thumbs work at once). Camera gestures only on the game canvas: one finger orbits, two pinch, a double tap resets. The default camera follows the ground track; after a drag it stays where the player put it (GDD §10).

## Testing

- Start a server with `python -m http.server 8766` (Tram uses 8765). **Don't use port 8080.**
- The browser caches modules served by `http.server`: hard-reload (Ctrl+Shift+R) after changes.
- `?debug` shows a state readout and exposes `window.hotair = { game, input, sound, camera, cam, flight, balloon, polder, wind, view, startFlight }`; `?seed=N` repeats a world. Measure with console scripts instead of judging by eye (`input.burnKey = true` holds the burner).
- To check the phone layout, inject a 390×780 `<iframe>` into a page from the same server that doesn't run the game itself (e.g. the `/docs/` listing).
- Test on a real phone early (GDD §14).
- The console must stay clean.
