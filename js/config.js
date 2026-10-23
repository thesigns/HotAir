// Game tuning constants. Units: meters, seconds, radians, kelvin (data uses degrees and km/h).
// Targets for the flight model are the GDD §5.1 table – check them with `node tools/feel.mjs`.

export const SIM = {
  hz: 60,               // fixed simulation step
};

// The air (GDD §5). The vertical scale is compressed for the game: the pressure falls off much faster
// with height than in the real atmosphere, so flying high noticeably costs more propane (GDD §6.2).
export const ATMOS = {
  g: 9.81,
  rho0: 1.225,          // air density at the ground at T0 [kg/m³]
  T0: 283,              // air temperature at the ground: a cool morning, 10 °C [K]
  lapse: 0.0065,        // the air cools with height [K/m]
  scaleHeight: 1500,    // pressure ratio = exp(−height / scaleHeight) – the real one is ~8400 m
};

export const BALLOON = {
  volume: 2500,         // envelope [m³] – a 4-person balloon
  dryMass: 600,         // envelope, basket, burner, empty cylinders and four people [kg]
  propaneMass: 20,      // propane per cylinder [kg]: the balloon gets lighter as it burns
  dragK: 118,           // vertical drag force = dragK · v² [N]: limits the climb and the sink
  addedMass: 0.5,       // the outside air moved with the envelope, as a fraction of its volume
  // heat (GDD §5): the burner heats, the envelope cools towards the air, the vent spills hot air
  burner: 3.0,          // heating while the burner fires [K/s]
  cool: 0.0065,         // cooling rate per kelvin of envelope over air [1/s]
  vent: 0.078,          // extra cooling with the vent open, per kelvin over air [1/s]
  tMax: 398,            // the burner can't heat the envelope beyond this (125 °C) …
  tMaxSoft: 6,          // … fading out over the last kelvins: a natural ceiling
  vapour: 0.13,         // with the propane gone, BURN still gives this much of the heat: the last vapour softens
                        // the fall to ~2–3 m/s – a ROUGH landing, but a landing (GDD §5.2)
  startBelow: 2.5,      // at the launch the envelope is this much cooler than needed to lift off [K]
  // horizontal: the balloon follows the wind at its height, adapting with this rate [1/s]
  follow: 0.25,
  // the shape (rendering, camera, collisions)
  basket: 1.2,          // basket size and height [m]
  mouth: 3.4,           // the envelope mouth above the basket floor [m]
  height: 18,           // envelope height [m]
  radius: 7.8,          // envelope radius at its widest [m]
  centre: 12.5,         // envelope centre above the basket floor (camera target) [m]
};

// Propane (GDD §5.2): counted in seconds of burning. The last part of the bar is the reserve.
export const PROPANE = {
  cylinder: 30,         // seconds of burning per cylinder
  reserve: 0.18,        // fraction of the total
  presets: {
    short: { cylinders: 1, name: 'Short' },
    standard: { cylinders: 2, name: 'Standard' },
    long: { cylinders: 3, name: 'Long' },
  },
  preset: 'standard',   // M0: only this one is offered
};

// The ground (GDD §5, §6.4).
export const GROUND = {
  drag: 0.45,           // an inflated balloon on the ground drags the basket at this fraction of the surface wind
  dragRate: 1.5,        // [1/s]
  deflate: 4,           // VENT held on the ground deflates the balloon in this many seconds
  hop: 3,               // higher than this above the ground, a touchdown was only a hop: the flight goes on [m]
  stopSpeed: 0.05,      // the basket has stopped [m/s]
  maxSlope: 0.12,       // steeper than this, the basket tips on its side (rise / run)
  crew: 12,             // after this long on the ground the chase crew holds the basket: the flight ends [s]
};

// Landing ratings and multipliers (GDD §6.4).
export const LANDING = {
  exceptional: 0.3,     // sink rate at touchdown [m/s]
  good: 1.0,
  crash: 3.0,
  mult: { EXCEPTIONAL: 1.5, GOOD: 1, ROUGH: 0.5, CRASH: 0 },
};

// Trees: the basket scrapes through the crowns; sink into them and you have landed in the forest.
export const TREES = {
  scrape: 2.5,          // horizontal speed lost in a crown [1/s]
  hold: 3,              // vertical speed lost in a crown [1/s]
  stuck: 2.5,           // deeper than this below the treetops, the basket is stuck [m]
};

// Winds (GDD §6.2): a profile of a few heights, interpolated; each node drifts slowly during the flight.
export const WIND = {
  heights: [0, 60, 170, 320],          // profile nodes above the ground [m]
  speed: [[3, 8], [8, 16], [12, 22], [15, 27]],   // km/h ranges per node: faster up high, but not always
  veer: [[15, 45], [20, 55], [15, 50]], // the direction turns clockwise between nodes [deg]
  driftDir: 22,         // directions wander by up to this during a flight [deg]
  driftSpeed: 0.3,      // speeds by up to this fraction
  driftPeriod: [140, 260],             // seconds
};

// The pilot balloon at the launch (GDD §6.1).
export const PIBAL = {
  climb: 3.5,           // [m/s]
  top: 520,             // it fades out here [m]
  sample: 0.5,          // trail point every … [s]
  trailLife: 120,       // the trail fades over … [s]
};

// The wind ladder (GDD §9): what the pilot knows about the winds.
export const LADDER = {
  bin: 25,              // one entry per this many meters
  top: 500,             // the scale reaches this height [m]
  fresh: 60,            // entries stay bright this long [s] …
  stale: 200,           // … and fade until this age
  maxKmh: 30,           // the longest arrow
};

// The procedural Dutch polder (GDD §8.1).
export const POLDER = {
  block: 240,           // polder blocks between roads, canals and wide ditches [m]
  chunk: 2,             // blocks per render chunk side
  viewRadius: 1900,     // chunks whose centre is closer than this are built [m]
  strip: [26, 48],      // field strip widths [m]
  ditch: 1.0,           // ditch half-width between strips [m]
  edge: { ditch: 1.6, road: 3, canal: 5 },   // half-widths of the block borders
  edgeOdds: { road: 0.4, canal: 0.15 },      // per border line; the rest are wide ditches
  forest: 0.06,         // chance that a block is a wood
  farm: 0.38,           // chance of a farm in a block
  treeRow: 0.6,         // chance of a row of trees along a road, per block side
};

export const VIEW = {
  hfovPortrait: 64,     // degrees
  hfovLandscape: 80,
  centerPortrait: 0.4,  // optical centre, fraction of the screen height from the top
  centerLandscape: 0.47,
  far: 4000,
  fogNear: 350,
  fogFar: 1800,
  // the orbit camera (GDD §10)
  dist: 46,             // default distance from the envelope centre [m]
  pitch: 0.2,           // default elevation above the centre [rad]
  minDist: 8,
  maxDist: 300,
  minPitch: -0.12,
  maxPitch: 1.35,
  orbit: 0.006,         // rad per pixel of drag
  follow: 0.8,          // the default view turns towards the ground track with this rate [1/s]
  // the HUD is laid out for a 390 px wide phone; bigger screens (a computer) scale it up
  hudWidth: 390,
  hudHeight: 600,
  hudMaxScale: 1.6,
};

export const WORLD = {
  sunDir: [0.75, 0.32, -0.45],   // a low morning sun in the east
  fogColor: 0xd9d6cc,
  skyTop: 0x7fa7cf,
};
