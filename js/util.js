import * as THREE from 'three';

export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (a) => a[Math.floor(Math.random() * a.length)];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fmtMoney(p) {
  const neg = p < 0;
  p = Math.abs(Math.round(p));
  return (neg ? '-' : '') + '£' + Math.floor(p / 100) + '.' + String(p % 100).padStart(2, '0');
}

export function angleWrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function canvasTex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Matrix3();
const _c = new THREE.Color();
const geoCache = new Map();
function cg(key, fn) {
  let g = geoCache.get(key);
  if (!g) {
    g = fn();
    geoCache.set(key, g);
  }
  return g;
}

/** Accumulates many primitives into one BufferGeometry (with vertex colours). */
export class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.n = 0;
  }
  add(geom, matrix, color) {
    const p = geom.attributes.position,
      nn = geom.attributes.normal,
      u = geom.attributes.uv;
    if (matrix) _n.getNormalMatrix(matrix);
    if (color !== undefined && color !== null) _c.set(color);
    else _c.setRGB(1, 1, 1);
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i);
      if (matrix) _v.applyMatrix4(matrix);
      this.pos.push(_v.x, _v.y, _v.z);
      if (nn) {
        _v.fromBufferAttribute(nn, i);
        if (matrix) _v.applyMatrix3(_n).normalize();
        this.nor.push(_v.x, _v.y, _v.z);
      } else this.nor.push(0, 1, 0);
      if (u) this.uv.push(u.getX(i), u.getY(i));
      else this.uv.push(0, 0);
      this.col.push(_c.r, _c.g, _c.b);
    }
    if (geom.index) for (let i = 0; i < geom.index.count; i++) this.idx.push(this.n + geom.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(this.n + i);
    this.n += p.count;
  }
  // generic transformed geometry
  geo(geom, x, y, z, color, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.add(geom, _m, color);
  }
  box(cx, cy, cz, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) {
    const g = cg('box', () => new THREE.BoxGeometry(1, 1, 1));
    this.geo(g, cx, cy, cz, color, rx, ry, rz, sx, sy, sz);
  }
  cyl(cx, cy, cz, rt, rb, h, seg, color, rx = 0, ry = 0, rz = 0, open = false) {
    const g = cg(`cyl${rt},${rb},${h},${seg},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
    this.geo(g, cx, cy, cz, color, rx, ry, rz);
  }
  sphere(cx, cy, cz, r, color, ws = 12, hs = 8, sx = 1, sy = 1, sz = 1) {
    const g = cg(`sph${ws},${hs}`, () => new THREE.SphereGeometry(1, ws, hs));
    this.geo(g, cx, cy, cz, color, 0, 0, 0, r * sx, r * sy, r * sz);
  }
  dome(cx, cy, cz, r, color, sy = 1, seg = 16) {
    const g = cg(`dome${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(4, seg / 2), 0, Math.PI * 2, 0, Math.PI / 2));
    this.geo(g, cx, cy, cz, color, 0, 0, 0, r, r * sy, r);
  }
  cone(cx, cy, cz, r, h, seg, color, ry = 0) {
    const g = cg(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg));
    this.geo(g, cx, cy, cz, color, 0, ry, 0, r, h, r);
  }
  /** quad from 4 points (CCW seen from front) with uvs */
  quad(a, b, c, d, ua, ub, uc, ud, color) {
    _c.set(color === undefined ? 0xffffff : color);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1],
      ny = e1[2] * e2[0] - e1[0] * e2[2],
      nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const [p, uv] of [
      [a, ua],
      [b, ub],
      [c, uc],
      [d, ud],
    ]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.uv.push(uv[0], uv[1]);
      this.col.push(_c.r, _c.g, _c.b);
    }
    const n = this.n;
    this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    this.n += 4;
  }
  /** horizontal quad (top facing) with world-space uvs */
  flat(x0, z0, x1, z1, y, uvScale = 1, color) {
    const s = uvScale;
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [x0 / s, -z1 / s], [x1 / s, -z1 / s], [x1 / s, -z0 / s], [x0 / s, -z0 / s], color);
  }
  /** vertical wall from p to q (ground points [x,z]); front is to the right of p->q when seen from above w/ +z down */
  wall(px, pz, qx, qz, y0, y1, uScale, vScale, color, uOff = 0) {
    const len = Math.hypot(qx - px, qz - pz);
    const u0 = uOff / uScale,
      u1 = (uOff + len) / uScale;
    this.quad([px, y0, pz], [qx, y0, qz], [qx, y1, qz], [px, y1, pz], [u0, y0 / vScale], [u1, y0 / vScale], [u1, y1 / vScale], [u0, y1 / vScale], color);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
  mesh(material, shadows = true) {
    const m = new THREE.Mesh(this.build(), material);
    m.castShadow = shadows;
    m.receiveShadow = true;
    return m;
  }
}
