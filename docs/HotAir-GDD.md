# Hot Air – Game Design Document

*Version 0.2 – 2026-10-23 (simplified scope: distance flights in real countries).*

## 1. Overview

**Hot Air** is a calm hot-air balloon game about one question: *how far can you fly?* The player launches from a field, steers by choosing the height whose wind blows the right way, avoids the other balloons in the sky and, when the propane runs out, puts the basket down softly on flat ground. The score is the distance from the launch field in metres, times the landing multiplier. It is a mobile-first browser game, played in portrait with two buttons: the burner under the right thumb, the vent under the left.

| | |
|---|---|
| Genre | Calm flying / light simulation, distance score |
| Platform | Web browser, phones first (Android Chrome, iOS Safari), desktop as a bonus |
| Orientation | Portrait on phones; landscape only on a computer |
| Session | A flight takes 2–8 minutes, depending on the propane chosen |
| Visual style | Low-poly, flat-shaded 3D, third-person camera orbiting the balloon |
| World | Procedural terrain, a different look and challenge in every country |
| Tech | Vanilla JS + Three.js, no build step, hosted on GitHub Pages |
| Monetisation | None – a free hobby project, no ads, no purchases |

### Elevator pitch

*Burn, wait, drift – then land.* The only thing you control is up and down, and every height has its own wind. Find the layer that carries you furthest, keep clear of the other balloons, and save enough propane to land on flat ground before the hills, the forest or the sea. Every extra metre is a risk.

### Why a balloon

*Jasta 11* showed that free 3D flight with a two-axis stick is hard on a phone. *Tram* took the opposite way: the rails steer, the player controls a single axis (power / brake). A balloon goes one step further: the wind steers, the player controls a single axis (heat), and the control is two buttons you hold. The challenge is planning and reading the world, not finger dexterity – and because there is nothing to aim, the camera is free to look around.

## 2. Design pillars

1. **Simple to start.** One button starts a new flight. The goal fits in one sentence: fly as far as you can and land safely.
2. **Two buttons, both held.** Hold BURN and the burner roars; let go and it stops. Hold VENT and hot air spills out of the top. Nothing else is needed to fly.
3. **The wind is the steering wheel.** You steer by choosing a height. Reading the winds – in the world, not in menus – is the real skill.
4. **The balloon answers late.** Heat takes seconds to turn into lift, so good pilots burn early and wait.
5. **Push your luck.** Every metre further is a metre closer to an empty burner over bad ground. Knowing when to land is as important as flying far.
6. **Every country is a different flight.** Flat Dutch polders, rolling Tuscan hills, steep Swiss valleys – a different look, different winds and different places to land.

## 3. Core loop

```
Menu: choose a country and the propane → NEW FLIGHT (new random terrain and winds)
      ↑                                                       ↓
 Records ← Results: metres × landing ← Land ← Fly: read the winds, climb or sink, avoid balloons
```

**Within a flight:** the balloon stands inflated on the launch field → the pibal shows the winds → lift off → find a good layer → drift, switch layers as the winds change → watch the propane → pick a flat spot → descend → land → the distance, the landing rating and the score are shown.

**Across flights:** the best score per country and propane setting is the record to beat. Every country is open from the start.

## 4. Controls

### 4.1 Touch (portrait, primary)

```
┌─────────────────────────┐
│ 1 840 m        ▮▮▮▮▯▯▯  │ ← distance so far, propane
│                       ┃▸│
│                       ┃ │ ← wind ladder: height,
│        ( balloon )    ┃●│   climb/sink, wind per height
│           |_|         ┃ │
│                       ┃ │
│   drag: look around   ┃ │
│   pinch: zoom         ┃ │
│   double-tap: reset   ┃ │
│                         │
│ [  VENT  ]   [  BURN  ] │
└─────────────────────────┘
  left thumb    right thumb
```

- **BURN (right thumb), held:** the burner fires as long as the button is held – a real blast valve works the same way. Short blasts keep the height, long ones climb. Haptic pulse while burning (`navigator.vibrate`, where supported).
- **VENT (left thumb), held:** opens the parachute valve at the top of the envelope; hot air spills out and the balloon sinks. After touchdown, holding VENT deflates the balloon.
- **Camera:** drag anywhere outside the buttons to orbit around the balloon, pinch to zoom, **double-tap to reset** the view. There is no automatic return: the camera stays where the player put it.

### 4.2 Desktop

- **Landscape (computer only):** the buttons in the bottom corners, a wider view. A phone held sideways shows a "turn your phone" card and pauses the flight (as in *Tram*).
- **Keyboard:** W, ↑ or Space – burn (held); S or ↓ – vent (held); P or Esc – pause.
- **Mouse:** drag to orbit, wheel to zoom, double-click to reset the view.

### 4.3 Settings

Settings hold only things that don't change the score:

- Sound and music volume, haptics on/off.
- **Burner toggle:** tap to start and tap to stop, instead of holding.
- **Left-handed layout:** BURN and VENT swapped.
- **Assists:** the predicted track and touchdown point drawn on the ground; the full wind ladder from the start (§9). Records with assists are kept, but marked.

The propane is **not** a setting – it is chosen before the flight (§5.3), because it changes the score.

## 5. Flight model

The balloon moves with the air. Horizontally it is carried by the wind at its height; there is no relative wind, which is why a balloon flight is silent and still. Vertically it is a heavy, slow body pushed by buoyancy.

- **Buoyancy:** lift = g · V · ρ_air · (1 − T_air / T_envelope) − g · M. The hotter the envelope compared to the outside air, the more lift. The air gets thinner with height above sea level, so **flying high costs more propane** – the main trade-off of the game (§6.2).
- **Inertia:** the balloon must also move the air inside the envelope and around it (added mass), several tonnes in all. That is why it answers so slowly and why a climb, once started, keeps going for a while.
- **Heat:** the burner adds heat; the envelope cools all the time towards the outside temperature; the open vent cools it quickly. Without burning, a balloon slowly starts to sink – so flying is a gentle rhythm of short blasts.
- **Drag:** vertical air resistance limits the climb and sink rates.
- **Ground contact:** the basket bumps, slides and drags on the ground in the surface wind until the balloon is deflated or lifts off again.

### 5.1 Target feel

A real balloon compressed for a phone session (the numbers are the targets for tuning, in the game's config, checked with scripted pilots like *Tram*'s bots):

| Manoeuvre | Target |
|---|---|
| Hold a height | a 2–3 s blast every ~15 s |
| Burner lag | the climb starts ~3 s after the blast begins |
| A 10 s burn from level flight | climbs to ~2 m/s within ~10 s, then slowly levels off |
| Burning continuously | up to ~4 m/s climb |
| No burning from level flight | sinks, ~1 m/s after ~20 s |
| VENT held 3 s | sinks at ~3 m/s |
| Deflate on the ground (VENT held) | ~4 s |

The world is compressed like *Tram*'s cities: winds of 10–30 km/h carry the balloon a few kilometres in a flight, over densely packed landscape, at heights from 0 to about 400 m above the ground. The wind speeds and the flight physics run in real time; only the sun and the light move faster, for mood.

### 5.2 Propane

- The propane is shown as segments of a bar. Burning uses it; nothing else does.
- **Reserve:** the last part of the bar is marked as the reserve. When the balloon enters it, the chase crew calls on the radio ("we're on the reserve – time to look for a field").
- **Empty burner:** the flight never ends by itself – the player always gets to land. Holding BURN with the propane gone still gives **the last vapour**: a weak flame that can't hold the height, but softens the fall to about 2 m/s – enough for a ROUGH landing, never a GOOD one. Without it the balloon cools and falls hard. The vent still works. These last tens of seconds – picking a spot while sinking – are the finale of a greedy flight. Where the basket comes down decides the rating (§6.4): over water it is always a CRASH, over a forest at best ROUGH.

### 5.3 Propane presets

Chosen in the menu before NEW FLIGHT. Each preset has its own records.

| Preset | Cylinders | Flight length (target) |
|---|---|---|
| Short | 1 | ~2–3 min |
| Standard | 2 | ~5 min |
| Long | 3 | ~8 min |

## 6. The flight

### 6.1 Launch

- NEW FLIGHT generates a new random seed: the terrain, the winds and the other balloons. The seed is shown in the results, so a good flight can be repeated or shared (later).
- The balloon stands inflated on a launch field, the burner on the pilot light. Other balloons are launching around it or already in the air.
- **The pilot balloon (pibal):** a small red helium balloon is released, as real pilots do, and its path leaves a fading trail – the wind profile drawn in the sky. It is the briefing and the first entries of the wind ladder (§9).
- **No tutorial** for now: the game should be simple enough to learn by playing, with the pibal and the chase crew's radio hints. If playtests show that players get lost, a tutorial flight is added.

### 6.2 Winds

- Each flight has a **wind profile**: direction and speed at a few heights, interpolated smoothly between them, generated from the seed and the country's character (§8). Example:

| Height above ground | Wind |
|---|---|
| 0–30 m | 4 km/h from the south-west (the surface wind) |
| 30–120 m | 10 km/h from the west |
| 120–250 m | 18 km/h from the north-west |
| above 250 m | 25 km/h from the north |

- Winds turn clockwise with height (they *veer*), so a typical day gives the player a fan of directions and speeds to choose from.
- **The distance is a straight line** from the launch field to the touchdown point, not the length of the track. A layer that keeps carrying the balloon in one direction is worth more than a fast one that turns.
- **No single best height.** The fastest wind is usually high up, where the thin air costs the most propane. The player looks for the best distance per cylinder, not the fastest layer.
- **Changes over time:** layers slowly strengthen, weaken, rise and turn during the flight, so the best height must be found again from time to time.
- **Terrain:** hills and valleys bend and channel the low winds (strongly in Switzerland, not at all in the Netherlands).

### 6.3 Other balloons

- AI balloons fly around the player's balloon. They follow the same winds and change their height like real pilots: climbing, sinking, landing.
- Balloons at the same height drift together and hardly move against each other. **The dangerous moment is crossing another balloon's height** – climbing or sinking through its layer, where the winds are different.
- **Touching another balloon ends the flight.** The screen fades and a card explains it; no drama.
- Other balloons also show the winds: watching which way they drift at their height is free information for the wind ladder.
- **Telegraphing:** a balloon on a collision course within ~15 s is marked on the HUD, especially one directly above or below the basket, which is hard to see.

### 6.4 Landing

The landing is the skill shot:

- **Where:** flat, open ground – a meadow, a field, a beach. The game checks the slope under the basket and the obstacles around it.
- **Touchdown** gets one of four ratings, shown as a big popup:

| Rating | When | Multiplier |
|---|---|---|
| EXCEPTIONAL | Flat ground, sink rate ≤ 0.3 m/s, the basket stays upright | × 1.5 |
| GOOD | Flat ground, sink rate ≤ 1.0 m/s | × 1 |
| ROUGH | A hard touchdown (sink rate up to ~3 m/s), or ground too steep, so the basket tips on its side | × 0.5 |
| ROUGH (forest) | Coming down in a forest: the basket ends in the treetops (or below them). Never better than ROUGH | × 0.5 |
| CRASH | Faster than ~3 m/s anywhere, or water (always), a roof, a power line, another balloon (§7) | × 0 |

  The thresholds are targets for tuning. EXCEPTIONAL is meant to be hard: a patient final approach with small blasts just above the ground.
- **The drag:** after touchdown, the sooner the player holds VENT, the shorter the basket drags. The distance is measured **at the touchdown**, so dragging adds no metres – but it can pull the basket into a ditch (CRASH) or the trees (ROUGH). After ~12 s on the ground the chase crew holds the basket and the flight ends.
- **The score** = the distance in metres × the landing multiplier, rounded to whole points. A greedy flight that ends in a ROUGH landing can score less than a shorter one with a GOOD one.

### 6.5 Results and records

- The results screen counts up: **the distance in metres**, then the landing rating and its multiplier, then **the score**. Also shown: the propane left (if any), the seed, and the best score for this country and preset. "NEW RECORD!" when it is beaten.
- A CRASH still shows how far the flight got, with a score of 0.
- Two buttons: **NEW FLIGHT** (a new seed, same country and preset) and **MENU**.
- Records: one best score per country × propane preset (3 countries × 3 presets = 9 records at first), stored locally, with the distance and the rating it came from. Records per seed come later, with the daily flight and seed sharing (M3). Medals per country and preset by score thresholds (bronze / silver / gold) can come later too.

## 7. Obstacles and dangers

| Event | Result |
|---|---|
| Touching another balloon | **CRASH** – the flight ends (×0). |
| Touching a power line or a cable car wire | **CRASH** – the flight ends (×0). The deadliest real danger in ballooning. The screen fades and a card explains it; no gore. |
| Landing in water (sea, lake, canal, ditch) | **CRASH** – a wet landing (×0), always, however soft. |
| Coming down in a forest | **ROUGH** at best (×0.5); faster than ~3 m/s it is a CRASH. |
| Coming down on a roof | **CRASH** – the flight ends (×0). |
| Scraping through treetops | Slows the balloon; burn out of it. |
| Flying out over the sea | Not an end by itself, but there is nowhere to land: the player must turn back with a different layer before the propane runs out. Coming down in the sea is always a CRASH. |
| Propane runs out | The flight goes on: the balloon sinks slowly and the player lands with the vent (§5.2). |

- **Telegraphing rule** (from *Tram*): every danger is visible early and readable from the default camera. Pylons are tall and the wires carry orange marker balls; the HUD marks a power line only when the balloon's track and sink rate would bring it to the wires within ~30 s. Haze and draw distance never hide that zone.

## 8. Countries

The world is procedural, generated from the seed, but every country has its own generator settings, palette, buildings and winds. The countries are real; the terrain is a stylised impression, not a map.

### 8.1 The Netherlands – easy

- **Look:** flat polders cut into long strips by ditches and canals, dikes with roads on top, windmills, brick villages with a church tower, tulip fields in bright stripes, greenhouses glinting, cows, the North Sea coast with dunes and a wide beach.
- **Landing:** plenty of flat ground – but the ditches are water, and the greenhouses are glass. The beach counts as flat.
- **Winds:** strong and steady, little turning near the ground, no terrain effects.
- **The challenge:** the sea. When the wind blows towards the coast, every metre further brings the balloon closer to the end of the land. Land on the last field before the dunes, or on the beach – or find a layer that turns along the coast.

### 8.2 Italy (Tuscany) – medium

- **Look:** rolling hills, rows of cypresses along white gravel roads, vineyards and olive groves, hilltop towns with towers, stone farmhouses, golden wheat and sunflower fields, a warm palette.
- **Landing:** the fields lie on gentle slopes, so the slope check matters: the flat ones are on the hilltops and the valley floors. Vineyards and olive groves are not landable (posts, wires, trees).
- **Winds:** light, bent by the hills.

### 8.3 Switzerland – hard

- **Look:** steep peaks with snow and rock, narrow green valleys with a river and a road, lakes, chalets and cows on the meadows, forests on the slopes, cable cars, a church with a bell tower.
- **Landing:** little flat ground – the valley floors and a few meadows. The player must plan the landing into a narrow valley.
- **Winds:** the low winds flow along the valleys; above the ridges a different, stronger wind. Crossing into the next valley means climbing over a ridge.
- **The thin air:** the ground is high above sea level, so every metre of climb costs more propane than in the Netherlands. The physics (§5) gives this for free.
- **The cable cars:** their wires are a danger like power lines.

### 8.4 Later countries

- **Turkey (Cappadocia):** the most famous balloon place on Earth. Fairy chimneys, canyons, cave houses, a beige-pink-orange palette, and dozens of balloons at dawn – the country of "don't touch the others".
- **England:** small fields divided by hedges and stone walls, sheep, villages with thatched roofs. Flat ground is everywhere, but every field is small.
- **Kenya (Masai Mara):** the savanna, acacias, a river, herds of animals. A lot of flat ground, but the herds move.
- **Poland:** the lakes and forests of Masuria, or the Tatra foothills.

## 9. HUD

Kept minimal; the world says the rest.

- **Top:** the distance from the launch field so far (in metres), and the propane bar with the reserve marked.
- **The wind ladder** (right edge): a vertical scale from the ground to the ceiling with
  - the balloon's height marker and its climb or sink as an arrow (the variometer – the instrument that matters most with a lagging balloon);
  - wind arrows at the heights the pilot knows about. The arrows are drawn relative to the **direction away from the launch field** (an arrow pointing up means "this layer takes you further"), so they don't spin when the camera orbits.

  The ladder is the pilot's memory: it starts with what the pibal showed, adds every layer the balloon flies through and what the other balloons reveal, and old entries fade as the winds change. The full ladder is an assist (§4.3).
- **Contextual:** "Hold VENT to deflate" after touchdown; the landing rating popup.
- **Warnings** only for what the player can't see and must act on: a balloon on a collision course above or below, a power line in the balloon's path, the reserve. Everything the player can see stays in the world.

## 10. Camera and presentation

- **Third-person orbit camera** around the balloon. Drag to orbit (yaw unlimited, pitch from about the basket's level to high above), pinch to zoom from ~8 m (the basket, the flame) to ~300 m (the landscape, the other balloons). The camera never goes into the ground.
- **Default view** (start, and after a double-tap): behind the balloon along its ground track and a little above it, looking slightly down, so the ground ahead – where it is going – fills the lower part of the screen. In portrait the balloon sits a little above the centre (`camera.setViewOffset`, as in *Tram*).
- **Height cues:**
  - the **plumb ring**, a soft circle on the ground straight below the basket, growing sharper as the balloon gets lower;
  - the **sun shadow** of the balloon;
  - the **soundscape**, which gets quieter with height (§11);
  - the wind ladder (§9).
- **Reading the wind in the world:** smoke from chimneys, flags at the launch field, turning windmills, waving grain, clouds at their height, the other balloons, the pibal trail.
- **Time of day:** each flight is a morning or an evening, from the seed – for the light only.

## 11. Audio

Synthesised with Web Audio where possible (as in *Tram*), with samples later if needed.

- **The burner:** a deep roar with a hiss – the signature sound, loud and satisfying; the pilot light ticks quietly between blasts.
- **Silence:** a balloon moves with the wind, so there is no wind noise. Between blasts, the player hears the ground: dogs barking, cows and their bells, a church bell, a tractor, the sea. These sounds fade with height, which tells the player how high they are. Each country has its own set.
- The wicker basket creaks, the envelope fabric rustles when venting, the basket thumps and scrapes on landing.
- **The chase crew on the radio:** short lines as hints ("burn, then wait", "we're on the reserve").
- Birdsong at dawn, other balloons' burners in the distance.

## 12. Visual style

- Low-poly, flat-shaded, a limited palette per country: green and tulip colours for the Netherlands, gold and cypress green for Tuscany, white, grey and alpine green for Switzerland.
- Villages built from the same kit idea as *Tram*'s cities, with a building set per country (Dutch brick gables, Tuscan stone towers, Swiss chalets) and landmarks (windmills, a hilltop town, a church on a rock).
- Light by the time of day: sunrise and evening, haze for distance and mood.
- Balloons with bold envelope patterns, every AI balloon different; procedural first, models in **Blender** (GLB) later.

### 12.1 Typography

Two fonts: a round, playful one with character for the big words, and the system font for everything small.

- **Grandstander** (Google Fonts) for the logo and headings: the heaviest weight for the *Hot Air* logo, a bold weight for headings, big popups (NEW RECORD!, the landing rating) and the main buttons. Only the weights in use are loaded.
- **The system font** for small text, settings and the HUD readouts: `ui-rounded, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. On Apple devices `ui-rounded` gives SF Pro Rounded, which matches the round look; elsewhere it falls back to the normal system font. Nothing to download.
- Numbers that change (the distance, the height) use `font-variant-numeric: tabular-nums`, so the digits don't jump.

## 13. Technical design

### 13.1 Stack

- Vanilla JS, ES modules, Three.js via `importmap` from a CDN. No bundler and no npm (same as *Tram*).
- `index.html` in the repo root; everything else in folders. Relative paths for GitHub Pages.
- English everywhere: UI, code, comments, docs.

### 13.2 World and data

- Units: metres, seconds, radians; Y is up. Wind directions in data are meteorological (where the wind comes from, in degrees).
- **Endless procedural terrain** from the seed, generated in chunks around the balloon, so a flight can go in any direction. A low-poly triangulated grid with flat shading.
- **Countries as data** (`data/countries/*.json`): the terrain generator settings (height noise, ridges, valleys, flatness), the land cover mix (fields, forest, water, villages), the building set and palette, the wind character (speeds, turning, terrain channelling), the soundscape. Special features per country: the coastline (Netherlands), the valley network (Switzerland).
- **A landing guarantee:** the generator makes sure flat, open ground appears often enough for the country's difficulty, so a bad result comes from the player's choices, not from bad luck.
- **The wind field** is a function `wind(x, y, z, t)`: the profile, smoothly interpolated, its changes over time, plus terrain channelling.
- **Chunks and levels of detail:** from 400 m the player sees a lot of land, so the terrain uses distance-based detail, villages are merged per chunk, trees and animals are instanced, and haze hides the far edge.

### 13.3 Simulation

- A fixed-step simulation (60 Hz): heat → lift → vertical motion, the wind → horizontal motion, ground contact. Gameplay logic does not import Three.js, so it can be tested in Node with scripted pilots (bots) measuring the target-feel table (§5.1) and the flight length per propane preset (§5.3).
- The AI balloons use the same simulation with simple pilot logic (pick a height, hold it, change it now and then, land).
- The landing check: slope under the basket and obstacles within a few metres.
- A `?debug` URL flag exposes state for measuring and tuning, and a `?seed=` flag for repeating a flight.

### 13.4 Performance targets

- 60 fps on a mid-range Android phone; adaptive pixel ratio.
- < 150 draw calls; haze, chunk culling, instancing.
- First load < 3 MB.

### 13.5 Saving

- Records (best score per country × preset) and settings in `localStorage`, wrapped in try/catch, with a versioned key. No accounts.

## 14. Scope and milestones

### M0 – Prototype (prove the calm fun)

- The Netherlands, simplified: flat procedural terrain with fields, ditches and trees.
- One balloon, BURN and VENT, the flight model (lag, cooling, vent, thin air), three wind layers.
- The propane bar (one preset), the empty-burner sinking.
- The landing check and rating, the score (metres × landing multiplier) on the results screen, NEW FLIGHT.
- The orbit camera with pinch and double-tap, the plumb ring, the wind ladder, the pibal.
- The burner sound.
- **Test on a real phone in week one.**
- **Success criterion:** holding a height and landing on flat ground feels calm and learnable within 2–3 flights; switching layers to fly further clicks without explanation after the pibal; players want "one more flight" to beat their distance.

### M1 – The Netherlands complete

- Dikes, canals, windmills, villages, greenhouses, the coast and the beach.
- Other balloons with AI pilots and the collision warning; power lines.
- The three propane presets, records, the menu, settings.
- The soundscape, the chase crew radio.

### M2 – Italy and Switzerland

- Both countries with their generators, building sets, palettes and winds; valley channelling; cable cars.

### M3 – Polish and more countries

- Turkey (Cappadocia), then England, Kenya, Poland.
- Blender models, medals, a daily flight with a fixed seed, sharing a seed. A PWA only if asked for.

## 15. Risks

| Risk | Mitigation |
|---|---|
| One best strategy (climb to the fastest layer and wait) | Thin air makes high flying expensive; the distance is a straight line; the layers change during the flight; other balloons take up heights |
| Too slow, boring | Compressed distances, a dense landscape, a camera worth playing with, the tension of the propane bar and the landing |
| Unfair procedural terrain (nowhere to land) | The landing guarantee in the generator; bots that fly many seeds and report bad ones |
| Steering by height feels too indirect | Pibal at every launch, the wind ladder, clear contrasts between layers, the predicted-track assist |
| Height hard to judge from the third person | The plumb ring, the soundscape, the ladder, the default view looking down at the ground ahead |
| The lag makes players overcorrect (bobbing) | The variometer arrow front and centre on the ladder; the radio line "burn, then wait"; tune the lag on real phones |
| Collisions feel random | Balloons in the same layer drift together; the warning for balloons above and below; AI pilots that change height slowly and visibly |
| Endless terrain too costly | Haze, chunked terrain with levels of detail, instancing, merged villages, chunks dropped behind the balloon |
| Holding buttons on touch (long-press menus, text selection) | `touch-action: none`, no user selection, Pointer Events – solved in *Tram* |
| Camera gestures fighting the buttons | Gestures only outside the buttons; multi-touch through Pointer Events |

## 16. Open questions

None at the moment.

## Appendix A: Carry-over from *Tram*

Reusable ideas and code (repo: `thesigns/Tram`):

- The project rules: vanilla JS, Three.js `importmap`, no build step, GitHub Pages, English, tuning in `js/config.js`, gameplay logic testable in Node.
- Fixed-step simulation with render interpolation; `?debug` with a state readout and a `window` handle for console measurements; bots for tuning.
- Input: Pointer Events buttons with haptic ticks, keyboard bindings, no long-press menus.
- The HUD canvas, laid out for a 390 px phone and scaled up on bigger screens; prompts only for what the player can't see.
- Portrait on phones with the "turn your phone" card; `camera.setViewOffset` for the optical centre.
- Web Audio synthesis patterns; the progress module (`localStorage`, try/catch, versioned key).
- The low-poly building kit idea for villages; merged geometry per chunk.
- Practical lessons: Chrome caches modules served by `http.server` (hard-reload); avoid `localhost:8080`; check the phone layout with an injected 390×780 `<iframe>`; measure, don't judge by eye.
