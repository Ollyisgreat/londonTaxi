import * as THREE from 'three';
import { B, HALF_ROAD, NX, NZ, RIVER_ROW, RIVER_Z0, RIVER_Z1, BRIDGES, LANDMARK_CELLS, nodeId, hasEdgeV, postcode } from './config.js';
import { City } from './city.js';
import { Taxi, EYE } from './taxi.js';
import { Traffic } from './traffic.js';
import { Crowd, Person, seatedPerson, makePassenger } from './people.js';
import { Meter, tariffFor, TARIFFS } from './meter.js';
import { Payment, startingFloat, floatTotal } from './payment.js';
import { Sound } from './audio.js';
import { makeSkyEnv } from './textures.js';
import { setVehicleNight } from './vehicles.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { clamp, lerp, smooth, pick, fmtMoney, rand, angleWrap } from './util.js';

const $ = (id) => document.getElementById(id);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIME_RATE = 30; // game seconds per real second
const SHIFT_HOURS = 10;

// ------------------------------------------------------------------ renderer
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 2200);
scene.fog = new THREE.Fog('#b8c4cc', 120, 650);

const hemi = new THREE.HemisphereLight('#dfe8f0', '#4a443c', 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1dc', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 10; sc.far = 400;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

const envOvercast = makeSkyEnv(renderer, '#8d979f', '#b4bcc2', '#4a4740');
const envNight = makeSkyEnv(renderer, '#0b0e18', '#2a2630', '#0a0a0a');
scene.environment = envOvercast;

// physically based sky (atmospheric scattering) that follows the camera
const sky = new Sky();
sky.scale.setScalar(1800);
scene.add(sky);
const skyU = sky.material.uniforms;
skyU.turbidity.value = 8;
skyU.rayleigh.value = 1.6;
skyU.mieCoefficient.value = 0.006;
skyU.mieDirectionalG.value = 0.82;
// a second sky used only to build the reflection environment
const envScene = new THREE.Scene();
const envSky = new Sky();
envSky.scale.setScalar(100);
envScene.add(envSky);
const pmrem = new THREE.PMREMGenerator(renderer);
let envSkyRT = null, lastEnvKey = '';
function refreshSkyEnv(sunDir) {
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) envSky.material.uniforms[k].value = skyU[k].value;
  envSky.material.uniforms.sunPosition.value.copy(sunDir);
  const rt = pmrem.fromScene(envScene, 0.02);
  if (envSkyRT) envSkyRT.dispose();
  envSkyRT = rt;
}
// stars for clear nights
const starGeo = new THREE.BufferGeometry();
{
  const a = [];
  for (let i = 0; i < 1800; i++) {
    const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, y = Math.abs(u) * 0.9 + 0.05;
    const r = Math.sqrt(1 - y * y);
    a.push(Math.cos(t) * r * 1500, y * 1500, Math.sin(t) * r * 1500);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
}
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
stars.frustumCulled = false;
scene.add(stars);

// ------------------------------------------------------------------ quality / post-processing
let Q = 'high';
let composer = null, bloomPass = null, gtaoPass = null, gradePass = null;
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.32 }, time: { value: 0 }, grain: { value: 0.025 }, sat: { value: 1.06 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vignette; uniform float time; uniform float grain; uniform float sat; varying vec2 vUv;
    float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233)) + time) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
      c.rgb = mix(vec3(l), c.rgb, sat);
      c.rgb = (c.rgb - 0.5) * 1.04 + 0.5;
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - vignette * dot(d, d) * 2.2;
      c.rgb += (rnd(vUv) - 0.5) * grain;
      gl_FragColor = c;
    }`,
};
function setupQuality(q) {
  Q = q;
  const dpr = window.devicePixelRatio || 1;
  const pr = { low: Math.min(dpr, 1), medium: Math.min(dpr, 1.25), high: Math.min(dpr, 1.5), ultra: Math.min(dpr, 2) }[q];
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  const shadowSize = { low: 0, medium: 2048, high: 2048, ultra: 4096 }[q];
  renderer.shadowMap.enabled = shadowSize > 0;
  sun.castShadow = shadowSize > 0;
  if (shadowSize && sun.shadow.mapSize.x !== shadowSize) {
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  const ext = q === 'ultra' ? 90 : 70;
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.updateProjectionMatrix();
  scene.traverse((o) => { if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true; });
  if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); composer = null; }
  if (q === 'low') return;
  const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: q === 'medium' ? 0 : 4 });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  gtaoPass = null;
  if (q === 'ultra') {
    gtaoPass = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
    gtaoPass.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2, scale: 1.2, samples: 12 });
    gtaoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    gtaoPass.blendIntensity = 0.85;
    composer.addPass(gtaoPass);
  }
  bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.55, 0.9);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  gradePass = new ShaderPass(GradeShader);
  composer.addPass(gradePass);
}

// ------------------------------------------------------------------ world
const city = new City(scene);
const taxi = new Taxi(scene);
const traffic = new Traffic(scene, city, 46);
const crowd = new Crowd(scene, 70);
const meter = new Meter();
const sound = new Sound();
const payment = new Payment($('payment'), sound);
meter.onTick = () => sound.meterTick();
traffic.honk = () => {};

// speed cameras & chargers
const speedCams = [];
const chargers = [];
{
  const camMat = new THREE.MeshStandardMaterial({ color: '#f2c500', roughness: 0.5 });
  const poleMat = new THREE.MeshStandardMaterial({ color: '#555' });
  const camSpots = [[2, 1, 'N'], [7, 3, 'S'], [9, 9, 'N'], [4, 8, 'E'], [11, 2, 'W'], [1, 5, 'S'], [6, 4, 'W'], [10, 7, 'N']];
  for (const [bi, bj, side] of camSpots) {
    const sp = city.kerbSpot(bi, bj, side, 0.35);
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 8), poleMat);
    pole.position.y = 1.6;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.6), camMat);
    box.position.y = 3.3;
    g.add(pole, box);
    g.position.set(sp.x + sp.fx * 0.8, 0, sp.z + sp.fz * 0.8);
    scene.add(g);
    speedCams.push({ x: sp.x, z: sp.z, cool: 0 });
  }
  const chMat = new THREE.MeshStandardMaterial({ color: '#1f8a4a', roughness: 0.4 });
  const chScr = new THREE.MeshBasicMaterial({ color: '#7dffb0' });
  for (const [bi, bj, side] of [[3, 2, 'S'], [8, 1, 'E'], [5, 9, 'N'], [11, 3, 'S'], [1, 7, 'E']]) {
    const sp = city.kerbSpot(bi, bj, side, 0.3);
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.6, 0.3), chMat);
    post.position.y = 0.95;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), chScr);
    scr.position.set(0, 1.4, 0.16);
    g.add(post, scr);
    g.position.set(sp.x - sp.fx * 0.2, 0, sp.z - sp.fz * 0.2);
    g.rotation.y = Math.atan2(-sp.fx, -sp.fz);
    scene.add(g);
    chargers.push(sp);
  }
}

// rain
const RAIN_N = 1400;
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(RAIN_N * 6);
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#aebccc', transparent: true, opacity: 0.45 }));
rain.frustumCulled = false;
rain.visible = false;
scene.add(rain);
for (let i = 0; i < RAIN_N; i++) { rainPos[i * 6] = rand(-30, 30); rainPos[i * 6 + 1] = rand(0, 25); rainPos[i * 6 + 2] = rand(-30, 30); }

// destination beacon
const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 60, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#46c8ff', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
beacon.visible = false;
scene.add(beacon);
const hailMarkerGeo = new THREE.ConeGeometry(0.35, 0.7, 4);
hailMarkerGeo.rotateX(Math.PI);
const hailMarkerMat = new THREE.MeshBasicMaterial({ color: '#ffd23a' });

// ------------------------------------------------------------------ state
const G = {
  mode: 'title',
  day: 0,
  minutes: 7 * 60,
  shiftStart: 7 * 60,
  shiftEnded: false,
  knowledge: false,
  markers: true,
  low: false,
  cam: 'cockpit',
  lookYaw: 0,
  lookPitch: 0,
  takingsCard: 0,
  tips: 0,
  fines: 0,
  fuel: 0,
  fares: 0,
  ratings: [],
  float: startingFloat(),
  floatStart: 0,
  hailers: [],
  fare: null,
  raining: false,
  rainTimer: 60,
  battery: 0.92,
  inJunction: false,
  hailSpawnT: 0,
  prompt: '',
  routeT: 0,
  route: null,
  speechT: 0,
  replyFn: null,
  log: [],
};
G.floatStart = floatTotal(G.float);

// ------------------------------------------------------------------ input
const keys = new Set();
const input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const touch = { left: false, right: false, gas: false, brake: false, hand: false, charge: false };
let steerSmooth = 0;
window.addEventListener('keydown', (e) => {
  if (payment.active) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (['Tab', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1'].includes(e.key)) e.preventDefault();
  if (e.repeat && keys.has(k)) return;
  keys.add(k);
  onKeyPress(k);
});
window.addEventListener('keyup', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys.delete(k);
  if (k === 'h') sound.stopHorn();
});
window.addEventListener('blur', () => { keys.clear(); sound.stopHorn(); });

let dragging = false, lastMX = 0, lastMY = 0;
canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; dragging = true; lastMX = e.clientX; lastMY = e.clientY; });
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  G.lookYaw = clamp(G.lookYaw - (e.clientX - lastMX) * 0.005, -2.6, 2.6);
  G.lookPitch = clamp(G.lookPitch - (e.clientY - lastMY) * 0.004, -0.7, 0.5);
  lastMX = e.clientX;
  lastMY = e.clientY;
});

function onKeyPress(k) {
  sound.init();
  if (G.mode === 'title') return;
  if (k === 'F1' || k === '?') { toggleHelp(); return; }
  if (k === 'Escape' || k === 'p') {
    if (!$('help').classList.contains('hidden')) { toggleHelp(); return; }
    if (!$('bigmap').classList.contains('hidden')) { $('bigmap').classList.add('hidden'); return; }
    if (G.mode === 'driving') pause(true);
    else if (G.mode === 'paused') pause(false);
    return;
  }
  if (G.mode !== 'driving') return;
  switch (k) {
    case 'Tab': case 'g': toggleMap(); break;
    case 'c': G.cam = G.cam === 'cockpit' ? 'chase' : 'cockpit'; taxi.setCockpit(G.cam === 'cockpit'); break;
    case 'l': toggleLocks(); break;
    case 'm': meterKey(); break;
    case 'q': taxi.indicator = taxi.indicator === -1 ? 0 : -1; sound.click(); break;
    case 'e': taxi.indicator = taxi.indicator === 1 ? 0 : 1; sound.click(); break;
    case 'z': taxi.hazards = !taxi.hazards; sound.click(); break;
    case 'n': taxi.headlights = !taxi.headlights; sound.click(); toast(taxi.headlights ? 'Headlights on' : 'Headlights off'); break;
    case 'v': taxi.wipers = taxi.wipers ? 0 : 1; sound.click(); toast(taxi.wipers ? 'Wipers on' : 'Wipers off'); break;
    case 'h': sound.startHorn(); if (G.fare && G.fare.stage === 'onboard') moodHit(-1, null); break;
    case 'r': recoverTaxi(); break;
    case '1': case '2': if (G.replyFn) G.replyFn(+k - 1); break;
  }
}

function readInput(dt) {
  const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g) : null;
  let steerT = 0;
  if (keys.has('a') || keys.has('ArrowLeft') || touch.left) steerT += 1;
  if (keys.has('d') || keys.has('ArrowRight') || touch.right) steerT -= 1;
  steerSmooth = smooth(steerSmooth, steerT, steerT === 0 ? 7 : 4, dt);
  input.steer = steerSmooth;
  if (touchSteer !== 0) input.steer = touchSteer;
  input.throttle = keys.has('w') || keys.has('ArrowUp') || touch.gas ? 1 : 0;
  input.brake = keys.has('s') || keys.has('ArrowDown') || touch.brake ? 1 : 0;
  input.handbrake = keys.has(' ') || touch.hand;
  if (gp) {
    const ax = gp.axes[0] || 0;
    if (Math.abs(ax) > 0.12) input.steer = -ax;
    const rt = gp.buttons[7] ? gp.buttons[7].value : 0, lt = gp.buttons[6] ? gp.buttons[6].value : 0;
    if (rt > 0.05) input.throttle = rt;
    if (lt > 0.05) input.brake = lt;
    if (gp.buttons[0] && gp.buttons[0].pressed) input.handbrake = true;
  }
  if (payment.active || (G.fare && G.fare.stage === 'paying')) { input.throttle = 0; input.brake = 0; input.handbrake = true; }
}

// touch controls: drag-to-steer wheel, pedals, smart action button and a cab menu
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let touchSteer = 0;
if (isTouch) {
  document.body.classList.add('is-touch');
  // steering wheel: drag horizontally (or rotate around the centre)
  const pad = $('steer-pad'), wheelEl = pad.querySelector('.sw');
  let steerId = null, startX = 0;
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sound.init();
    steerId = e.pointerId;
    startX = e.clientX;
    pad.setPointerCapture(e.pointerId);
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== steerId) return;
    touchSteer = clamp(-(e.clientX - startX) / 70, -1, 1);
  });
  const release = (e) => { if (e.pointerId === steerId) { steerId = null; touchSteer = 0; } };
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);
  // keep the on-screen wheel in sync with the cab's actual steering
  setInterval(() => { wheelEl.style.transform = `rotate(${-taxi.steer * 160}deg)`; }, 33);
  // pedals
  $('touch').querySelectorAll('.t-right button').forEach((b) => {
    const t = b.dataset.t;
    const down = (e) => { e.preventDefault(); sound.init(); touch[t] = true; b.classList.add('down'); b.setPointerCapture(e.pointerId); };
    const up = (e) => { e.preventDefault(); touch[t] = false; b.classList.remove('down'); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  });
  // smart contextual action
  const sb = $('smart-btn');
  sb.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sound.init();
    const a = G.action;
    if (!a) return;
    sb.classList.add('down');
    if (a.hold) touch.charge = true;
    else onKeyPress(a.key);
  });
  const sbUp = () => { sb.classList.remove('down'); touch.charge = false; };
  sb.addEventListener('pointerup', sbUp);
  sb.addEventListener('pointercancel', sbUp);
  // cab menu
  const menu = $('cab-menu');
  const openMenu = (on) => {
    menu.classList.toggle('hidden', !on);
    if (on) {
      $('cm-doors').textContent = taxi.doorsLocked ? 'Unlock doors' : 'Lock doors';
      $('cm-meter').textContent = meter.state === 'vacant' ? 'Start meter' : 'Stop meter';
      const st = { q: taxi.indicator === -1, e: taxi.indicator === 1, z: taxi.hazards, n: taxi.headlights, v: !!taxi.wipers, look: G.lookBack };
      menu.querySelectorAll('.cm-grid button').forEach((b) => b.classList.toggle('on', !!st[b.dataset.k]));
    }
  };
  $('menu-btn').addEventListener('click', () => { sound.init(); openMenu(true); });
  menu.querySelector('.cm-close').addEventListener('click', () => openMenu(false));
  menu.addEventListener('click', (e) => { if (e.target === menu) openMenu(false); });
  menu.querySelectorAll('.cm-grid button').forEach((b) => {
    const k = b.dataset.k;
    if (b.dataset.hold) {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); sound.startHorn(); });
      const stop = () => sound.stopHorn();
      b.addEventListener('pointerup', stop);
      b.addEventListener('pointercancel', stop);
      b.addEventListener('pointerleave', stop);
      return;
    }
    b.addEventListener('click', () => {
      openMenu(false);
      if (k === 'look') { G.lookBack = !G.lookBack; return; }
      onKeyPress(k);
    });
  });
}
$('bigmap-close').addEventListener('click', () => $('bigmap').classList.add('hidden'));

// ------------------------------------------------------------------ UI helpers
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 3800);
  setTimeout(() => el.remove(), 4500);
  while ($('toasts').children.length > 5) $('toasts').firstChild.remove();
}

function say(text, who = 'pax', name) {
  const el = $('speech');
  el.classList.remove('hidden');
  el.classList.toggle('you', who === 'you');
  const n = who === 'you' ? 'You' : name || (G.fare ? G.fare.pax.name : 'Passenger');
  el.innerHTML = `<b>${n}:</b> ${text}`;
  G.speechT = 4.5 + text.length * 0.04;
}

function ask(question, replies, cb) {
  say(question);
  const box = $('replies');
  box.innerHTML = '';
  replies.forEach((r, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<kbd>${i + 1}</kbd> ${r}`;
    b.addEventListener('click', () => G.replyFn && G.replyFn(i));
    box.appendChild(b);
  });
  box.classList.remove('hidden');
  G.replyT = 9;
  G.replyFn = (i) => {
    G.replyFn = null;
    box.classList.add('hidden');
    say(replies[i], 'you');
    cb(i);
  };
}

function flash() {
  const f = $('flash');
  f.classList.add('on');
  setTimeout(() => f.classList.remove('on'), 80);
}

function toggleHelp() { $('help').classList.toggle('hidden'); }
function toggleMap() { const m = $('bigmap'); m.classList.toggle('hidden'); if (!m.classList.contains('hidden')) drawBigMap(); }
$('help-btn').addEventListener('click', toggleHelp);
$('help-close').addEventListener('click', toggleHelp);

function pause(on) {
  G.mode = on ? 'paused' : 'driving';
  $('pause').classList.toggle('hidden', !on);
}
$('resume-btn').addEventListener('click', () => pause(false));
$('pause-help').addEventListener('click', toggleHelp);
$('opt-mute').addEventListener('change', (e) => sound.setMuted(e.target.checked));
$('opt-markers2').addEventListener('change', (e) => (G.markers = e.target.checked));
$('end-shift-btn').addEventListener('click', () => { pause(false); endShift(); });

// ------------------------------------------------------------------ clock / env
function clockStr() {
  const m = Math.floor(G.minutes) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function hour() { return (G.minutes % 1440) / 60; }

const cDay = new THREE.Color('#b8c6d0'), cDusk = new THREE.Color('#c99a7a'), cNight = new THREE.Color('#0a0f1c'), cRain = new THREE.Color('#8e979e');
const tmpC = new THREE.Color();
let nightLevel = 0;
const cHaze = new THREE.Color('#c4ccd2'), cDuskFog = new THREE.Color('#d6a07c'), cNightFog = new THREE.Color('#1d1c26'), cRainFog = new THREE.Color('#8a9298');
const sunDir = new THREE.Vector3();
const moonCol = new THREE.Color('#9fb3d9'), sunCol = new THREE.Color('#fff2e0'), duskCol = new THREE.Color('#ffae6a');
function updateEnvironment(dt) {
  const h = hour();
  const sunElev = h > 5.8 && h < 19.5 ? Math.sin((Math.PI * (h - 5.8)) / 13.7) : -0.25;
  const day = clamp((sunElev + 0.06) / 0.3, 0, 1);
  const n = 1 - day;
  nightLevel = n;
  const dusk = clamp(1 - Math.abs(sunElev - 0.06) / 0.18, 0, 1);
  const az = ((h - 5.8) / 13.7) * Math.PI;
  const el = sunElev * 0.75;
  sunDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * 0.6 * Math.cos(el)).normalize();
  // sky
  const overcast = G.raining;
  sky.visible = !overcast;
  sky.position.copy(camera.position);
  skyU.sunPosition.value.copy(sunDir);
  stars.position.copy(camera.position);
  stars.material.opacity = overcast ? 0 : clamp((n - 0.6) / 0.4, 0, 1) * 0.8;
  // fog / haze
  tmpC.copy(cNightFog).lerp(cHaze, day).lerp(cDuskFog, dusk * 0.55 * day);
  if (overcast) tmpC.lerp(cRainFog, 0.7 * day + 0.1).multiplyScalar(0.92);
  scene.fog.color.copy(tmpC);
  scene.background = overcast ? tmpC.clone() : null;
  scene.fog.far = overcast ? 340 : lerp(420, 760, day);
  scene.fog.near = overcast ? 30 : 70;
  // lights: sun by day, moon (cool, dim) by night
  hemi.intensity = lerp(0.18, 0.9, day) * (overcast ? 1.05 : 1);
  hemi.color.set(day > 0.5 ? '#dbe6f2' : '#6f7ea3');
  hemi.groundColor.set(day > 0.5 ? '#5a5248' : '#2a2422');
  if (day > 0.02) {
    sun.intensity = lerp(0.0, 3.2, day) * (overcast ? 0.28 : 1);
    sun.color.copy(sunCol).lerp(duskCol, dusk);
    sun.position.set(taxi.x + sunDir.x * 160, Math.max(0.12, sunDir.y) * 160, taxi.z + sunDir.z * 160);
  } else {
    sun.intensity = overcast ? 0.05 : 0.28;
    sun.color.copy(moonCol);
    sun.position.set(taxi.x - 60, 130, taxi.z + 70);
  }
  sun.target.position.set(taxi.x + taxi.fwdX * 25, 0, taxi.z + taxi.fwdZ * 25);
  // reflections
  if (overcast) scene.environment = day > 0.4 ? envOvercast : envNight;
  else if (n > 0.75) scene.environment = envNight;
  else {
    const key = (Math.round(sunDir.y * 40) / 40).toFixed(3);
    if (key !== lastEnvKey) { lastEnvKey = key; refreshSkyEnv(sunDir); }
    scene.environment = envSkyRT.texture;
  }
  scene.environmentIntensity = scene.environment === envSkyRT?.texture ? 0.32 : 0.9;
  renderer.toneMappingExposure = lerp(1.3, 0.62, day) * (overcast ? 1.15 : 1);
  city.setNight(n);
  setVehicleNight(n);
  if (bloomPass) {
    bloomPass.strength = lerp(0.12, 0.75, n);
    bloomPass.threshold = lerp(0.95, 0.75, n);
  }
  taxi.headLight.intensity = taxi.headlights ? 80 : 0;
  taxi.cabinLight.intensity = G.fare && G.fare.stage === 'paying' && n > 0.4 ? 1.2 : 0;
  // wet road: glossier and darker
  city.mat.road.roughness = smooth(city.mat.road.roughness, overcast ? 0.22 : 1, 0.4, dt);
  city.mat.road.color.setScalar(overcast ? 0.62 : 1);
  city.mat.pave.roughness = overcast ? 0.45 : 0.85;
}

function updateWeather(dt) {
  G.rainTimer -= dt;
  if (G.rainTimer <= 0) {
    G.raining = !G.raining;
    G.rainTimer = G.raining ? rand(70, 160) : rand(120, 260);
    toast(G.raining ? '🌧️ It\'s started raining. Wipers: <kbd>V</kbd>' : '⛅ The rain has stopped.');
  }
  rain.visible = G.raining;
  if (G.raining) {
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    for (let i = 0; i < RAIN_N; i++) {
      const o = i * 6;
      rainPos[o + 1] -= 22 * dt;
      if (rainPos[o + 1] < 0 || Math.abs(rainPos[o] - cx) > 30 || Math.abs(rainPos[o + 2] - cz) > 30) {
        rainPos[o] = cx + rand(-30, 30);
        rainPos[o + 1] = cy + rand(2, 24);
        rainPos[o + 2] = cz + rand(-30, 30);
      }
      rainPos[o + 3] = rainPos[o] + 0.05;
      rainPos[o + 4] = rainPos[o + 1] + 0.7;
      rainPos[o + 5] = rainPos[o + 2];
    }
    rainGeo.attributes.position.needsUpdate = true;
  }
  taxi.updateRain(dt, G.raining && G.cam === 'cockpit', taxi.speed);
}

// ------------------------------------------------------------------ fares
function forHire() { return !G.fare && meter.state === 'vacant' && !G.shiftEnded; }

function spawnHailer() {
  if (G.hailers.length >= 4) return;
  for (let tries = 0; tries < 30; tries++) {
    const sp = city.randomAddress();
    if (!sp) continue;
    const d = Math.hypot(sp.x - taxi.x, sp.z - taxi.z);
    if (d < 80 || d > 380) continue;
    if (G.hailers.some((h) => Math.hypot(h.spot.x - sp.x, h.spot.z - sp.z) < 60)) continue;
    addHailer(sp);
    return;
  }
}

function addHailer(sp) {
  const pax = makePassenger(nightLevel > 0.5);
  const person = new Person(pax.look);
  person.group.position.set(sp.x, 0.15, sp.z);
  person.face(sp.fx, sp.fz);
  scene.add(person.group);
  const marker = new THREE.Mesh(hailMarkerGeo, hailMarkerMat);
  marker.position.y = 2.6;
  person.group.add(marker);
  G.hailers.push({ spot: sp, pax, person, marker, age: 0 });
}

function removeHailer(h) {
  scene.remove(h.person.group);
  G.hailers = G.hailers.filter((x) => x !== h);
}

function chooseDestination(fromX, fromZ) {
  for (let t = 0; t < 40; t++) {
    let d;
    if (Math.random() < 0.55) {
      const p = pick(city.places);
      d = { ...p };
    } else d = city.randomAddress();
    const dist = Math.hypot(d.x - fromX, d.z - fromZ);
    if (dist > 260 && dist < 1100) return d;
  }
  return pick(city.places);
}

function kerbSideOf(x, z) {
  // +1 if point is to the right of the taxi, -1 if left
  const rx = -taxi.fwdZ, rz = taxi.fwdX;
  return (x - taxi.x) * rx + (z - taxi.z) * rz > 0 ? 1 : -1;
}

function doorPoint(side) {
  const rx = -taxi.fwdZ, rz = taxi.fwdX;
  return [taxi.x + rx * side * 1.5 + taxi.fwdX * -0.6, taxi.z + rz * side * 1.5 + taxi.fwdZ * -0.6];
}

function toggleLocks() {
  taxi.doorsLocked = !taxi.doorsLocked;
  sound.lock();
  if (!taxi.doorsLocked && Math.abs(taxi.speed) > 1.5) {
    taxi.doorsLocked = true;
    toast('Doors stay locked while moving (TfL rules!)', 'bad');
    return;
  }
  toast(taxi.doorsLocked ? '🔒 Doors locked' : '🔓 Doors unlocked');
  const F = G.fare;
  if (!taxi.doorsLocked && F && F.stage === 'leaving') passengerExit();
}

function meterKey() {
  const F = G.fare;
  if (meter.state === 'vacant') {
    if (!F || F.stage !== 'onboard') { toast('No passenger — the meter stays on FOR HIRE.'); sound.tone(400, 0.1, 'square', 0.05); return; }
    if (Math.hypot(F.dest.x - taxi.x, F.dest.z - taxi.z) < 22 && F.moved > 60) {
      if (Math.abs(taxi.speed) > 0.8) { toast('Stop the cab first.'); return; }
      startPayment();
      return;
    }
    meter.start(tariffFor(G.day, hour()));
    sound.meterStart();
    F.meterOn = true;
    toast(`Meter running — ${TARIFFS[meter.tariff].label}`, 'good');
    return;
  }
  if (meter.state === 'hired') {
    if (!F) { meter.clear(); return; }
    const d = Math.hypot(F.dest.x - taxi.x, F.dest.z - taxi.z);
    if (d > 22 && !F.bail) { toast(`You're not at ${F.dest.name} yet (${Math.round(d)} m)`, 'bad'); sound.tone(400, 0.1, 'square', 0.05); return; }
    if (Math.abs(taxi.speed) > 0.8) { toast('Stop the cab first.'); return; }
    meter.stop();
    sound.meterStart();
    startPayment();
  }
}

function pickUp(h) {
  const side = kerbSideOf(h.spot.x, h.spot.z);
  G.fare = { pax: h.pax, person: h.person, stage: 'walking', side, startX: taxi.x, startZ: taxi.z, walkT: 0, moved: 0, meterOn: false };
  h.person.group.remove(h.marker);
  h.person.setHail(false);
  G.hailers = G.hailers.filter((x) => x !== h);
  say(pick(h.pax.def.hello), 'pax', h.pax.name);
}

function boardPassenger() {
  const F = G.fare;
  scene.remove(F.person.group);
  F.seat = seatedPerson(F.pax.look);
  taxi.paxAnchor.add(F.seat);
  sound.door();
  F.dest = chooseDestination(taxi.x, taxi.z);
  F.stage = 'onboard';
  F.t = 0;
  F.chatT = rand(14, 24);
  F.chatsLeft = 2;
  F.cool = {};
  const r = city.route(taxi.x, taxi.z, taxi.fwdX, taxi.fwdZ, F.dest);
  F.expected = (r ? r.len : 600) / 6 + 35; // seconds: allows for lights and traffic
  G.route = r;
  setTimeout(() => {
    if (G.fare !== F) return;
    const line = F.dest.say ? pick(F.dest.say) : pick([`${F.dest.name}, please.`, `Could you take me to ${F.dest.name}?`, `${F.dest.name} — do you know it?`]);
    say(line + (F.pax.hurry ? " I'm in a bit of a rush." : ''));
    toast(`📍 ${F.dest.name} <span class="muted">${postcode(F.dest.x, F.dest.z)}</span> — press <kbd>M</kbd> to start the meter`);
  }, 1300);
}

function moodHit(delta, line, key, cool = 6) {
  const F = G.fare;
  if (!F || F.stage !== 'onboard') return;
  if (key) {
    if ((F.cool[key] || 0) > 0) return;
    F.cool[key] = cool;
  }
  F.pax.mood = clamp(F.pax.mood + delta, 0, 100);
  if (line) say(line);
}

function startPayment() {
  const F = G.fare;
  F.stage = 'paying';
  taxi.doorsLocked = true;
  if (!F.meterOn) {
    say(pick(["Meter wasn't on — cheers for the free ride!", "You never started the meter, mate. Ta-ra!"]));
    toast('You forgot to start the meter — no fare!', 'bad');
    finishFare({ received: 0, tip: 0, charged: 0, moodDelta: -10, notes: [], method: 'none' });
    return;
  }
  setTimeout(() => {
    if (G.fare !== F) return;
    G.lookTarget = 1;
    payment.open({
      fare: meter.total,
      tariff: meter.tariff,
      pax: F.pax,
      float: G.float,
      when: `${DAYS[G.day]} ${clockStr()}`,
      onSay: () => {},
      onTerminal: (lines) => taxi.drawTerminal(lines),
      onDone: (r) => finishFare(r),
    });
  }, 700);
}

function finishFare(r) {
  const F = G.fare;
  G.lookTarget = 0;
  F.pax.mood = clamp(F.pax.mood + (r.moodDelta || 0), 0, 100);
  const m = F.pax.mood;
  const stars = m >= 85 ? 5 : m >= 70 ? 4 : m >= 55 ? 3 : m >= 35 ? 2 : 1;
  if (r.method !== 'none') {
    G.ratings.push(stars);
    G.fares++;
  }
  let bonus = 0;
  if (G.knowledge && r.method !== 'none' && r.tip > 0) bonus = Math.round(r.tip * 0.25);
  if (r.method === 'card') G.takingsCard += r.received;
  G.tips += r.tip + bonus;
  if (bonus) G.takingsCard += bonus;
  const net = r.received + bonus;
  if (r.method !== 'none') {
    toast(`<b>${fmtMoney(net)}</b> ${r.method === 'card' ? '💳' : '💷'} — fare ${fmtMoney(r.charged)}${r.tip ? ` + tip ${fmtMoney(r.tip)}` : ''}${bonus ? ` + Knowledge bonus ${fmtMoney(bonus)}` : ''} &nbsp; ${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}`, 'good');
    for (const n of r.notes || []) toast(n, 'bad');
  }
  G.log.push({ name: F.pax.name, dest: F.dest.name, amount: net, stars });
  F.stage = 'leaving';
  meter.clear();
  setTimeout(() => {
    if (G.fare === F && F.stage === 'leaving') say(pick(['Can you unlock the door?', 'Er, door\'s locked, mate.', 'Thanks — could you let me out?']));
  }, 1600);
}

function passengerExit() {
  const F = G.fare;
  taxi.paxAnchor.remove(F.seat);
  sound.door();
  const side = kerbSideOf(F.dest.x, F.dest.z);
  const [dx, dz] = doorPoint(side);
  const p = new Person(F.pax.look);
  p.group.position.set(dx, 0.15, dz);
  scene.add(p.group);
  const walkTo = [F.dest.x + (F.dest.fx || 0) * -3, F.dest.z + (F.dest.fz || 0) * -3];
  G.leavers = G.leavers || [];
  G.leavers.push({ p, to: walkTo, t: 0 });
  G.fare = null;
  G.route = null;
  say(pick(['Cheers, drive!', 'Thanks, have a good one!', 'Ta-ra!', 'Lovely, thank you!']), 'pax', F.pax.name);
}

function updateFares(dt) {
  const F = G.fare;
  const spd = Math.abs(taxi.speed);
  let prompt = '';

  // spawn hailers
  G.hailSpawnT -= dt;
  if (G.hailSpawnT <= 0 && forHire()) { spawnHailer(); G.hailSpawnT = rand(4, 10); }
  for (const h of [...G.hailers]) {
    h.age += dt;
    const d = Math.hypot(h.spot.x - taxi.x, h.spot.z - taxi.z);
    if ((h.age > 200 && d > 120) || d > 520) { removeHailer(h); continue; }
    const hail = forHire() && d < 90;
    h.person.setHail(hail);
    if (hail) {
      const tx = taxi.x - h.spot.x, tz = taxi.z - h.spot.z, l = Math.hypot(tx, tz) || 1;
      h.person.face(lerp(h.spot.fx, tx / l, 0.5), lerp(h.spot.fz, tz / l, 0.5));
    } else h.person.face(h.spot.fx, h.spot.fz);
    h.marker.visible = G.markers && forHire();
    h.marker.rotation.y += dt * 2;
    h.marker.position.y = 2.6 + Math.sin(performance.now() / 300) * 0.12;
    if (forHire() && d < 14) {
      if (spd > 0.6) prompt = 'Pull up and stop next to the passenger';
      else if (taxi.doorsLocked) prompt = 'Press <kbd>L</kbd> to unlock the doors and let them in';
      else pickUp(h);
    }
  }

  if (F) {
    for (const k in F.cool) F.cool[k] -= dt;
    if (F.stage === 'walking') {
      F.walkT += dt;
      const [dx, dz] = doorPoint(F.side);
      const p = F.person.group.position;
      const vx = dx - p.x, vz = dz - p.z, l = Math.hypot(vx, vz);
      if (spd > 1.5) {
        // driver drove off!
        say('Oi! Where are you going?!');
        scene.remove(F.person.group);
        G.fare = null;
        toast('You drove off without your passenger.', 'bad');
        return;
      }
      if (l < 0.5 || F.walkT > 7) boardPassenger();
      else {
        const st = Math.min(l, 1.7 * dt);
        p.x += (vx / l) * st;
        p.z += (vz / l) * st;
        F.person.face(vx / l, vz / l);
        F.person.walkAnim(dt, 1.7);
      }
      prompt = 'Passenger getting in…';
    } else if (F.stage === 'onboard') {
      F.t += dt;
      F.moved += spd * dt;
      // auto-lock above walking pace
      if (!taxi.doorsLocked && spd > 2) { taxi.doorsLocked = true; sound.lock(); }
      if (!F.meterOn && F.moved > 40 && !F.warnedMeter) {
        F.warnedMeter = true;
        say(pick(["Aren't you going to start the meter?", "Is the meter not on?"]));
        toast('Start the meter! Press <kbd>M</kbd>', 'bad');
      }
      if (!F.meterOn && F.moved < 40) prompt = 'Press <kbd>M</kbd> to start the meter';
      // mood
      const mph = spd * 2.237;
      if (taxi.lastImpact > 2) moodHit(-Math.min(22, taxi.lastImpact * 2.5), pick(['Oi! Watch it!', 'Whoa! Careful!', 'Are you trying to kill me?!']), 'crash', 2);
      if (taxi.accelLong < -7.5 && spd > 3) moodHit(-3, pick(['Steady on!', 'Easy on the brakes!']), 'brake', 6);
      if (mph > 36) {
        if (F.pax.hurry) moodHit(0.4 * dt * 10, null);
        else moodHit(-1.4 * dt, null), moodHit(0, 'Could you slow down a bit, please?', 'speed', 14);
      }
      if (F.t > F.expected) {
        moodHit(-0.5 * dt, null);
        if (F.t > F.expected + 10) moodHit(0, pick(['Are we nearly there?', "Is this the scenic route?", "I could have walked faster..."]), 'late', 25);
      }
      if (F.pax.hurry && F.t < F.expected * 0.8 && spd > 9) moodHit(0.25 * dt, null);
      // chat
      F.chatT -= dt;
      if (F.chatT <= 0 && F.chatsLeft > 0 && !G.replyFn) {
        F.chatsLeft--;
        F.chatT = rand(25, 40);
        const [q, replies] = pick(F.pax.def.chat);
        ask(q, replies, (i) => moodHit(i === 0 ? 6 : 4, null));
      }
      if (F.pax.mood < 8 && !F.bail) {
        F.bail = true;
        say("That's it — pull over and let me out here!");
        const bx = taxi.x + taxi.fwdX * 15, bz = taxi.z + taxi.fwdZ * 15;
        const seg = city.nearestSegment(bx, bz);
        F.dest = { x: bx, z: bz, name: 'Right here (angry passenger)', fx: 0, fz: 0, nodes: [seg[0], seg[1]] };
      }
      const d = Math.hypot(F.dest.x - taxi.x, F.dest.z - taxi.z);
      if (d < 22) {
        if (spd > 0.8) prompt = `Here's ${F.dest.name} — pull over`;
        else prompt = F.meterOn ? 'Press <kbd>M</kbd> to stop the meter and take payment' : 'Press <kbd>M</kbd> to let them pay… (the meter was never started!)';
        if (!F.meterOn && spd < 0.8) prompt = 'Press <kbd>M</kbd>';
      }
    } else if (F.stage === 'leaving') {
      prompt = 'Press <kbd>L</kbd> to unlock the doors so they can get out';
    }
  } else if (forHire() && !prompt) {
    if (G.hailers.length === 0) prompt = '';
  }
  // leavers walking away
  if (G.leavers) for (const l of [...G.leavers]) {
    l.t += dt;
    const p = l.p.group.position;
    const vx = l.to[0] - p.x, vz = l.to[1] - p.z, d = Math.hypot(vx, vz);
    if (d > 0.3) { p.x += (vx / d) * 1.5 * dt; p.z += (vz / d) * 1.5 * dt; l.p.face(vx / d, vz / d); l.p.walkAnim(dt, 1.5); }
    if (l.t > 6) { scene.remove(l.p.group); G.leavers = G.leavers.filter((x) => x !== l); }
  }
  G.prompt = prompt;
  G.action = computeAction();
}

function computeAction() {
  const F = G.fare, spd = Math.abs(taxi.speed);
  if (F && F.stage === 'leaving') return { label: '🔓 Let them out', key: 'l' };
  if (F && F.stage === 'onboard') {
    const d = Math.hypot(F.dest.x - taxi.x, F.dest.z - taxi.z);
    if (d < 22 && spd < 0.8) return { label: F.meterOn ? '■ Stop meter & take payment' : '💷 Ask for payment', key: 'm' };
    if (!F.meterOn) return { label: '▶ Start the meter', key: 'm' };
  }
  if (forHire() && spd < 0.6 && taxi.doorsLocked && G.hailers.some((h) => Math.hypot(h.spot.x - taxi.x, h.spot.z - taxi.z) < 14)) return { label: '🔓 Let them in', key: 'l' };
  if (spd < 0.5 && G.battery < 1 && chargers.some((c) => Math.hypot(c.x - taxi.x, c.z - taxi.z) < 10)) return { label: `⚡ Hold to charge · ${Math.round(G.battery * 100)}%`, hold: true };
  return null;
}

// ------------------------------------------------------------------ rules: lights, cameras, battery
function speedLimit() {
  return taxi.x > 750 && taxi.z < RIVER_Z0 ? 20 : 30;
}
function updateRules(dt) {
  const i = Math.round(taxi.x / B), j = Math.round(taxi.z / B);
  const inBox = i >= 0 && i < NX && j >= 0 && j < NZ && Math.abs(taxi.x - i * B) < HALF_ROAD - 0.5 && Math.abs(taxi.z - j * B) < HALF_ROAD - 0.5;
  if (inBox && !G.inJunction) {
    G.inJunction = true;
    const node = city.nodes[nodeId(i, j)];
    if (node.signal && Math.abs(taxi.speed) > 2.5) {
      const axis = Math.abs(taxi.vx) > Math.abs(taxi.vz) ? 'x' : 'z';
      const st = city.lightState(node, axis);
      if (st === 'R') {
        const camOn = node.id % 3 !== 0;
        moodHit(-8, 'Was that a red light?!', 'red', 3);
        if (camOn) { fine(10000, '📸 Red light camera — £100 fine', 'redlight'); flash(); }
        else toast('You ran a red light! (no camera this time)', 'bad');
      }
    }
  } else if (!inBox) G.inJunction = false;
  const mph = Math.abs(taxi.speed) * 2.237;
  const lim = speedLimit();
  for (const c of speedCams) {
    c.cool -= dt;
    if (c.cool <= 0 && Math.hypot(c.x - taxi.x, c.z - taxi.z) < 12 && mph > lim * 1.1 + 2) {
      c.cool = 10;
      flash();
      fine(10000, `📸 Speed camera — ${Math.round(mph)} in a ${lim}: £100 fine`, 'speed');
    }
  }
  // crash damage: one charge per impact (scraping along a wall doesn't keep billing you)
  G.crashCool = Math.max(0, (G.crashCool || 0) - dt);
  if (taxi.lastImpact > 1 && G.crashCool <= 0) {
    G.crashCool = 1.2;
    sound.crash(taxi.lastImpact);
    if (taxi.lastImpact > 4) {
      const cost = Math.min(15000, Math.round((taxi.lastImpact - 3) * 800));
      fine(cost, `💥 Bodywork damage — ${fmtMoney(cost)}`, 'damage');
    }
  }
  // battery & range extender
  const moved = Math.abs(taxi.speed) * dt;
  if (G.battery > 0) G.battery = Math.max(0, G.battery - moved / 45000);
  else {
    G.fuel += moved * 0.06;
    if (!G.rangeWarned) { G.rangeWarned = true; toast('🔋 Battery flat — petrol range-extender running (costs fuel). Charge at ⚡', 'bad'); }
  }
  // charging
  for (const c of chargers) {
    if (Math.hypot(c.x - taxi.x, c.z - taxi.z) < 10 && Math.abs(taxi.speed) < 0.5) {
      if (!G.prompt) G.prompt = `⚡ Rapid charger — hold <kbd>F</kbd> to charge (20p per 1%) · ${Math.round(G.battery * 100)}%`;
      if ((keys.has('f') || touch.charge) && G.battery < 1) {
        const add = Math.min(1 - G.battery, dt * 0.03);
        G.battery += add;
        G.fuel += add * 100 * 20;
      }
    }
  }
}
function fine(pence, msg, kind = 'fine') {
  G.fines += pence;
  G.fineLog = G.fineLog || {};
  G.fineLog[kind] = (G.fineLog[kind] || 0) + pence;
  sound.fine();
  toast(msg, 'bad');
}

function recoverTaxi() {
  const seg = city.nearestSegment(taxi.x, taxi.z);
  if (!seg) return;
  const a = city.nodes[seg[0]], b = city.nodes[seg[1]];
  const t = clamp(seg[2], 0.2, 0.8);
  const dx = Math.sign(b.x - a.x), dz = Math.sign(b.z - a.z);
  const x = a.x + (b.x - a.x) * t + dz * 3.5, z = a.z + (b.z - a.z) * t - dx * 3.5;
  taxi.place(x, z, Math.atan2(-dx, -dz));
  toast('Cab recovered to the road.');
}

// ------------------------------------------------------------------ maps
const mapScale = 1;
const MAP_X0 = -60, MAP_Z0 = -60, MAP_W = (NX - 1) * B + 120, MAP_H = (NZ - 1) * B + 120;
const staticMap = document.createElement('canvas');
staticMap.width = MAP_W;
staticMap.height = MAP_H;
function buildStaticMap() {
  const g = staticMap.getContext('2d');
  g.fillStyle = '#3a3f47';
  g.fillRect(0, 0, MAP_W, MAP_H);
  g.translate(-MAP_X0, -MAP_Z0);
  // river
  g.fillStyle = '#2f6c8f';
  g.fillRect(MAP_X0, RIVER_Z0, MAP_W, RIVER_Z1 - RIVER_Z0);
  // blocks
  for (let bj = 0; bj < NZ - 1; bj++) for (let bi = 0; bi < NX - 1; bi++) {
    if (bj === RIVER_ROW) continue;
    const k = LANDMARK_CELLS[bi + ',' + bj];
    g.fillStyle = k === 'park' ? '#4d7a3e' : k ? '#6b5f4a' : '#4c525b';
    g.fillRect(bi * B + 7, bj * B + 7, B - 14, B - 14);
  }
  // roads
  g.fillStyle = '#9aa0a8';
  for (let j = 0; j < NZ; j++) g.fillRect(-7, j * B - 7, (NX - 1) * B + 14, 14);
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ - 1; j++) if (hasEdgeV(i, j)) g.fillRect(i * B - 7, j * B, 14, B);
  g.fillStyle = '#c9b46a';
  for (const i of Object.keys(BRIDGES)) g.fillRect(i * B - 7, RIVER_Z0, 14, RIVER_Z1 - RIVER_Z0);
  g.setTransform(1, 0, 0, 1, 0, 0);
}
buildStaticMap();

function drawMarkers(g, scale, rot) {
  const icon = (x, z, txt, size = 16) => {
    g.save();
    g.translate(x, z);
    g.rotate(-rot);
    g.font = `${size / scale}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(txt, 0, 0);
    g.restore();
  };
  if (G.route && G.fare && G.fare.stage === 'onboard' && !G.knowledge) {
    g.strokeStyle = '#38b6ff';
    g.lineWidth = 6 / scale;
    g.lineJoin = 'round';
    g.beginPath();
    G.route.pts.forEach(([x, z], k) => (k ? g.lineTo(x, z) : g.moveTo(x, z)));
    g.stroke();
  }
  for (const c of chargers) icon(c.x, c.z, '⚡', 13);
  for (const h of G.hailers) {
    if (!forHire()) break;
    g.fillStyle = '#ffd23a';
    g.beginPath();
    g.arc(h.spot.x, h.spot.z, 6 / scale, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#000';
    g.lineWidth = 1.5 / scale;
    g.stroke();
  }
  if (G.fare && G.fare.dest && G.fare.stage !== 'walking') icon(G.fare.dest.x, G.fare.dest.z, '🏁', 20);
}

const mini = $('minimap');
const mctx = mini.getContext('2d');
function drawMinimap(ctx, W, H, scale) {
  ctx.save();
  ctx.fillStyle = '#22262c';
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2 + H * 0.12);
  ctx.rotate(taxi.heading);
  ctx.scale(scale, scale);
  ctx.translate(-taxi.x, -taxi.z);
  ctx.drawImage(staticMap, MAP_X0, MAP_Z0);
  drawMarkers(ctx, scale, taxi.heading);
  ctx.restore();
  // player arrow
  ctx.save();
  ctx.translate(W / 2, H / 2 + H * 0.12);
  ctx.fillStyle = '#ffd23a';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -11); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
  // north indicator
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(taxi.heading);
  ctx.fillStyle = '#ff5252';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', 0, -H / 2 + 16);
  ctx.restore();
}

function drawBigMap() {
  const c = $('bigmap-canvas');
  const g = c.getContext('2d');
  const s = Math.min(c.width / MAP_W, c.height / MAP_H);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#22262c';
  g.fillRect(0, 0, c.width, c.height);
  g.setTransform(s, 0, 0, s, -MAP_X0 * s, -MAP_Z0 * s);
  g.drawImage(staticMap, MAP_X0, MAP_Z0);
  g.fillStyle = '#fff';
  g.font = `bold ${11 / s}px sans-serif`;
  g.textAlign = 'center';
  for (const p of city.places) {
    g.fillStyle = 'rgba(0,0,0,.55)';
    const w = g.measureText(p.name).width;
    const [bi, bj] = p.cell;
    const cx = (bi + 0.5) * B, cz = (bj + 0.5) * B;
    g.fillRect(cx - w / 2 - 3, cz - 9, w + 6, 15);
    g.fillStyle = '#fff';
    g.fillText(p.name, cx, cz + 3);
  }
  for (const c2 of speedCams) { g.font = `${12 / s}px sans-serif`; g.fillText('📷', c2.x, c2.z); }
  drawMarkers(g, s, 0);
  g.save();
  g.translate(taxi.x, taxi.z);
  g.rotate(-taxi.heading);
  g.fillStyle = '#ffd23a';
  g.strokeStyle = '#000';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, -14); g.lineTo(10, 11); g.lineTo(0, 5); g.lineTo(-10, 11); g.closePath();
  g.fill(); g.stroke();
  g.restore();
  // river label
  g.font = `italic ${16 / s}px Georgia, serif`;
  g.fillStyle = '#bfe3ff';
  g.fillText('River Thames', 120, (RIVER_Z0 + RIVER_Z1) / 2 + 5);
}

// ------------------------------------------------------------------ HUD
let hudT = 0;
function updateHUD(dt) {
  hudT -= dt;
  const mph = Math.abs(taxi.speed) * 2.237;
  $('h-speed').textContent = Math.round(mph);
  $('h-gear').textContent = taxi.gear;
  if (hudT > 0) return;
  hudT = 0.1;
  $('h-clock').textContent = `${DAYS[G.day]} ${clockStr()}`;
  $('h-weather').textContent = G.raining ? '🌧️' : nightLevel > 0.5 ? '🌙' : '⛅';
  $('h-tariff').textContent = `Tariff ${tariffFor(G.day, hour())}`;
  $('h-limit').textContent = `${speedLimit()} mph limit`;
  const cashIn = floatTotal(G.float) - G.floatStart;
  const takings = G.takingsCard + cashIn - G.fines - G.fuel;
  $('h-takings').textContent = fmtMoney(takings);
  $('h-takings').style.color = takings < 0 ? '#ff8a80' : '#7dff9b';
  $('h-card').textContent = fmtMoney(G.takingsCard);
  $('h-cash').textContent = fmtMoney(floatTotal(G.float));
  $('h-tips').textContent = fmtMoney(G.tips);
  $('h-fines').textContent = fmtMoney(G.fines + G.fuel);
  $('h-fares').textContent = G.fares;
  $('h-rating').textContent = G.ratings.length ? (G.ratings.reduce((a, b) => a + b, 0) / G.ratings.length).toFixed(2) + ' ★' : '–';
  $('h-battery').textContent = G.battery > 0 ? Math.round(G.battery * 100) + '%' : 'Petrol';
  const st = city.streetAt(taxi.x, taxi.z) || 'Off road';
  $('h-street').textContent = st;
  $('h-code').textContent = postcode(taxi.x, taxi.z);
  // meter
  const lmState = $('lm-state');
  lmState.textContent = meter.state === 'vacant' ? 'FOR HIRE' : meter.state === 'hired' ? 'HIRED' : 'STOPPED';
  lmState.className = meter.state === 'vacant' ? 'vac' : '';
  $('lm-tariff').textContent = 'T' + (meter.state === 'vacant' ? tariffFor(G.day, hour()) : meter.tariff);
  $('lm-fare').textContent = meter.state === 'vacant' ? '--.--' : fmtMoney(meter.total).replace('£', '');
  $('lm-hire').classList.toggle('on', forHire());
  $('lm-lock').textContent = taxi.doorsLocked ? '🔒' : '🔓';
  // job
  const F = G.fare;
  if (F && (F.stage === 'onboard' || F.stage === 'paying')) {
    $('job').classList.remove('hidden');
    const d = Math.hypot(F.dest.x - taxi.x, F.dest.z - taxi.z);
    $('job-title').textContent = `${F.pax.name} → ${F.dest.name}`;
    $('job-sub').textContent = `${F.pax.type}${F.pax.hurry ? ' · in a hurry' : ''} · ${G.knowledge ? 'Use The Knowledge!' : Math.round(G.route ? G.route.len : d) + ' m by road'} · ${postcode(F.dest.x, F.dest.z)}`;
    $('mood-fill').style.width = F.pax.mood + '%';
  } else $('job').classList.add('hidden');
  $('prompt').innerHTML = G.prompt || '';
  if (isTouch) {
    const sb = $('smart-btn');
    const a = !payment.active && G.action;
    sb.classList.toggle('hidden', !a);
    if (a && sb.textContent !== a.label) sb.textContent = a.label;
  }
  // 3D displays
  taxi.drawMeter(meter, clockStr());
  taxi.drawCluster({ battery: G.battery, clock: `${DAYS[G.day]} ${clockStr()}`, limit: speedLimit() });
  if (!payment.active) taxi.drawTerminal(['PayCab', 'READY', clockStr()]);
  drawMinimap(mctx, mini.width, mini.height, 0.75);
  const nctx = taxi.navCanvas.getContext('2d');
  drawMinimap(nctx, 320, 200, 0.9);
  if (G.fare && G.fare.dest && G.fare.stage === 'onboard') {
    nctx.fillStyle = 'rgba(0,0,0,.6)';
    nctx.fillRect(0, 0, 320, 26);
    nctx.fillStyle = '#fff';
    nctx.font = 'bold 15px Arial';
    nctx.fillText((G.knowledge ? '' : '→ ') + G.fare.dest.name, 8, 18);
  }
  taxi.navTex.needsUpdate = true;
  if (!$('bigmap').classList.contains('hidden')) drawBigMap();
}

// ------------------------------------------------------------------ camera
const camPos = new THREE.Vector3();
const camTarget = new THREE.Vector3();
let chaseInit = false;
function updateCamera(dt) {
  taxi.group.updateMatrixWorld(true);
  if (G.cam === 'cockpit') {
    // look at the partition when taking payment
    const wantYaw = G.lookTarget ? 2.35 : G.lookBack ? 2.5 : 0;
    if (!dragging) {
      G.lookYaw = smooth(G.lookYaw, wantYaw, G.lookTarget ? 3 : 2.5, dt);
      G.lookPitch = smooth(G.lookPitch, G.lookTarget ? -0.1 : 0, 2.5, dt);
    }
    // glance into the turn
    const glance = clamp(taxi.steer * 0.5, -0.25, 0.25);
    const e = new THREE.Vector3(EYE.x - (G.lookYaw > 1 ? 0.12 : 0), EYE.y, EYE.z);
    e.applyMatrix4(taxi.interior.matrixWorld);
    camera.position.copy(e);
    camera.rotation.set(0, 0, 0);
    camera.quaternion.setFromEuler(new THREE.Euler(G.lookPitch - 0.08 - taxi.pitch, taxi.heading + G.lookYaw + glance, -taxi.roll * 0.5, 'YXZ'));
    camera.fov = camera.aspect < 1 ? 92 : 72;
    chaseInit = false;
  } else {
    const fx = taxi.fwdX, fz = taxi.fwdZ;
    const yaw = taxi.heading + G.lookYaw;
    const bx = Math.sin(yaw), bz = Math.cos(yaw);
    const want = new THREE.Vector3(taxi.x + bx * 8.5, 3.6, taxi.z + bz * 8.5);
    if (!chaseInit) { camPos.copy(want); chaseInit = true; }
    camPos.lerp(want, 1 - Math.exp(-5 * dt));
    // keep camera out of buildings
    const h = city.collideCircle(camPos.x, camPos.z, 0.6);
    if (h) { camPos.x = h.x; camPos.z = h.z; }
    camera.position.copy(camPos);
    camTarget.set(taxi.x + fx * 4, 1.4, taxi.z + fz * 4);
    camera.lookAt(camTarget);
    camera.fov = camera.aspect < 1 ? 85 : 65;
    if (!dragging) G.lookYaw = smooth(G.lookYaw, 0, 2, dt);
  }
  camera.updateProjectionMatrix();
}

// ------------------------------------------------------------------ shift
function endShift() {
  G.shiftEnded = true;
  G.mode = 'summary';
  const cashIn = floatTotal(G.float) - G.floatStart;
  const takings = G.takingsCard + cashIn - G.fines - G.fuel;
  const avg = G.ratings.length ? G.ratings.reduce((a, b) => a + b, 0) / G.ratings.length : 0;
  let best = 0;
  try { best = +localStorage.getItem('lc-best') || 0; if (takings > best) localStorage.setItem('lc-best', takings); } catch (e) { /* storage blocked */ }
  const rows = G.log.slice(-8).map((l) => `<div><span>${l.name} → ${l.dest}</span><span>${fmtMoney(l.amount)} ${'★'.repeat(l.stars)}</span></div>`).join('');
  $('summary-card').innerHTML = `
    <h2>End of shift</h2>
    <div class="muted">${DAYS[G.day]} · ${clockStr()}</div>
    <div class="summary-big">${fmtMoney(takings)}</div>
    <div class="muted">${takings > best && best > 0 ? '🏆 New best shift!' : best > 0 ? 'Best shift: ' + fmtMoney(best) : ''}</div>
    <div class="summary-stats">
      <div><span>Fares completed</span><span>${G.fares}</span></div>
      <div><span>Card takings</span><span>${fmtMoney(G.takingsCard)}</span></div>
      <div><span>Cash taken (net of change)</span><span>${fmtMoney(cashIn)}</span></div>
      <div><span>Tips</span><span>${fmtMoney(G.tips)}</span></div>
      <div><span>Fines, damage, fuel & charging</span><span class="neg">-${fmtMoney(G.fines + G.fuel)}</span></div>
      <div><span>Average rating</span><span>${avg ? avg.toFixed(2) + ' ★' : '–'}</span></div>
      ${rows}
    </div>
    <button class="big-btn" id="keep-btn">Keep driving</button>
    <button class="big-btn alt" id="new-btn">New shift</button>`;
  $('summary').classList.remove('hidden');
  $('keep-btn').addEventListener('click', () => { $('summary').classList.add('hidden'); G.mode = 'driving'; G.shiftEnded = false; G.shiftStart = G.minutes; });
  $('new-btn').addEventListener('click', () => location.reload());
}

// ------------------------------------------------------------------ title
let shiftHour = 7;
{
  const seg = $('quality-seg');
  let saved = null;
  try { saved = localStorage.getItem('lc-quality'); } catch (e) { /* ignore */ }
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const def = saved || (mobile ? 'low' : 'high');
  seg.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.q === def);
    b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    });
  });
}
$('shift-seg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  $('shift-seg').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
  b.classList.add('on');
  shiftHour = +b.dataset.h;
  G.minutes = shiftHour * 60;
}));
try {
  const best = +localStorage.getItem('lc-best');
  if (best) $('best').textContent = 'Best shift so far: ' + fmtMoney(best);
} catch (e) { /* ignore */ }

function startGame() {
  sound.init();
  G.knowledge = $('opt-knowledge').checked;
  G.markers = $('opt-markers').checked;
  $('opt-markers2').checked = G.markers;
  const q = $('quality-seg').querySelector('button.on').dataset.q;
  G.low = q === 'low';
  setupQuality(q);
  try { localStorage.setItem('lc-quality', q); } catch (e) { /* ignore */ }
  G.minutes = shiftHour * 60;
  G.shiftStart = G.minutes;
  G.day = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  $('title').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (document.body.classList.contains('is-touch')) $('touch').classList.remove('hidden');
  G.mode = 'driving';
  // first fare: someone hailing just up the road
  addHailer(city.kerbSpot(4, 4, 'N', 0.45));
  G.hailSpawnT = 8;
  G.autoLights = true;
  if (nightLevel > 0.4) taxi.headlights = true;
  toast('Your shift has started. Look for someone with their arm up 🙋', 'good');
  if (isTouch) setTimeout(() => toast('Drive on the <b>left</b>! Drag the wheel to steer. Tap the yellow button when it appears — everything else is in ☰ CAB.'), 1500);
  else setTimeout(() => toast('Drive on the <b>left</b>! <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to drive, <kbd>C</kbd> to change camera, <kbd>F1</kbd> for all controls.'), 1500);
}
$('start-btn').addEventListener('click', startGame);

// ------------------------------------------------------------------ init
setupQuality('high');
taxi.place(560, 4 * B + 3.5, Math.PI / 2);
taxi.setCockpit(true);
traffic.spawnAll(taxi.x, taxi.z);
crowd.init(taxi.x, taxi.z);
G.minutes = 7 * 60;
updateEnvironment(0.016);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  if (gtaoPass) gtaoPass.setSize(window.innerWidth, window.innerHeight);
});

// title-screen camera orbit
let titleT = 0;
function titleCamera(dt) {
  titleT += dt * 0.05;
  const cx = 400, cz = 560;
  camera.position.set(cx + Math.cos(titleT) * 190, 95, cz + Math.sin(titleT) * 190);
  camera.lookAt(cx, 30, cz);
  camera.fov = 55;
  camera.updateProjectionMatrix();
}

// ------------------------------------------------------------------ loop
let last = performance.now();
let mirrorFrame = 0;
let ready = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (G.mode === 'driving') {
    simStep(dt);
    sound.update(taxi.speed, input.throttle, G.raining, G.cam === 'cockpit');
    taxi.model.userData.sign.userData.setLit(forHire());
    updateCamera(dt);
    updateHUD(dt);
  } else if (G.mode === 'title') {
    titleCamera(dt);
    traffic.update(dt, { x: 400, z: 560, vx: 0, vz: 0 }, null);
    crowd.update(dt, 400, 560);
  } else if (G.mode === 'paused' || G.mode === 'summary') {
    sound.update(0, 0, false, true);
  }
  renderFrame(dt, now);
}

/** one tick of game simulation (no rendering) */
function simStep(dt) {
  {
    readInput(dt);
    const moved = taxi.update(dt, input, city, traffic);
    meter.update(dt, taxi.speed, moved);
    traffic.update(dt, taxi, sound);
    crowd.update(dt, taxi.x, taxi.z);
    G.minutes += (dt * TIME_RATE) / 60;
    if (G.minutes >= 1440) { G.minutes -= 1440; G.shiftStart -= 1440; G.day = (G.day + 1) % 7; }
    updateFares(dt);
    updateRules(dt);
    updateWeather(dt);
    // route refresh
    G.routeT -= dt;
    if (G.routeT <= 0 && G.fare && G.fare.stage === 'onboard') {
      G.routeT = 0.8;
      G.route = city.route(taxi.x, taxi.z, taxi.fwdX, taxi.fwdZ, G.fare.dest);
    }
    G.speechT -= dt;
    if (G.speechT <= 0) $('speech').classList.add('hidden');
    if (G.replyFn) {
      G.replyT -= dt;
      if (G.replyT <= 0) { G.replyFn = null; $('replies').classList.add('hidden'); moodHit(-2, null); }
    }
    if (!G.shiftEnded && G.minutes - G.shiftStart >= SHIFT_HOURS * 60 && !G.fare) endShift();
    // beacon
    const F = G.fare;
    beacon.visible = !!(F && F.stage === 'onboard' && !G.knowledge && F.dest);
    if (beacon.visible) beacon.position.set(F.dest.x, 30, F.dest.z);
  }
}

function renderFrame(dt, now) {
  city.update(dt, { minutes: G.minutes % 1440 });
  updateEnvironment(dt);
  // rear-view mirror
  if (G.mode === 'driving' && G.cam === 'cockpit' && !G.low && (mirrorFrame++ % 2 === 0)) {
    rain.visible = false;
    renderer.setRenderTarget(taxi.mirrorRT);
    renderer.render(scene, taxi.mirrorCam);
    renderer.setRenderTarget(null);
    rain.visible = G.raining;
  }
  city.updateHalos(camera);
  if (composer) {
    if (gradePass) gradePass.uniforms.time.value = (now % 10000) / 1000;
    composer.render(dt);
  } else renderer.render(scene, camera);
  if (!ready) {
    ready = true;
    const b = $('start-btn');
    b.disabled = false;
    b.textContent = 'Start shift 🚕';
  }
}
requestAnimationFrame(frame);

// debugging hook
window.__game = {
  sim(seconds, hook) {
    const step = 1 / 30;
    for (let t = 0; t < seconds; t += step) {
      if (hook) hook();
      if (G.mode !== 'driving') break;
      simStep(step);
      city.time += step;
    }
  },
  keys, touch, input,
  G, taxi, city, traffic, meter, payment, renderer, debug: { pickUp, boardPassenger, startPayment, meterKey, toggleLocks, addHailer, onKeyPress } };
void angleWrap; void mapScale;
