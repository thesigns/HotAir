import * as THREE from 'three';
import { BALLOON, COAST, LANDING, POLDER, PROPANE, SIM, VIEW, WORLD } from './config.js';
import { Flight } from './core/flight.js';
import { Fleet } from './core/fleet.js';
import { Wind } from './core/wind.js';
import { Input } from './core/input.js';
import { loadProgress, recordFlight, recordKey, saveProgress } from './core/progress.js';
import { clamp, dampAngle, formatMeters } from './core/utils.js';
import { Polder, coastFor } from './world/polder.js';
import { PolderView } from './world/polderView.js';
import { Props } from './world/props.js';
import { createSky, paintSky } from './world/sky.js';
import { createBalloon, updateBalloon } from './models/balloon.js';
import { Sound } from './audio/sound.js';
import { Hud, RATING_COLORS } from './ui/hud.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const COUNTRY = 'netherlands';

// ---------- renderer and scene ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true, powerPreference: 'high-performance' });
const maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
let pixelRatio = maxPixelRatio;
renderer.setPixelRatio(pixelRatio);

const sunDir = new THREE.Vector3(...WORLD.sunDir).normalize();
const scene = new THREE.Scene();
const fogColor = new THREE.Color(WORLD.fogColor);
scene.background = fogColor.clone();
scene.fog = new THREE.Fog(fogColor, VIEW.fogNear, VIEW.fogFar);
scene.add(new THREE.HemisphereLight(0xeaf0f6, 0x6f6a52, 1.5));
const sun = new THREE.DirectionalLight(0xffe6c4, 2.1);
sun.position.copy(sunDir);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(60, 1, 1, VIEW.far);
const sky = createSky();
paintSky(sky, WORLD.skyTop, fogColor);
scene.add(sky);
// far beyond the chunks: a plain polder green under the haze
const farGround = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x7aa44c }));
farGround.position.y = -1;
scene.add(farGround);
// and the sea beyond the coast, when there is one
const farSea = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5d8aa3 }));
farSea.position.y = -0.7;
scene.add(farSea);

const balloonModel = createBalloon();
scene.add(balloonModel);
// the other balloons' models, reused from flight to flight
const fleetModels = [];
const props = new Props(scene, sunDir);

// ---------- game systems ----------
const input = new Input($('game'));
const sound = new Sound();
const hud = new Hud($('hud'));
const progress = loadProgress();
const preset = () => PROPANE.presets[progress.preset] ?? PROPANE.presets.standard;
const recKey = () => recordKey(COUNTRY, progress.preset);

const game = {
  mode: 'menu',     // menu | playing | paused | results
  acc: 0,
  endTimer: 0,
  seed: 0,
  fps: 60,
  prev: { x: 0, y: 0, z: 0 },
};
let polder = null, wind = null, flight = null, view = null;
const surfaceWind = {};

// A new random world: the terrain, the winds, the flight.
function newWorld(seed) {
  game.seed = seed;
  if (view) view.dispose();
  wind = new Wind(seed);
  const w = wind.at(150, 0, {});
  polder = new Polder(seed, { coast: coastFor(seed, w.dir + Math.PI) });
  placeSea(polder.coast);
  game.seaSaid = false;
  flight = new Flight(polder, wind, PROPANE.cylinder * preset().cylinders, onFlightEvent);
  flight.fleet = new Fleet(polder, wind, seed, flight.x0, flight.z0);
  flight.fleet.list.forEach((a, i) => {
    if (!fleetModels[i]) { fleetModels[i] = createBalloon(1 + i, false); scene.add(fleetModels[i]); }
  });
  game.menuT = 0;
  view = new PolderView(polder, scene);
  view.update(flight.x0, flight.z0, true, 900);
  props.reset(flight);
  syncPrev();
  resetCamera(true);
}

const randomSeed = () => 1 + Math.floor(Math.random() * 999999);

// The far sea: a big plane from the beach outwards.
function placeSea(c) {
  farSea.visible = !!c;
  if (!c) return;
  const L = 40000, edge = c.n * POLDER.block + c.sign * COAST.beach;
  const mid = edge + c.sign * L / 2;
  farSea.scale.set(c.axis === 0 ? L : L * 2, 1, c.axis === 0 ? L * 2 : L);
  farSea.position.x = c.axis === 0 ? mid : 0;
  farSea.position.z = c.axis === 0 ? 0 : mid;
}

function syncPrev() {
  const b = flight.balloon;
  game.prev.x = b.x; game.prev.y = b.y; game.prev.z = b.z;
}

// ---------- flight events ----------
const radio = (text, color) => {
  sound.radio();
  hud.showNotice(`Crew: ${text}`, color, 4.5);
};

function onFlightEvent(type, d) {
  switch (type) {
    case 'liftoff': radio('Off you go! Watch the pibal and find a good wind.'); break;
    case 'reserve': radio('You\'re on the reserve – time to look for a field.', '#ffc53d'); break;
    case 'empty': radio('The propane\'s gone! Hold BURN for the last vapour, pick a spot.', '#ff6a50'); break;
    case 'touchdown':
      sound.touchdown(d.sink);
      hud.showNotice(`Touchdown ${d.sink.toFixed(1)} m/s – hold VENT`, RATING_COLORS[d.rating], 3);
      break;
    case 'hop': hud.showNotice('A hop – still flying', '#fffcf4', 2); break;
    case 'done':
      hud.showRating(RATING_TITLE[d.rating], `${formatMeters(d.distance)} m × ${LANDING.mult[d.rating]}`, RATING_COLORS[d.rating]);
      sound.rating(d.rating);
      game.endTimer = 3;
      break;
    case 'crash':
      hud.showRating('CRASH', CRASH_SHORT[d.how] ?? '', RATING_COLORS.CRASH);
      sound.crash(d.how);
      $('fade').style.opacity = 0.75;
      game.endTimer = 2.8;
      break;
    default:
  }
}

const RATING_TITLE = { EXCEPTIONAL: 'EXCEPTIONAL!', GOOD: 'GOOD LANDING', ROUGH: 'ROUGH LANDING', CRASH: 'CRASH' };
const CRASH_SHORT = {
  water: 'A wet landing', house: 'You hit a building', power: 'Power line!', glass: 'Through the glass', hard: 'Far too hard', trees: 'Into the trees, too fast', balloon: 'You touched another balloon',
};

// ---------- game flow ----------
function startFlight(seed = randomSeed()) {
  sound.init();   // inside the tap (autoplay policy)
  newWorld(seed);
  game.acc = 0;
  game.endTimer = 0;
  $('fade').style.opacity = 0;
  hud.popup = null;
  hud.notice = null;
  setMode('playing');
  hud.showRating('THE NETHERLANDS', `${preset().name} · ${cylinders(preset().cylinders)}`, '#fffcf4', 2.6);
}

function setMode(mode) {
  game.mode = mode;
  input.enabled = mode === 'playing';
  if (mode !== 'playing') input.release();
  $('menu').classList.toggle('hidden', mode !== 'menu');
  $('pause').classList.toggle('hidden', mode !== 'paused');
  $('results').classList.toggle('hidden', mode !== 'results');
  $('settings').classList.toggle('hidden', mode !== 'settings');
  $('controls').classList.toggle('hidden', mode !== 'playing');
  if (mode === 'paused' || mode === 'menu' || mode === 'settings') sound.suspend();
  if (mode === 'settings') renderSettings();
  if (mode === 'playing') sound.resume();
  if (mode === 'menu') renderMenu();
}

function togglePause() {
  if (game.mode === 'playing') setMode('paused');
  else if (game.mode === 'paused') setMode('playing');
}

const bestText = (rec) => (rec ? `Best ${formatMeters(rec.score)} · ${formatMeters(rec.distance)} m, ${rec.rating.toLowerCase()}` : '');

const cylinders = (n) => `${n} cylinder${n > 1 ? 's' : ''}`;

// The propane presets (GDD §5.3), each with its own record.
function renderMenu() {
  const list = $('presets');
  list.replaceChildren();
  for (const [key, p] of Object.entries(PROPANE.presets)) {
    const btn = document.createElement('button');
    btn.className = `preset${key === progress.preset ? ' on' : ''}`;
    const rec = progress.records[recordKey(COUNTRY, key)];
    const name = document.createElement('b');
    name.textContent = p.name;
    const sub = document.createElement('small');
    sub.textContent = cylinders(p.cylinders);
    const best = document.createElement('small');
    best.textContent = rec ? `best ${formatMeters(rec.score)}` : '–';
    btn.append(name, sub, best);
    btn.addEventListener('click', () => {
      progress.preset = key;
      saveProgress(progress);
      renderMenu();
    });
    list.appendChild(btn);
  }
}

// Settings (GDD §4.3): only things that don't change the score.
let settingsFrom = 'menu';
function openSettings() {
  settingsFrom = game.mode;
  setMode('settings');
}

function renderSettings() {
  for (const el of document.querySelectorAll('#settings .toggle')) {
    const on = progress.settings[el.dataset.key];
    el.classList.toggle('on', on);
    el.querySelector('b').textContent = on ? 'ON' : 'OFF';
  }
}

function applySettings() {
  const s = progress.settings;
  sound.enabled = s.sound;
  input.haptics = s.haptics;
  input.toggleBurn = s.toggleBurn;
  document.body.classList.toggle('left-handed', s.leftHanded);
}

for (const el of document.querySelectorAll('#settings .toggle')) {
  el.addEventListener('click', () => {
    progress.settings[el.dataset.key] = !progress.settings[el.dataset.key];
    saveProgress(progress);
    applySettings();
    renderSettings();
  });
}

const RESULT_TITLE = { EXCEPTIONAL: 'Exceptional!', GOOD: 'Good landing', ROUGH: 'Rough landing', CRASH: 'Crash' };
const MESSAGES = {
  water: () => 'A wet landing. Ditches and canals are everywhere – land on dry ground.',
  house: () => 'You hit a building. Keep clear of them when you come down low.',
  glass: () => 'You came down on a greenhouse. Glass roofs are no place to land.',
  power: () => 'You flew into a power line – the deadliest danger in ballooning. Climb well above the wires, or stay clear of them.',
  balloon: () => 'You touched another balloon. Look above and below before you climb or sink through the height of another one.',
  hard: (r) => `You hit the ground at ${r.sink.toFixed(1)} m/s. Burn before the ground to soften the touchdown.`,
  trees: (r) => (r.rating === 'CRASH' ? 'You came down into the trees too fast.' : 'You came down in the trees.'),
  hedge: () => 'The basket was dragged into the trees. Hold VENT right after the touchdown.',
};

function showResults() {
  setMode('results');
  const r = flight.result;
  const color = { EXCEPTIONAL: '#c99a00', GOOD: '#2f8a3a', ROUGH: '#c0661a', CRASH: '#c8382c' }[r.rating];
  $('res-title').textContent = RESULT_TITLE[r.rating];
  $('res-title').style.color = color;
  $('res-msg').textContent = MESSAGES[r.how]?.(r) ?? `Touchdown at ${r.sink.toFixed(1)} m/s.`;
  $('res-dist').textContent = `${formatMeters(r.distance)} m`;
  $('res-landing').textContent = `${r.rating.toLowerCase()} × ${LANDING.mult[r.rating]}`;
  $('res-landing').style.color = color;
  $('res-score').textContent = formatMeters(r.score);
  const isNew = recordFlight(progress, recKey(), r, game.seed);
  $('res-badge').textContent = isNew ? 'NEW RECORD!' : '';
  const rec = progress.records[recKey()];
  $('res-best').textContent = `${rec && !isNew ? bestText(rec) + ' · ' : ''}seed ${game.seed}`;
}

// ---------- camera (GDD §10) ----------
const cam = { follow: true, yaw: 0, pitch: VIEW.pitch, dist: VIEW.dist };
const target = new THREE.Vector3();

function resetCamera(hard = false) {
  cam.follow = true;
  cam.pitch = VIEW.pitch;
  cam.dist = VIEW.dist;
  if (hard) {
    // behind the balloon, looking downwind
    wind.at(0, 0, surfaceWind);
    cam.yaw = surfaceWind.dir + Math.PI;
  }
}

input.onOrbit = (dx, dy) => {
  cam.follow = false;
  cam.yaw -= dx * VIEW.orbit;
  cam.pitch = clamp(cam.pitch + dy * VIEW.orbit, VIEW.minPitch, VIEW.maxPitch);
};
input.onZoom = (f) => { cam.dist = clamp(cam.dist / f, VIEW.minDist, VIEW.maxDist); };
input.onReset = () => resetCamera();
input.onPause = togglePause;

function updateCamera(pos, dt) {
  const b = flight.balloon;
  target.set(pos.x, pos.y + BALLOON.centre, pos.z);
  // the default view turns to look along the ground track
  const speed = Math.hypot(b.vx, b.vz);
  if (cam.follow && speed > 0.4 && dt > 0) cam.yaw = dampAngle(cam.yaw, Math.atan2(b.vx, -b.vz), VIEW.follow, dt);
  if (game.mode === 'menu') cam.yaw += dt * 0.05;
  const h = cam.dist * Math.cos(cam.pitch);
  camera.position.set(target.x - Math.sin(cam.yaw) * h, target.y + cam.dist * Math.sin(cam.pitch), target.z + Math.cos(cam.yaw) * h);
  const floor = polder.height(camera.position.x, camera.position.z) + 1.5;
  if (camera.position.y < floor) camera.position.y = floor;
  camera.lookAt(target);
  sky.position.copy(camera.position);
  farGround.position.x = camera.position.x;
  farGround.position.z = camera.position.z;
}

// Portrait: the optical centre a little above the middle – the balloon above, the ground ahead below it.
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  const portrait = h > w;
  const center = portrait ? VIEW.centerPortrait : VIEW.centerLandscape;
  const hfov = THREE.MathUtils.degToRad(portrait ? VIEW.hfovPortrait : VIEW.hfovLandscape);
  const fullH = 2 * (1 - center) * h;
  const aspect = w / fullH;
  let vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
  if (!portrait) vfov = clamp(vfov, 0.75, 1.2);
  camera.aspect = aspect;
  camera.fov = THREE.MathUtils.radToDeg(vfov);
  camera.setViewOffset(w, fullH, 0, fullH / 2 - center * h, w, h);
  camera.updateProjectionMatrix();
  hud.resize();
}

// The soundscape (GDD §11): what is on the ground below, fading with height; the crew warns about the sea.
const near = {};
let ambientT = 0;
function ambient(dt) {
  ambientT -= dt;
  if (ambientT > 0 || game.mode !== 'playing') return;
  ambientT = 0.5;
  const b = flight.balloon;
  polder.sounds(b.x, b.z, 700, near);
  sound.ambient({ agl: flight.agl, ...near });
  if (!game.seaSaid && flight.phase === 'air' && near.sea < 450) {
    const s0 = polder.coastS(b.x, b.z), s1 = polder.coastS(b.x + b.vx, b.z + b.vz);
    if (s1 > s0) {
      game.seaSaid = true;
      radio('That\'s the sea ahead! Land before the beach runs out.', '#ffc53d');
    }
  }
}

// The balloon on a collision course, on the screen (CSS px) – or null.
const _m = new THREE.Vector3();
function threatMarker() {
  const th = flight.threat;
  if (!th || game.mode !== 'playing') return null;
  const b = th.a.b;
  _m.set(b.x, b.y + BALLOON.centre, b.z).project(camera);
  const on = _m.z < 1 && Math.abs(_m.x) < 1.1 && Math.abs(_m.y) < 1.1;
  return {
    where: th.where, time: th.time, on,
    x: (_m.x + 1) / 2 * window.innerWidth, y: (1 - _m.y) / 2 * window.innerHeight,
  };
}

// ---------- loop ----------
const STEP = 1 / SIM.hz;
const pos = new THREE.Vector3();
let last = performance.now();
let frameAcc = 0, frameCount = 0, lastAdapt = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - last) / 1000;
  last = now;
  const dt = Math.min(rawDt, 0.1);
  if (!flight) return;
  const b = flight.balloon;

  if (game.mode === 'playing') {
    game.acc += dt;
    while (game.acc >= STEP) {
      syncPrev();
      flight.update(STEP, input.burn, input.vent);
      game.acc -= STEP;
    }
    if (game.endTimer > 0) {
      game.endTimer -= dt;
      if (game.endTimer <= 0) showResults();
    }
    input.tick(b.burning);
  }

  const alpha = game.mode === 'playing' ? game.acc / STEP : 1;
  pos.set(game.prev.x + (b.x - game.prev.x) * alpha, game.prev.y + (b.y - game.prev.y) * alpha, game.prev.z + (b.z - game.prev.z) * alpha);
  balloonModel.position.copy(pos);
  wind.at(0, flight.t, surfaceWind);
  updateBalloon(balloonModel, { burn: b.burning, vapour: b.vapour, deflate: b.deflate, heading: surfaceWind.dir + Math.PI, t: now / 1000 });
  props.update(flight, pos, surfaceWind, now / 1000);
  view.animate(game.mode === 'paused' ? 0 : dt, surfaceWind);
  ambient(dt);
  // the other balloons (they drift on in the menu too)
  if (game.mode === 'menu') {
    game.menuT += dt;
    flight.fleet.update(dt, game.menuT, b, null);
  }
  flight.fleet.list.forEach((a, i) => {
    const m = fleetModels[i];
    m.position.set(a.b.x, a.b.y, a.b.z);
    updateBalloon(m, { burn: a.b.burning, vapour: false, deflate: a.b.deflate, heading: surfaceWind.dir + Math.PI, t: now / 1000 + i });
  });
  updateCamera(pos, game.mode === 'paused' ? 0 : dt);
  view.update(pos.x, pos.z);
  sound.update({
    burn: b.burning, vapour: b.vapour, vent: b.venting, agl: flight.agl, playing: game.mode === 'playing',
    drag: b.onGround && flight.phase === 'ground' ? Math.hypot(b.vx, b.vz) : 0, camDist: cam.dist,
  });

  renderer.render(scene, camera);
  hud.draw(dt, { playing: game.mode === 'playing', flight, debug, fps: game.fps, seed: game.seed, threat: threatMarker() });

  // adaptive resolution: lower the pixel ratio on a weak GPU
  frameAcc += rawDt;
  frameCount++;
  if (frameCount >= 90) {
    const avg = frameAcc / frameCount;
    game.fps = 1 / avg;
    if (avg > 0.024 && pixelRatio > 0.75 && now - lastAdapt > 3000 && game.mode === 'playing') {
      pixelRatio = Math.max(0.75, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
      resize();
      lastAdapt = now;
    }
    frameAcc = 0;
    frameCount = 0;
  }
}

// ---------- UI ----------
const fixedSeed = () => (params.has('seed') ? Number(params.get('seed')) || 1 : randomSeed());
$('fly-btn').addEventListener('click', () => startFlight(fixedSeed()));
$('again-btn').addEventListener('click', () => startFlight(fixedSeed()));
$('restart-btn').addEventListener('click', () => startFlight(fixedSeed()));
$('resume-btn').addEventListener('click', () => setMode('playing'));
for (const id of ['menu-btn', 'pause-menu-btn']) $(id).addEventListener('click', () => setMode('menu'));
for (const id of ['settings-btn', 'pause-settings-btn']) $(id).addEventListener('click', openSettings);
$('settings-done-btn').addEventListener('click', () => setMode(settingsFrom));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.mode === 'playing') setMode('paused');
});
// a phone turned sideways shows the "turn your phone" card (css: #rotate); the flight waits paused
const SIDEWAYS = window.matchMedia('(orientation: landscape) and (pointer: coarse) and (max-height: 500px)');
SIDEWAYS.addEventListener('change', () => {
  if (SIDEWAYS.matches && game.mode === 'playing') setMode('paused');
});
window.addEventListener('resize', resize);

if (debug) {
  window.hotair = {
    game, input, sound, camera, cam, progress, startFlight,
    get flight() { return flight; },
    get balloon() { return flight.balloon; },
    get polder() { return polder; },
    get wind() { return wind; },
    get view() { return view; },
  };
}

applySettings();
// the menu shows a balloon waiting on a launch field
newWorld(fixedSeed());
resize();
setMode('menu');
const fontsLoaded = document.fonts ? Promise.all([700, 900].map((w) => document.fonts.load(`${w} 20px "Grandstander"`))) : null;
Promise.race([fontsLoaded, new Promise((r) => setTimeout(r, 1500))])
  .catch(() => {})
  .finally(() => $('loading').classList.add('hidden'));
requestAnimationFrame((t) => { last = t; frame(t); });
