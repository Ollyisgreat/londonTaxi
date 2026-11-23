import * as THREE from 'three';
import { makeCanvas, canvasTex, seededRandom } from './util.js';

// A facade texture covers 8 bays x 8 floors. One bay = 4m wide, one floor = 3.6m.
export const BAY_W = 4, FLOOR_H = 3.6, BAYS = 8;
export const FACADE_U = BAY_W * BAYS, FACADE_V = FLOOR_H * BAYS;

const WALL = {
  brick: ['#7b3d2b', '#86442f', '#703726'],
  stock: ['#b39a6b', '#a68c5d', '#bda574'],
  stone: ['#d9d1be', '#cec5b0', '#e2dbc8'],
  render: ['#edece5', '#e5e3db', '#f3f2eb'],
  glass: ['#2b414f', '#2f4858', '#263a47'],
};

function noise(g, w, h, amt, r, count) {
  for (let i = 0; i < count; i++) {
    const v = Math.floor(r() * 255);
    g.fillStyle = `rgba(${v},${v},${v},${amt * r()})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

function glassGrad(g, x, y, w, h, r) {
  const gr = g.createLinearGradient(x, y, x + w * 0.6, y + h);
  const a = 30 + r() * 30;
  gr.addColorStop(0, `rgb(${a + 40},${a + 55},${a + 70})`);
  gr.addColorStop(0.5, `rgb(${a},${a + 12},${a + 22})`);
  gr.addColorStop(1, `rgb(${a + 20},${a + 30},${a + 42})`);
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
}

export function makeFacade(style, seed) {
  const r = seededRandom(seed);
  const S = 128, W = S * BAYS;
  const c = makeCanvas(W, W), g = c.getContext('2d');
  const e = makeCanvas(W, W), ge = e.getContext('2d');
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, W);
  // height map (for normals) and roughness/metalness map (G = roughness, B = metalness)
  const hc = makeCanvas(W, W), hg = hc.getContext('2d');
  const rc = makeCanvas(W, W), rg = rc.getContext('2d');
  hg.fillStyle = 'rgb(150,150,150)';
  hg.fillRect(0, 0, W, W);
  rg.fillStyle = 'rgb(0,235,0)';
  rg.fillRect(0, 0, W, W);
  const H = (v, x, y, w, h) => { hg.fillStyle = `rgb(${v},${v},${v})`; hg.fillRect(x, y, w, h); };
  const R = (rough, metal, x, y, w, h) => { rg.fillStyle = `rgb(0,${Math.round(rough * 255)},${Math.round(metal * 255)})`; rg.fillRect(x, y, w, h); };
  const wc = WALL[style];
  g.fillStyle = wc[0];
  g.fillRect(0, 0, W, W);
  // wall texture
  if (style === 'brick' || style === 'stock') {
    for (let y = 0; y < W; y += 4) {
      const off = (y / 4) % 2 ? 0 : 5;
      for (let x = -off; x < W; x += 10) {
        g.fillStyle = wc[Math.floor(r() * 3)];
        g.globalAlpha = 0.6;
        g.fillRect(x, y, 9, 3);
        if (x === -off) H(110, 0, y, W, 4);
        H(150 + Math.floor(r() * 20), x, y, 9, 3);
      }
    }
    g.globalAlpha = 1;
    noise(g, W, W, 0.25, r, 6000);
  } else if (style === 'stone') {
    noise(g, W, W, 0.15, r, 5000);
    g.strokeStyle = 'rgba(0,0,0,0.08)';
    for (let y = 0; y < W; y += 16) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
      H(120, 0, y, W, 1.5);
    }
  } else if (style === 'render') {
    noise(g, W, W, 0.08, r, 3000);
  }
  for (let fy = 0; fy < BAYS; fy++) {
    for (let bx = 0; bx < BAYS; bx++) {
      const x0 = bx * S, y0 = fy * S;
      const lit = r() < 0.38;
      const warm = r() < 0.7;
      const litCol = warm ? `rgb(255,${200 + Math.floor(r() * 40)},${120 + Math.floor(r() * 50)})` : `rgb(${200 + Math.floor(r() * 40)},${220 + Math.floor(r() * 30)},255)`;
      if (style === 'glass') {
        glassGrad(g, x0, y0, S, S, r);
        R(0.06, 0.6, x0, y0, S, S);
        R(0.6, 0.2, x0, y0 + S - 14, S, 14);
        H(175, x0, y0, 4, S);
        H(170, x0 + S / 2, y0, 3, S - 14);
        g.fillStyle = '#1b262e';
        g.fillRect(x0, y0 + S - 14, S, 14); // floor slab
        g.fillStyle = '#9aa7b0';
        g.fillRect(x0, y0, 3, S);
        g.fillRect(x0 + S / 2, y0, 2, S - 14);
        if (lit) {
          ge.fillStyle = warm ? '#fff3d6' : '#e6eeff';
          ge.globalAlpha = 0.5 + r() * 0.5;
          ge.fillRect(x0 + 3, y0, S - 3, S - 14);
          ge.globalAlpha = 1;
        }
        continue;
      }
      const ww = style === 'stone' ? 0.46 * S : style === 'render' ? 0.44 * S : 0.42 * S;
      const wh = style === 'stone' ? 0.62 * S : 0.6 * S;
      const wx = x0 + (S - ww) / 2, wy = y0 + 0.16 * S;
      // relief: surround raised, glass recessed
      H(style === 'render' ? 175 : 160, wx - 8, wy - 12, ww + 16, wh + 20);
      H(60, wx, wy, ww, wh);
      R(0.05, 0.15, wx, wy, ww, wh);
      // surround
      if (style === 'brick' || style === 'stock') {
        g.fillStyle = '#e8e2d2';
        g.fillRect(wx - 4, wy - 10, ww + 8, 10); // lintel
        g.fillRect(wx - 6, wy + wh, ww + 12, 6); // sill
        H(200, wx - 4, wy - 10, ww + 8, 10);
        H(205, wx - 6, wy + wh, ww + 12, 6);
      } else if (style === 'stone') {
        g.fillStyle = 'rgba(120,110,90,0.35)';
        g.fillRect(wx - 7, wy - 7, ww + 14, wh + 14);
        g.fillStyle = '#e7e0cf';
        g.fillRect(wx - 10, wy - 16, ww + 20, 9);
      } else {
        g.fillStyle = '#ffffff';
        g.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
      }
      glassGrad(g, wx, wy, ww, wh, r);
      // frames / sash bars
      for (const [fx, fy2, fw, fh] of [[wx, wy, ww, 3], [wx, wy + wh - 3, ww, 3], [wx, wy, 3, wh], [wx + ww - 3, wy, 3, wh], [wx, wy + wh / 2 - 2, ww, 4]]) { H(105, fx, fy2, fw, fh); R(0.5, 0, fx, fy2, fw, fh); }
      if (style !== 'stone') { H(95, wx + ww / 2 - 1, wy, 2, wh); R(0.5, 0, wx + ww / 2 - 1, wy, 2, wh); }
      g.fillStyle = style === 'stone' ? '#3a3a3a' : '#f4f4f0';
      g.fillRect(wx, wy, ww, 3);
      g.fillRect(wx, wy + wh - 3, ww, 3);
      g.fillRect(wx, wy, 3, wh);
      g.fillRect(wx + ww - 3, wy, 3, wh);
      g.fillRect(wx, wy + wh / 2 - 2, ww, 4);
      if (style !== 'stone') {
        g.fillRect(wx + ww / 2 - 1, wy, 2, wh);
        g.fillRect(wx, wy + wh / 4, ww, 2);
        g.fillRect(wx, wy + (wh * 3) / 4, ww, 2);
      }
      if (style === 'render' && fy % 2 === 0) {
        g.fillStyle = '#111';
        g.fillRect(wx - 8, wy + wh - 22, ww + 16, 3);
        for (let k = 0; k < ww + 16; k += 5) g.fillRect(wx - 8 + k, wy + wh - 22, 2, 22);
      }
      // curtains
      if (r() < 0.4) {
        g.fillStyle = ['#7b5a3a', '#556070', '#8a7a62', '#5b3b3b'][Math.floor(r() * 4)];
        g.globalAlpha = 0.5;
        g.fillRect(wx + 3, wy + 3, ww * 0.2, wh - 6);
        g.fillRect(wx + ww * 0.8 - 3, wy + 3, ww * 0.2, wh - 6);
        g.globalAlpha = 1;
      }
      if (lit) {
        ge.fillStyle = litCol;
        ge.globalAlpha = 0.55 + r() * 0.45;
        ge.fillRect(wx + 3, wy + 3, ww - 6, wh - 6);
        ge.globalAlpha = 1;
      }
    }
  }
  const map = canvasTex(c), em = canvasTex(e);
  const rough = canvasTex(rc);
  rough.colorSpace = THREE.NoColorSpace;
  const normal = canvasTex(heightToNormal(hc, 2.2));
  normal.colorSpace = THREE.NoColorSpace;
  return { map, em, rough, normal };
}

/** Convert a greyscale height canvas into a tangent-space normal map canvas. */
export function heightToNormal(hc, strength = 2) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h);
  const og = out.getContext('2d');
  const img = og.createImageData(w, h);
  const d = img.data;
  const at = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      d[i] = ((nx / l) * 0.5 + 0.5) * 255;
      d[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      d[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  og.putImageData(img, 0, 0);
  return out;
}

/** Tileable noise height canvas (sum of random blobs, wraps at edges). */
export function noiseHeight(size, seed, blobs = 3000, rMin = 1, rMax = 4, base = 128, amp = 60) {
  const r = seededRandom(seed);
  const c = makeCanvas(size, size), g = c.getContext('2d');
  g.fillStyle = `rgb(${base},${base},${base})`;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < blobs; i++) {
    const x = r() * size, y = r() * size, rad = rMin + r() * (rMax - rMin);
    const v = Math.floor(base + (r() - 0.5) * 2 * amp);
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.beginPath();
      g.arc(x + ox, y + oy, rad, 0, Math.PI * 2);
      g.fill();
    }
  }
  return c;
}

export function dataTex(canvas, repeat = true) {
  const t = canvasTex(canvas, repeat);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function makeWaterNormal() {
  const N = 256;
  const c = makeCanvas(N, N), g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const r = seededRandom(77);
  const waves = [];
  for (let k = 0; k < 14; k++) waves.push([1 + Math.floor(r() * 5), Math.floor(r() * 7) - 3, r() * 6.28, 0.3 + r() * 0.7]);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let dx = 0, dy = 0;
      for (const [kx, ky, ph, a] of waves) {
        const s = Math.cos(((kx * x + ky * y) / N) * Math.PI * 2 + ph) * a;
        dx += s * kx;
        dy += s * ky;
      }
      const nx = -dx * 0.05, ny = dy * 0.05, l = Math.hypot(nx, ny, 1);
      const i = (y * N + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return dataTex(c);
}

/** Soft radial gradient used for light pools on the ground. */
export function makeGlow(inner = 'rgba(255,214,150,1)', size = 128) {
  const c = makeCanvas(size, size), g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.45)'));
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return canvasTex(c, false);
}

const SHOPS = [
  ['THE RED LION', '#5a1a1a', '#e7c15a', 'pub'],
  ['NEWS & BOOZE', '#1d3d7a', '#ffffff', 'shop'],
  ['CAFFÈ ROMA', '#2e5d3a', '#f5efe0', 'cafe'],
  ['FISH & CHIPS', '#1c5b8a', '#ffe07a', 'shop'],
  ['PHARMACY', '#0f7a4b', '#ffffff', 'shop'],
  ['THE CROWN', '#1d2a3a', '#e7c15a', 'pub'],
  ['BAKERY', '#8a5a2b', '#fff6e0', 'cafe'],
  ['BUREAU DE CHANGE', '#c9a227', '#1a1a1a', 'shop'],
  ['KEBAB HOUSE', '#9a1c1c', '#ffffff', 'shop'],
  ['SOUVENIRS', '#c8102e', '#ffffff', 'shop'],
  ['BOOKS', '#2b2b2b', '#f0e6c8', 'shop'],
  ['MINI MART', '#3b7a2a', '#ffffff', 'shop'],
  ['THE KING\'S ARMS', '#183a2a', '#e7c15a', 'pub'],
  ['BARBER', '#222', '#ffffff', 'shop'],
  ['ESTATE AGENTS', '#4a2b6a', '#ffffff', 'shop'],
  ['TAILORS', '#20304a', '#d9c690', 'shop'],
];

export const SHOP_W = 6, SHOP_H = 4.5, SHOP_N = 8;
export function makeShops(seed) {
  const r = seededRandom(seed);
  const S = 256, W = S * SHOP_N, H = 192;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  const e = makeCanvas(W, H), ge = e.getContext('2d');
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  const list = SHOPS.slice().sort(() => r() - 0.5);
  for (let i = 0; i < SHOP_N; i++) {
    const [name, bg, fg, kind] = list[i];
    const x = i * S;
    g.fillStyle = kind === 'pub' ? bg : '#3a3632';
    g.fillRect(x, 0, S, H);
    // fascia
    g.fillStyle = bg;
    g.fillRect(x + 6, 10, S - 12, 34);
    g.fillStyle = fg;
    g.font = 'bold 22px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name, x + S / 2, 28, S - 24);
    ge.fillStyle = fg;
    ge.globalAlpha = 0.8;
    ge.font = 'bold 22px Georgia, serif';
    ge.textAlign = 'center';
    ge.textBaseline = 'middle';
    ge.fillText(name, x + S / 2, 28, S - 24);
    ge.globalAlpha = 1;
    // window + door
    const dx = r() < 0.5 ? x + 14 : x + S - 64;
    glassGrad(g, x + 10, 54, S - 20, 130, r);
    g.fillStyle = '#20201e';
    g.fillRect(dx, 54, 50, 138);
    g.fillStyle = 'rgba(160,190,200,0.35)';
    g.fillRect(dx + 6, 62, 38, 70);
    // goods in window
    for (let k = 0; k < 10; k++) {
      g.fillStyle = `hsl(${Math.floor(r() * 360)},50%,${40 + r() * 30}%)`;
      const gx = x + 16 + r() * (S - 40);
      if (gx > dx - 8 && gx < dx + 54) continue;
      g.fillRect(gx, 120 + r() * 40, 8 + r() * 14, 10 + r() * 20);
    }
    g.fillStyle = kind === 'pub' ? '#2a1a10' : '#555';
    g.fillRect(x, 48, S, 6);
    g.fillRect(x, 186, S, 6);
    g.fillRect(x, 0, 6, H);
    if (kind === 'pub') {
      g.fillStyle = '#7a2a2a';
      for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(x + 40 + k * 80, 58, 9, 0, Math.PI * 2); g.fill(); }
    }
    ge.fillStyle = kind === 'pub' ? '#ffcf80' : '#fff2d8';
    ge.globalAlpha = 0.75;
    ge.fillRect(x + 10, 54, S - 20, 130);
    ge.globalAlpha = 1;
    ge.fillStyle = '#000';
    ge.fillRect(dx, 54, 50, 138);
  }
  return { map: canvasTex(c), em: canvasTex(e) };
}

export function makeAsphalt() {
  const r = seededRandom(7);
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  g.fillStyle = '#3b3c3e';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = 40 + Math.floor(r() * 50);
    g.fillStyle = `rgba(${v},${v},${v + 2},0.5)`;
    g.fillRect(r() * 256, r() * 256, 1.5, 1.5);
  }
  for (let i = 0; i < 6; i++) {
    g.strokeStyle = 'rgba(20,20,20,0.35)';
    g.lineWidth = 1 + r() * 2;
    g.beginPath();
    let x = r() * 256, y = r() * 256;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 60; y += (r() - 0.5) * 60; g.lineTo(x, y); }
    g.stroke();
  }
  return canvasTex(c);
}

export function makePaving() {
  const r = seededRandom(9);
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  g.fillStyle = '#8d8a84';
  g.fillRect(0, 0, 256, 256);
  const s = 64;
  for (let y = 0; y < 256; y += s) for (let x = 0; x < 256; x += s) {
    const v = 150 + Math.floor(r() * 30);
    g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
    g.fillRect(x + 1, y + 1, s - 2, s - 2);
  }
  noise(g, 256, 256, 0.2, r, 3000);
  return canvasTex(c);
}

export function pavingHeight() {
  const r = seededRandom(19);
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  g.fillStyle = 'rgb(70,70,70)';
  g.fillRect(0, 0, 256, 256);
  const s = 64;
  for (let y = 0; y < 256; y += s) for (let x = 0; x < 256; x += s) {
    const v = 150 + Math.floor(r() * 25);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x + 2, y + 2, s - 4, s - 4);
  }
  return c;
}

export function noiseRough(size, seed, lo, hi) {
  const r = seededRandom(seed);
  const c = makeCanvas(size, size), g = c.getContext('2d');
  const base = Math.round(((lo + hi) / 2) * 255);
  g.fillStyle = `rgb(0,${base},0)`;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 400; i++) {
    const v = Math.round((lo + r() * (hi - lo)) * 255);
    g.fillStyle = `rgba(0,${v},0,0.35)`;
    const x = r() * size, y = r() * size, rad = 4 + r() * 22;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) { g.beginPath(); g.arc(x + ox, y + oy, rad, 0, Math.PI * 2); g.fill(); }
  }
  return c;
}

export function makeGrass() {
  const r = seededRandom(11);
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  g.fillStyle = '#4c6b32';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 12000; i++) {
    g.fillStyle = `hsla(${80 + r() * 30},${35 + r() * 25}%,${22 + r() * 22}%,0.6)`;
    g.fillRect(r() * 256, r() * 256, 1, 2 + r() * 2);
  }
  return canvasTex(c);
}

export function makeStreetSign(name, borough, code) {
  const c = makeCanvas(512, 140), g = c.getContext('2d');
  g.fillStyle = '#f7f7f2';
  g.fillRect(0, 0, 512, 140);
  g.strokeStyle = '#111';
  g.lineWidth = 8;
  g.strokeRect(8, 8, 496, 124);
  g.fillStyle = '#111';
  g.font = 'bold 46px Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const t = name.toUpperCase();
  g.fillText(t, code ? 230 : 256, 58, 400);
  if (code) {
    g.fillStyle = '#c8102e';
    g.fillText(code, 460, 58);
  }
  g.fillStyle = '#c8102e';
  g.fillRect(20, 92, 472, 3);
  g.font = 'bold 20px Arial, Helvetica, sans-serif';
  g.fillText(borough, 256, 114, 460);
  const t2 = canvasTex(c, false);
  return t2;
}

export function makeLabel(text, opts = {}) {
  const w = opts.w || 1024, h = opts.h || 128;
  const c = makeCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = opts.bg || '#1a1a1a';
  g.fillRect(0, 0, w, h);
  g.fillStyle = opts.fg || '#ffffff';
  g.font = `bold ${opts.size || 70}px ${opts.font || 'Georgia, serif'}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4, w - 30);
  return canvasTex(c, false);
}

export function drawClockFace(g, size, hours, minutes) {
  const r = size / 2;
  g.clearRect(0, 0, size, size);
  g.fillStyle = '#2b2416';
  g.fillRect(0, 0, size, size);
  g.save();
  g.translate(r, r);
  g.fillStyle = '#c9a24a';
  g.beginPath(); g.arc(0, 0, r * 0.98, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f2ead2';
  g.beginPath(); g.arc(0, 0, r * 0.86, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1a1a1a';
  g.lineWidth = size * 0.012;
  for (let k = 0; k < 12; k++) {
    g.beginPath(); g.arc(0, 0, r * (0.3 + (k % 3) * 0.17), 0, Math.PI * 2);
    if (k < 3) g.stroke();
  }
  g.fillStyle = '#1a1a1a';
  g.font = `bold ${size * 0.11}px Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const rn = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    g.save();
    g.rotate(a);
    g.fillText(rn[k], 0, -r * 0.7);
    g.restore();
  }
  const ha = ((hours % 12) + minutes / 60) / 12 * Math.PI * 2;
  const ma = (minutes / 60) * Math.PI * 2;
  g.lineCap = 'round';
  g.strokeStyle = '#111';
  g.lineWidth = size * 0.035;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(ha) * r * 0.45, -Math.cos(ha) * r * 0.45); g.stroke();
  g.lineWidth = size * 0.022;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(ma) * r * 0.75, -Math.cos(ma) * r * 0.75); g.stroke();
  g.restore();
}

export function makeSkyEnv(renderer, top, horizon, ground) {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { top: { value: new THREE.Color(top) }, hor: { value: new THREE.Color(horizon) }, gnd: { value: new THREE.Color(ground) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
    fragmentShader: 'uniform vec3 top; uniform vec3 hor; uniform vec3 gnd; varying vec3 vP; void main(){ float h=vP.y; vec3 c = h>0.0 ? mix(hor, top, pow(h,0.6)) : mix(hor, gnd, pow(-h,0.4)); gl_FragColor=vec4(c,1.0);} ',
  });
  scene.add(new THREE.Mesh(geo, mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.04);
  pm.dispose();
  geo.dispose();
  mat.dispose();
  return rt.texture;
}
