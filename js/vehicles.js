import * as THREE from 'three';
import { GeoBuilder, makeCanvas, canvasTex } from './util.js';

// headlight beam projected on the road (shared material, faded in at night)
let beamTex = null;
function beamTexture() {
  if (beamTex) return beamTex;
  const c = makeCanvas(64, 128), g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 128, 4, 32, 90, 90);
  gr.addColorStop(0, 'rgba(255,240,210,1)');
  gr.addColorStop(0.5, 'rgba(255,230,190,0.35)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 128);
  beamTex = canvasTex(c, false);
  return beamTex;
}
export const beamMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
export function setVehicleNight(n) {
  if (!beamMat.map) beamMat.map = beamTexture();
  beamMat.opacity = Math.max(0, (n - 0.3) / 0.7) * 0.45;
  lightMat.color.setScalar(1 + n * 3);
}
function addBeam(g, frontZ, w = 2.4) {
  if (!beamMat.map) beamMat.map = beamTexture();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.6, 11).rotateX(-Math.PI / 2), beamMat);
  m.position.set(0, 0.06, frontZ - 5.4);
  m.renderOrder = 2;
  g.add(m);
}

// All vehicles: origin on the ground at the centre, front facing -z.

export const bodyMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.15, roughness: 0.42, clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 0.9 });
export const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.6 });
export const glassMat = new THREE.MeshPhysicalMaterial({ color: '#0d1318', metalness: 0.2, roughness: 0.02, clearcoat: 1, envMapIntensity: 2.0 });
export const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

function profileBody(builder, pts, width, color, bevel = 0.06) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) s.lineTo(pts[k][0], pts[k][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(Math.PI / 2);
  builder.add(g, null, color);
}

function wheels(builder, xs, zs, r, w, hub = '#b8b8b8') {
  const tyre = new THREE.CylinderGeometry(r, r, w, 18);
  tyre.rotateZ(Math.PI / 2);
  const cap = new THREE.CylinderGeometry(r * 0.6, r * 0.6, w + 0.02, 14);
  cap.rotateZ(Math.PI / 2);
  for (const x of xs)
    for (const z of zs) {
      builder.geo(tyre, x, r, z, '#151515');
      builder.geo(cap, x, r, z, hub);
    }
}

function plate(builder, z, y, color, w = 0.52) {
  builder.box(0, y, z, w, 0.12, 0.02, color);
}

const cache = new Map();

/** classic London black cab */
export function buildCab(opts = {}) {
  const key = 'cab' + (opts.color || '#0c0c0c') + (opts.separateWheels ? 'w' : '');
  let c = cache.get(key);
  if (!c) {
    const body = new GeoBuilder(), trim = new GeoBuilder(), glass = new GeoBuilder(), lights = new GeoBuilder();
    const L = 2.29;
    const pts = [
      [-L, 0.34], [L - 0.05, 0.34], [L + 0.02, 0.55], [L - 0.02, 0.84], [2.0, 0.98], [1.05, 1.08], [0.45, 1.79],
      [0.28, 1.85], [-1.95, 1.87], [-2.2, 1.72], [-L, 1.12], [-L - 0.03, 0.6],
    ];
    profileBody(body, pts, 1.9, opts.color || '#0b0b0c');
    // wheel arches (dark)
    for (const z of [-1.45, 1.45]) for (const x of [-0.93, 0.93]) trim.box(x, 0.55, z, 0.06, 0.42, 0.95, '#0a0a0a');
    // bumpers, grille, plates
    trim.box(0, 0.5, -L - 0.06, 1.85, 0.2, 0.14, '#1a1a1a');
    trim.box(0, 0.5, L + 0.06, 1.85, 0.2, 0.14, '#1a1a1a');
    trim.box(0, 0.78, -L - 0.03, 0.62, 0.26, 0.06, '#c9c9c9');
    for (let k = 0; k < 6; k++) trim.box(0, 0.68 + k * 0.04, -L - 0.07, 0.56, 0.012, 0.02, '#777');
    plate(trim, -L - 0.14, 0.42, '#f4f4f4');
    plate(trim, L + 0.14, 0.42, '#f2c500');
    // mirrors
    for (const x of [-1.03, 1.03]) {
      trim.box(x, 1.18, -0.95, 0.18, 0.14, 0.08, '#0c0c0c');
      trim.box(x * 0.97, 1.13, -0.98, 0.04, 0.03, 0.2, '#0c0c0c');
    }
    // door handles & chrome strip
    for (const x of [-0.97, 0.97]) {
      trim.box(x, 1.02, -0.55, 0.02, 0.03, 0.14, '#cfcfcf');
      trim.box(x, 1.02, 0.95, 0.02, 0.03, 0.14, '#cfcfcf');
      trim.box(x, 0.72, 0, 0.015, 0.02, 3.6, '#9a9a9a');
    }
    // glass
    for (const x of [-0.955, 0.955]) {
      glass.box(x, 1.44, -0.48, 0.02, 0.56, 0.86);
      glass.box(x, 1.44, 0.72, 0.02, 0.56, 1.3);
      glass.box(x, 1.44, 1.72, 0.02, 0.5, 0.5);
    }
    glass.box(0, 1.44, -0.76, 1.72, 0.93, 0.02, null, 0, 0.7);
    glass.box(0, 1.42, 2.26, 1.5, 0.5, 0.02, null, 0, -0.15);
    // lights: round headlamps, indicators, tail lights
    const hl = new THREE.CylinderGeometry(0.14, 0.14, 0.05, 16);
    hl.rotateX(Math.PI / 2);
    for (const x of [-0.62, 0.62]) {
      lights.geo(hl, x, 0.84, -L - 0.01, '#fffbe8');
      lights.box(x * 1.25, 0.62, -L - 0.02, 0.14, 0.08, 0.04, '#ffa500');
      lights.box(x * 1.32, 0.95, L + 0.0, 0.16, 0.3, 0.05, '#c0101a');
    }
    if (!opts.separateWheels) wheels(trim, [-0.84, 0.84], [-1.45, 1.45], 0.36, 0.24);
    c = { body: body.build(), trim: trim.build(), glass: glass.build(), lights: lights.build() };
    cache.set(key, c);
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(c.body, bodyMat);
  const trim = new THREE.Mesh(c.trim, trimMat);
  const glass = new THREE.Mesh(c.glass, glassMat);
  const lights = new THREE.Mesh(c.lights, lightMat);
  body.castShadow = trim.castShadow = true;
  g.add(body, trim, glass, lights);
  g.userData = { body, trim, glass, lights };
  if (!opts.separateWheels) addBeam(g, -2.3);
  // roof sign
  const sign = makeTaxiSign();
  sign.position.set(0, 1.97, -0.35);
  g.add(sign);
  g.userData.sign = sign;
  if (opts.separateWheels) {
    const wb = new GeoBuilder();
    wheels(wb, [0], [0], 0.36, 0.24);
    const wg = wb.build();
    g.userData.wheels = [];
    for (const [x, z] of [[-0.84, -1.45], [0.84, -1.45], [-0.84, 1.45], [0.84, 1.45]]) {
      const piv = new THREE.Group();
      piv.position.set(x, 0, z);
      const spin = new THREE.Group();
      spin.position.y = 0.36;
      const w = new THREE.Mesh(wg, trimMat);
      w.position.y = -0.36;
      w.castShadow = true;
      spin.add(w);
      piv.add(spin);
      g.add(piv);
      g.userData.wheels.push({ piv, spin, front: z < 0 });
    }
  }
  return g;
}

let signTex = null;
function makeTaxiSign() {
  if (!signTex) {
    const c = makeCanvas(256, 64), g = c.getContext('2d');
    g.fillStyle = '#ffd23a';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#111';
    g.font = 'bold 50px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('TAXI', 128, 35);
    signTex = canvasTex(c, false);
  }
  const mat = new THREE.MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: '#ffb020', emissiveIntensity: 0.0, roughness: 0.4 });
  const geo = new THREE.BoxGeometry(0.56, 0.16, 0.2);
  const m = new THREE.Mesh(geo, mat);
  m.userData.setLit = (on) => { mat.emissiveIntensity = on ? 1.6 : 0.0; mat.color.set(on ? '#ffffff' : '#b0a070'); };
  m.userData.setLit(false);
  return m;
}

export const CAR_COLORS = ['#c2c4c8', '#1d1d1f', '#f1f1f1', '#284b8f', '#8d1c1c', '#3b5d3b', '#6b6d70', '#d4c08a', '#2f6f8f'];

export function buildCar(color) {
  const key = 'car' + color;
  let c = cache.get(key);
  if (!c) {
    const body = new GeoBuilder(), trim = new GeoBuilder(), glass = new GeoBuilder(), lights = new GeoBuilder();
    const L = 2.1;
    const pts = [[-L, 0.3], [L - 0.05, 0.3], [L + 0.02, 0.58], [1.95, 0.8], [1.0, 0.92], [0.3, 1.38], [-1.2, 1.42], [-1.95, 1.04], [-L, 0.82]];
    profileBody(body, pts, 1.8, color);
    trim.box(0, 0.42, -L - 0.03, 1.78, 0.18, 0.1, '#202020');
    trim.box(0, 0.42, L + 0.03, 1.78, 0.18, 0.1, '#202020');
    plate(trim, -L - 0.09, 0.45, '#f4f4f4');
    plate(trim, L + 0.09, 0.45, '#f2c500');
    for (const x of [-0.98, 0.98]) trim.box(x, 1.0, -0.75, 0.16, 0.1, 0.07, color);
    for (const x of [-0.9, 0.9]) glass.box(x, 1.14, -0.2, 0.02, 0.42, 1.9);
    glass.box(0, 1.15, -0.65, 1.6, 0.82, 0.02, null, 0, 0.99);
    glass.box(0, 1.23, 1.58, 1.5, 0.82, 0.02, null, 0, -1.1);
    for (const x of [-0.62, 0.62]) {
      lights.box(x, 0.68, -L - 0.01, 0.36, 0.12, 0.04, '#fff8e0');
      lights.box(x * 1.1, 0.78, L, 0.3, 0.12, 0.04, '#c0101a');
    }
    wheels(trim, [-0.8, 0.8], [-1.3, 1.3], 0.33, 0.22);
    c = { body: body.build(), trim: trim.build(), glass: glass.build(), lights: lights.build() };
    cache.set(key, c);
  }
  return assemble(c, -2.1);
}

export function buildVan() {
  let c = cache.get('van');
  if (!c) {
    const body = new GeoBuilder(), trim = new GeoBuilder(), glass = new GeoBuilder(), lights = new GeoBuilder();
    const L = 2.65;
    const pts = [[-L, 0.35], [L - 0.05, 0.35], [L + 0.03, 0.7], [2.45, 1.05], [1.8, 1.25], [1.25, 2.1], [1.0, 2.42], [-L, 2.45]];
    profileBody(body, pts, 2.0, '#f1f1ee');
    trim.box(0, 0.45, -L - 0.03, 1.98, 0.2, 0.1, '#2a2a2a');
    trim.box(0, 0.45, L + 0.03, 1.98, 0.2, 0.1, '#2a2a2a');
    plate(trim, -L - 0.09, 0.5, '#f4f4f4');
    plate(trim, L + 0.09, 0.5, '#f2c500');
    for (const x of [-1.0, 1.0]) glass.box(x, 1.6, -1.25, 0.02, 0.6, 0.7);
    glass.box(0, 1.67, -1.52, 1.8, 1.0, 0.02, null, 0, 0.57);
    for (const x of [-0.7, 0.7]) {
      lights.box(x, 0.95, -L - 0.01, 0.34, 0.16, 0.04, '#fff8e0');
      lights.box(x * 1.3, 1.0, L, 0.14, 0.4, 0.04, '#c0101a');
    }
    wheels(trim, [-0.86, 0.86], [-1.6, 1.7], 0.36, 0.24);
    c = { body: body.build(), trim: trim.build(), glass: glass.build(), lights: lights.build() };
    cache.set('van', c);
  }
  return assemble(c, -2.65);
}

let busDest = null;
export function buildBus() {
  let c = cache.get('bus');
  if (!c) {
    const body = new GeoBuilder(), trim = new GeoBuilder(), glass = new GeoBuilder(), lights = new GeoBuilder();
    const L = 5.3;
    const pts = [[-L, 0.35], [L - 0.1, 0.35], [L, 0.6], [L, 4.15], [L - 0.25, 4.38], [-L + 0.25, 4.38], [-L, 4.15]];
    profileBody(body, pts, 2.55, '#c8102e', 0.1);
    // window bands
    for (const x of [-1.285, 1.285]) {
      glass.box(x, 1.75, 0.2, 0.02, 0.85, 9.2);
      glass.box(x, 3.4, 0, 0.02, 0.8, 10.0);
      trim.box(x, 2.45, 0, 0.02, 0.1, 10.4, '#e8e8e8');
    }
    glass.box(0, 1.7, -L - 0.02, 2.2, 1.2, 0.02);
    glass.box(0, 3.4, -L - 0.02, 2.3, 0.8, 0.02);
    glass.box(0, 3.4, L + 0.02, 2.3, 0.8, 0.02);
    trim.box(0, 0.5, -L - 0.05, 2.5, 0.3, 0.12, '#1a1a1a');
    plate(trim, -L - 0.12, 0.6, '#f4f4f4');
    plate(trim, L + 0.06, 0.6, '#f2c500');
    for (const x of [-0.85, 0.85]) {
      lights.box(x, 0.75, -L - 0.03, 0.3, 0.14, 0.04, '#fff8e0');
      lights.box(x * 1.4, 1.0, L + 0.02, 0.12, 0.4, 0.04, '#c0101a');
    }
    wheels(trim, [-1.05, 1.05], [-3.3, 2.6], 0.5, 0.3, '#8a8a8a');
    c = { body: body.build(), trim: trim.build(), glass: glass.build(), lights: lights.build() };
    cache.set('bus', c);
  }
  const g = assemble(c, -5.3);
  if (!busDest) {
    const cv = makeCanvas(512, 64), x = cv.getContext('2d');
    x.fillStyle = '#080808';
    x.fillRect(0, 0, 512, 64);
    x.fillStyle = '#ffb200';
    x.font = 'bold 40px Arial, sans-serif';
    x.textBaseline = 'middle';
    x.fillText('73', 14, 34);
    x.fillText('OXFORD CIRCUS', 100, 34, 400);
    busDest = new THREE.MeshBasicMaterial({ map: canvasTex(cv, false), toneMapped: false });
  }
  const d = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.26), busDest);
  d.position.set(0, 2.7, -5.31);
  d.rotation.y = Math.PI;
  g.add(d);
  return g;
}

function assemble(c, frontZ = -2.2) {
  const g = new THREE.Group();
  addBeam(g, frontZ);
  const body = new THREE.Mesh(c.body, bodyMat);
  const trim = new THREE.Mesh(c.trim, trimMat);
  const glass = new THREE.Mesh(c.glass, glassMat);
  const lights = new THREE.Mesh(c.lights, lightMat);
  body.castShadow = true;
  g.add(body, trim, glass, lights);
  g.userData = { body, trim, glass, lights };
  return g;
}
