# Hot Air

Fly a hot-air balloon as far as the propane allows – and land softly.
Low-poly 3D, a mobile-first browser game. Design: [docs/HotAir-GDD.md](docs/HotAir-GDD.md).

**Play: https://thesigns.github.io/HotAir/**

Status: **M2** – three countries, every world procedural:

- **The Netherlands** (easy): the polder with ditches, canals, roads, farms, windmills, cows, villages
  with a church, greenhouses, power lines and – in most worlds – the North Sea coast with dunes and a beach.
- **Italy – Tuscany** (medium): rolling hills, a patchwork of fields, vineyards and olive groves (no place
  to land), cypress drives to stone farmhouses, towns on the hilltops.
- **Switzerland** (hard): deep valleys with rivers, lakes, villages and chalets, pine woods, rock and snow
  on the ridges, cable cars, winds that follow the valleys low down, and thin air.

Other balloons with their own pilots. The flight model with burner lag, winds that change with height
and time, the pilot balloon, the wind ladder, three propane presets with records per country, landing
ratings, settings, help, synthesized sound with a soundscape below.

## Running locally

ES modules need an HTTP server (it won't work from `file://`):

```
python tools/serve.py 8766
```

(a plain `python -m http.server 8766` works too, but Chrome then caches the modules), then open
`http://localhost:8766/`. Add `?debug` for a state readout, `?seed=123` to fly the same world again.

On a phone in the same network, open `http://<computer-IP>:8766/`.

## Controls

| Touch | Keyboard / mouse | |
|---|---|---|
| BURN (right thumb), held | W / ↑ / Space | the burner – heat, lift |
| VENT (left thumb), held | S / ↓ | spill hot air – sink; on the ground: deflate |
| drag | mouse drag | look around the balloon |
| pinch | wheel | zoom |
| double-tap | double-click | reset the view |
| II | P / Esc | pause |

Settings: sound, vibration, the burner as tap-on / tap-off instead of held, a left-handed layout.

The balloon answers late: burn, then wait. You only go up and down – every height has its own wind.
The red pilot balloon at the launch draws the winds in the sky; the ladder on the right remembers them,
drawn so that an arrow pointing up takes you further from the launch (green). Flying high is faster,
but the thin air costs more propane.

Other balloons drift with the same winds: one at your own height stays where it is, so the danger is
climbing or sinking through somebody else's height – the HUD warns of a balloon above or below on a
collision course. Power lines along some roads carry orange balls; the HUD warns when your track and
sink rate lead into the wires. The coast is usually somewhere downwind: the beach is a fine place to
land, the sea is not.

When the propane bar reaches the reserve, look for a field. Land on dry, flat ground: a touchdown at
up to 0.3 m/s is EXCEPTIONAL (×1.5), up to 1 m/s GOOD (×1), harder or in the trees ROUGH (×0.5);
water, a house or more than 3 m/s is a CRASH. Hold VENT right after the touchdown, before the basket
is dragged into a ditch. With the propane gone, holding BURN still gives the last vapour – enough to
come down ROUGH instead of crashing.

## Tuning checks

```
node tools/feel.mjs        # the flight model against the GDD §5.1 table
node tools/fly.mjs 60 150 italy  # 60 whole flights with a scripted pilot at ~150 m (netherlands | italy | switzerland)
node tools/traffic.mjs 30  # the other balloons around scripted flights
```
