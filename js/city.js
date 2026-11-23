import * as THREE from 'three';
import {
  B, HALF_ROAD, INSET, NX, NZ, RIVER_ROW, RIVER_Z0, RIVER_Z1, BRIDGES, ROW_NAMES, COL_NAMES,
  LANDMARK_CELLS, PLACES, hasEdgeV, nodeId, postcode, borough,
} from './config.js';
import { GeoBuilder, seededRandom, makeCanvas, canvasTex, clamp } from './util.js';
import {
  makeFacade, makeShops, makeAsphalt, makePaving, makeGrass, makeStreetSign, makeLabel, drawClockFace,
  heightToNormal, noiseHeight, dataTex, makeWaterNormal, makeGlow, pavingHeight, noiseRough,
  FACADE_U, FACADE_V, SHOP_W, SHOP_H, SHOP_N,
} from './textures.js';

const STYLES = ['brick', 'stock', 'stone', 'render', 'glass'];
const DISTRICT_STYLES = {
  west: { render: 3, stone: 3, brick: 4 },
  central: { stone: 4, brick: 3, stock: 3 },
  city: { stone: 5, glass: 4, brick: 1 },
  east: { stock: 5, brick: 5 },
  south: { stock: 4, brick: 4, glass: 1, stone: 1 },
  southcity: { stock: 3, brick: 3, glass: 3, stone: 1 },
};
const HEIGHTS = { brick: [12, 19], stock: [11, 18], render: [14, 21], stone: [17, 28], glass: [24, 46] };
const CORNICE = { brick: '#d8d0bc', stock: '#e0d8c4', stone: '#e4dcc8', render: '#f4f3ee', glass: '#59636b' };

const C = {
  stone: '#d6ccb4', stoneD: '#b5aa90', gothic: '#cdb98a', lead: '#6f7f80', slate: '#4b4f57', gold: '#d9b23c',
  brick: '#8a4632', stock: '#b49a6a', black: '#191919', white: '#efefea', green: '#2f5d3a', roof: '#3c3f45',
  kerb: '#a3a097', gravel: '#cdbf9f', bronze: '#4a3b28', red: '#b3121f', water: '#2c4a55',
};

export function cellRect(bi, bj) {
  return { x0: bi * B + INSET, z0: bj * B + INSET, x1: (bi + 1) * B - INSET, z1: (bj + 1) * B - INSET, cx: (bi + 0.5) * B, cz: (bj + 0.5) * B };
}

export class City {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.obstacles = [];
    this.trees = [];
    this.lamps = [];
    this.phoneBoxes = [];
    this.postBoxes = [];
    this.animated = [];
    this.signs = new Map();
    this.nightMats = [];
    this.time = 0;
    this.makeMaterials();
    this.buildGraph();
    this.buildGround();
    this.buildCells();
    this.buildRing();
    this.buildBridges();
    this.buildFurniture();
    this.buildSignals();
    this.buildObstacles();
    this.finishBuilders();
    this.buildPlaces();
  }

  // ---------------------------------------------------------------- materials
  makeMaterials() {
    const std = (o) => new THREE.MeshStandardMaterial(o);
    this.mat = {};
    const asphaltN = dataTex(heightToNormal(noiseHeight(256, 3, 6000, 0.4, 1.6, 128, 70), 2.5));
    const asphaltR = dataTex(noiseRough(256, 5, 0.75, 1.0));
    this.mat.road = std({ map: makeAsphalt(), normalMap: asphaltN, normalScale: new THREE.Vector2(0.6, 0.6), roughnessMap: asphaltR, roughness: 1 });
    this.asphaltR = asphaltR;
    this.mat.pave = std({ map: makePaving(), normalMap: dataTex(heightToNormal(pavingHeight(), 3)), roughness: 0.85 });
    this.mat.grass = std({ map: makeGrass(), normalMap: dataTex(heightToNormal(noiseHeight(256, 8, 9000, 0.5, 1.5, 128, 90), 3)), roughness: 1 });
    this.mat.detail = std({ vertexColors: true, roughness: 0.82 });
    this.mat.dbl = std({ vertexColors: true, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide });
    this.mat.mark = std({ vertexColors: true, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.waterNormal = makeWaterNormal();
    this.waterNormal.repeat.set(1, 1);
    this.mat.water = new THREE.MeshPhysicalMaterial({ color: '#1f3a42', roughness: 0.06, metalness: 0.0, normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 0.3, envMapIntensity: 1.4 });
    this.mat.glass = std({ color: '#9cc0d6', roughness: 0.08, metalness: 0.9 });
    this.mat.fac = {};
    STYLES.forEach((s, i) => {
      const { map, em, rough, normal } = makeFacade(s, 100 + i * 17);
      const m = std({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0, roughnessMap: rough, metalnessMap: rough, roughness: 1, metalness: 1, normalMap: normal, normalScale: new THREE.Vector2(1, 1), envMapIntensity: 1.2 });
      this.mat.fac[s] = m;
      this.nightMats.push([m, 1.0]);
    });
    const sh = makeShops(55);
    this.mat.shop = std({ map: sh.map, emissiveMap: sh.em, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3, metalness: 0.1 });
    this.nightMats.push([this.mat.shop, 0.55]);
    this.mat.shop.emissive.set('#ffd9a8');
    this.mat.lampHead = std({ color: '#fff4d0', emissive: '#ffd890', emissiveIntensity: 0.1 });
    this.lampMat = this.mat.lampHead;

    this.b = {
      road: new GeoBuilder(), pave: new GeoBuilder(), grass: new GeoBuilder(), detail: new GeoBuilder(), dbl: new GeoBuilder(),
      mark: new GeoBuilder(), water: new GeoBuilder(), shop: new GeoBuilder(), glass: new GeoBuilder(),
    };
    this.fb = {};
    for (const s of STYLES) this.fb[s] = new GeoBuilder();
  }

  finishBuilders() {
    const add = (b, m, cast = true) => {
      if (b.n === 0) return;
      const mesh = b.mesh(m, cast);
      this.group.add(mesh);
      return mesh;
    };
    add(this.b.road, this.mat.road, false);
    add(this.b.pave, this.mat.pave, false);
    add(this.b.grass, this.mat.grass, false);
    add(this.b.mark, this.mat.mark, false);
    add(this.b.water, this.mat.water, false);
    add(this.b.detail, this.mat.detail);
    add(this.b.dbl, this.mat.dbl);
    add(this.b.shop, this.mat.shop);
    add(this.b.glass, this.mat.glass);
    for (const s of STYLES) add(this.fb[s], this.mat.fac[s]);
    for (const [key, sb] of this.signs) {
      const m = new THREE.MeshStandardMaterial({ map: sb.tex, roughness: 0.5 });
      add(sb.b, m, false);
    }
  }

  // ---------------------------------------------------------------- graph
  buildGraph() {
    this.nodes = [];
    for (let j = 0; j < NZ; j++)
      for (let i = 0; i < NX; i++) {
        const adj = [];
        if (i > 0) adj.push(nodeId(i - 1, j));
        if (i < NX - 1) adj.push(nodeId(i + 1, j));
        if (j > 0 && hasEdgeV(i, j - 1)) adj.push(nodeId(i, j - 1));
        if (j < NZ - 1 && hasEdgeV(i, j)) adj.push(nodeId(i, j + 1));
        const deg = adj.length;
        const signal = deg >= 3 && ((i + j) % 2 === 0 || (BRIDGES[i] !== undefined && (j === RIVER_ROW || j === RIVER_ROW + 1)));
        this.nodes.push({ id: nodeId(i, j), i, j, x: i * B, z: j * B, adj, signal, offset: (i * 7 + j * 11) % 24 });
      }
  }

  /** traffic light state for traffic moving along an axis ('x' or 'z') at node */
  lightState(node, axis, t = this.time) {
    if (!node.signal) return 'N';
    let p = (t + node.offset) % 24;
    if (axis === 'x') p = (p + 12) % 24;
    if (p < 9) return 'G';
    if (p < 11.5) return 'A';
    if (p < 22.5) return 'R';
    return 'RA';
  }

  // ---------------------------------------------------------------- ground & roads
  buildGround() {
    const R = this.b.road, M = this.b.mark;
    const xMax = (NX - 1) * B, zMax = (NZ - 1) * B;
    // big ground beyond / under city
    R.flat(-900, -900, xMax + 900, RIVER_Z0, -0.03, 8);
    R.flat(-900, RIVER_Z1, xMax + 900, zMax + 900, -0.03, 8);
    // river
    this.b.water.flat(-900, RIVER_Z0 - 1, xMax + 900, RIVER_Z1 + 1, -2.2, 10);
    const D = this.b.detail;
    D.wall(-900, RIVER_Z0, xMax + 900, RIVER_Z0, -2.3, -0.02, 1, 1, '#8c857a');
    D.wall(xMax + 900, RIVER_Z1, -900, RIVER_Z1, -2.3, -0.02, 1, 1, '#8c857a');
    // E-W roads
    for (let j = 0; j < NZ; j++) R.flat(-HALF_ROAD, j * B - HALF_ROAD, xMax + HALF_ROAD, j * B + HALF_ROAD, 0, 8);
    // N-S segments
    for (let i = 0; i < NX; i++)
      for (let j = 0; j < NZ - 1; j++)
        if (hasEdgeV(i, j)) R.flat(i * B - HALF_ROAD, j * B + HALF_ROAD, i * B + HALF_ROAD, (j + 1) * B - HALF_ROAD, 0, 8);

    // markings
    const white = '#e9e9e4', yellow = '#e3bd26';
    const seg = (ax, az, bx, bz, isBridge) => {
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      const lx = dz, lz = -dx; // left of a->b
      const y = 0.015;
      // centre dashes
      for (let s = 10; s < len - 10; s += 9) {
        const e = Math.min(s + 4, len - 10);
        const p0x = ax + dx * s, p0z = az + dz * s, p1x = ax + dx * e, p1z = az + dz * e;
        M.flat(Math.min(p0x, p1x) - Math.abs(lx) * 0.07, Math.min(p0z, p1z) - Math.abs(lz) * 0.07, Math.max(p0x, p1x) + Math.abs(lx) * 0.07, Math.max(p0z, p1z) + Math.abs(lz) * 0.07, y, 1, white);
      }
      if (isBridge) return;
      // double yellow lines along both kerbs
      for (const side of [-1, 1]) for (const off of [6.45, 6.7]) {
        const o = side * off;
        const s0 = 9, s1 = len - 9;
        const x0 = ax + dx * s0 + lx * o, z0 = az + dz * s0 + lz * o, x1 = ax + dx * s1 + lx * o, z1 = az + dz * s1 + lz * o;
        M.flat(Math.min(x0, x1) - Math.abs(lx) * 0.05, Math.min(z0, z1) - Math.abs(lz) * 0.05, Math.max(x0, x1) + Math.abs(lx) * 0.05, Math.max(z0, z1) + Math.abs(lz) * 0.05, y, 1, yellow);
      }
    };
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX - 1; i++) seg(i * B, j * B, (i + 1) * B, j * B, false);
    for (let i = 0; i < NX; i++) for (let j = 0; j < NZ - 1; j++) if (hasEdgeV(i, j)) seg(i * B, j * B, i * B, (j + 1) * B, j === RIVER_ROW);
    // stop lines at signals
    for (const n of this.nodes) {
      if (!n.signal) continue;
      for (const a of n.adj) {
        const o = this.nodes[a];
        const dx = Math.sign(n.x - o.x), dz = Math.sign(n.z - o.z); // direction of travel into node
        const lx = dz, lz = -dx;
        const cx = n.x - dx * 8.5, cz = n.z - dz * 8.5;
        const ex = cx + lx * 6.8, ez = cz + lz * 6.8;
        M.flat(Math.min(cx, ex) - Math.abs(dx) * 0.2, Math.min(cz, ez) - Math.abs(dz) * 0.2, Math.max(cx, ex) + Math.abs(dx) * 0.2, Math.max(cz, ez) + Math.abs(dz) * 0.2, 0.016, 1, white);
        // zebra-ish pedestrian crossing studs (two dashed lines) beyond stop line
        for (let k = -6.5; k <= 6.5; k += 1.3) {
          const px = n.x - dx * 7.5 + lx * k, pz = n.z - dz * 7.5 + lz * k;
          M.flat(px - 0.3 - Math.abs(dx) * 0.0, pz - 0.3, px + 0.3, pz + 0.3, 0.016, 1, '#cfcfca');
        }
      }
    }
    // yellow box junctions at a few big junctions
    for (const [i, j] of [[3, 3], [4, 4], [8, 2], [10, 4], [5, 1], [6, 9]]) {
      const x = i * B, z = j * B;
      const L = 6.5;
      for (let k = -L; k <= L; k += 2.6) {
        M.flat(x - L, z + k - 0.08, x + L, z + k + 0.08, 0.017, 1, yellow);
        M.flat(x + k - 0.08, z - L, x + k + 0.08, z + L, 0.017, 1, yellow);
      }
    }
  }

  pavement(x0, z0, x1, z1) {
    const h = 0.15;
    this.b.pave.flat(x0, z0, x1, z1, h, 4);
    const D = this.b.detail;
    D.wall(x0, z1, x1, z1, 0, h, 1, 1, C.kerb);
    D.wall(x1, z1, x1, z0, 0, h, 1, 1, C.kerb);
    D.wall(x1, z0, x0, z0, 0, h, 1, 1, C.kerb);
    D.wall(x0, z0, x0, z1, 0, h, 1, 1, C.kerb);
  }

  // ---------------------------------------------------------------- buildings
  addBuilding(x0, z0, x1, z1, h, style, outer, shop, r) {
    const fb = this.fb[style];
    const uOff = Math.floor(r() * 8) * 4;
    const vOff = Math.floor(r() * 8) * 3.6;
    const walls = [
      ['S', x0, z1, x1, z1],
      ['E', x1, z1, x1, z0],
      ['N', x1, z0, x0, z0],
      ['W', x0, z0, x0, z1],
    ];
    for (const [side, px, pz, qx, qz] of walls) {
      const len = Math.hypot(qx - px, qz - pz);
      const u0 = uOff / FACADE_U, u1 = (uOff + len) / FACADE_U;
      let yb = 0;
      if (shop && side === outer && style !== 'glass') {
        const su = Math.floor(r() * SHOP_N) * SHOP_W;
        this.b.shop.quad([px, 0, pz], [qx, 0, qz], [qx, SHOP_H, qz], [px, SHOP_H, pz], [su / (SHOP_W * SHOP_N), 0], [(su + len) / (SHOP_W * SHOP_N), 0], [(su + len) / (SHOP_W * SHOP_N), 1], [su / (SHOP_W * SHOP_N), 1]);
        yb = SHOP_H;
      }
      const v0 = (yb + vOff) / FACADE_V, v1 = (h + vOff) / FACADE_V;
      fb.quad([px, yb, pz], [qx, yb, qz], [qx, h, qz], [px, h, pz], [u0, v0], [u1, v0], [u1, v1], [u0, v1]);
    }
    const D = this.b.detail;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    if (style !== 'glass') {
      D.box(cx, h - 0.35, cz, w + 0.4, 0.7, d + 0.4, CORNICE[style]);
      D.flat(x0, z0, x1, z1, h + 0.02, 1, '#55575c');
      if (r() < 0.45 && h < 24) {
        // mansard attic storey
        D.box(cx, h + 1.4, cz, w - 2.4, 2.8, d - 2.4, '#4a4f58');
      }
      const nch = 1 + Math.floor(r() * 2.5);
      for (let k = 0; k < nch; k++) {
        const chx = x0 + 1.5 + r() * (w - 3), chz = z0 + 1.5 + r() * (d - 3);
        const col = style === 'stone' ? '#bdb39c' : style === 'render' ? '#e8e6de' : '#7a3e2c';
        D.box(chx, h + 1.6, chz, 2.4, 3.2, 0.9, col);
        for (let p = 0; p < 3; p++) D.cyl(chx - 0.7 + p * 0.7, h + 3.5, chz, 0.16, 0.2, 0.6, 6, '#b5653b');
      }
    } else {
      D.flat(x0, z0, x1, z1, h + 0.02, 1, '#3d4248');
      D.box(cx, h + 1.5, cz, w * 0.5, 3, d * 0.5, '#6c7177');
    }
  }

  pickStyle(dist, r, prev) {
    if (prev && r() < 0.55) return prev;
    const w = DISTRICT_STYLES[dist];
    let tot = 0;
    for (const k in w) tot += w[k];
    let x = r() * tot;
    for (const k in w) {
      x -= w[k];
      if (x <= 0) return k;
    }
    return 'brick';
  }

  district(bi, bj) {
    if (bj > RIVER_ROW) return bi >= 8 ? 'southcity' : 'south';
    if (bi >= 11) return 'east';
    if (bi >= 8) return 'city';
    if (bi <= 3) return 'west';
    return 'central';
  }

  fillGeneric(rect, dist, r, opts = {}) {
    const sides = opts.sides || ['N', 'S', 'E', 'W'];
    const D0 = opts.depth || 14 + r() * 6;
    const { x0, z0, x1, z1 } = rect;
    const strips = [];
    const hasN = sides.includes('N'), hasS = sides.includes('S');
    if (hasN) strips.push(['N', x0, z0, x1, z0 + D0, 'x']);
    if (hasS) strips.push(['S', x0, z1 - D0, x1, z1, 'x']);
    const zs = hasN ? z0 + D0 : z0, ze = hasS ? z1 - D0 : z1;
    if (sides.includes('W')) strips.push(['W', x0, zs, x0 + D0, ze, 'z']);
    if (sides.includes('E')) strips.push(['E', x1 - D0, zs, x1, ze, 'z']);
    for (const [side, sx0, sz0, sx1, sz1, ax] of strips) {
      let prev = null;
      const len = ax === 'x' ? sx1 - sx0 : sz1 - sz0;
      let s = 0;
      let prevH = 0;
      while (s < len - 0.5) {
        let w = 7 + r() * 10;
        if (len - s - w < 6) w = len - s;
        const style = opts.style || this.pickStyle(dist, r, prev);
        const [hmin, hmax] = HEIGHTS[style];
        let h = prev === style && r() < 0.6 ? prevH : hmin + r() * (hmax - hmin);
        if (opts.minH) h = Math.max(h, opts.minH);
        if (opts.maxH) h = Math.min(h, opts.maxH);
        const bx0 = ax === 'x' ? sx0 + s : sx0, bx1 = ax === 'x' ? sx0 + s + w : sx1;
        const bz0 = ax === 'z' ? sz0 + s : sz0, bz1 = ax === 'z' ? sz0 + s + w : sz1;
        this.addBuilding(bx0, bz0, bx1, bz1, h, style, side, opts.noShops ? false : r() < 0.6, r);
        prev = style;
        prevH = h;
        s += w;
      }
    }
    if (opts.tower) {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hw = 10 + r() * 5;
      this.addBuilding(cx - hw, cz - hw, cx + hw, cz + hw, 45 + r() * 50, 'glass', 'S', false, r);
    }
  }

  buildCells() {
    for (let bj = 0; bj < NZ - 1; bj++)
      for (let bi = 0; bi < NX - 1; bi++) {
        if (bj === RIVER_ROW) continue;
        const rect = cellRect(bi, bj);
        this.pavement(bi * B + HALF_ROAD, bj * B + HALF_ROAD, (bi + 1) * B - HALF_ROAD, (bj + 1) * B - HALF_ROAD);
        const key = LANDMARK_CELLS[bi + ',' + bj];
        const r = seededRandom(bi * 131 + bj * 977 + 5);
        const dist = this.district(bi, bj);
        if (!key) {
          this.fillGeneric(rect, dist, r, { tower: dist === 'city' && r() < 0.5 || dist === 'southcity' && r() < 0.25 });
          this.cornerSigns(bi, bj);
          continue;
        }
        const fn = this['lm_' + key];
        if (fn) fn.call(this, rect, r, bi, bj);
        else this.fillGeneric(rect, dist, r);
      }
  }

  buildRing() {
    // a ring of buildings around the playable area so the city doesn't end in a void
    for (let bj = -1; bj < NZ; bj++)
      for (let bi = -1; bi < NX; bi++) {
        const ring = bi === -1 || bj === -1 || bi === NX - 1 || bj === NZ - 1;
        if (!ring || bj === RIVER_ROW) continue;
        let x0 = bi * B, z0 = bj * B, x1 = (bi + 1) * B, z1 = (bj + 1) * B;
        if (bi === -1) x1 = -INSET;
        if (bi === NX - 1) x0 = (NX - 1) * B + INSET;
        if (bj === -1) z1 = -INSET;
        if (bj === NZ - 1) z0 = (NZ - 1) * B + INSET;
        if (bj === RIVER_ROW - 1) z1 = Math.min(z1, RIVER_Z0 - 5);
        if (bj === RIVER_ROW + 1) z0 = Math.max(z0, RIVER_Z1 + 5);
        const px0 = bi === -1 ? x0 : x0 - 5, px1 = bi === NX - 1 ? x1 : x1 + 5;
        const pz0 = bj === -1 ? z0 : z0 - 5, pz1 = bj === NZ - 1 ? z1 : z1 + 5;
        this.pavement(Math.max(px0, x0 - 5), Math.max(pz0, z0 - 5), Math.min(px1, x1 + 5), Math.min(pz1, z1 + 5));
        const r = seededRandom((bi + 5) * 71 + (bj + 5) * 313);
        const bjc = clamp(bj, 0, NZ - 2), bic = clamp(bi, 0, NX - 2);
        this.fillGeneric({ x0, z0, x1, z1 }, this.district(bic, bjc), r, { depth: Math.min(x1 - x0, z1 - z0) / 2 - 0.5, noShops: true });
      }
  }

  // ---------------------------------------------------------------- street name signs
  sign(name, x, z, faceX, faceZ) {
    const bor = borough(x, z), pc = postcode(x, z);
    const key = name + '|' + bor + '|' + pc;
    let s = this.signs.get(key);
    if (!s) {
      s = { b: new GeoBuilder(), tex: makeStreetSign(name, bor, pc) };
      this.signs.set(key, s);
    }
    // plane facing (faceX, faceZ), 2.6m wide, 0.7m tall
    const w = 1.3, hx = faceZ, hz = -faceX;
    const cx = x + faceX * 0.06, cz = z + faceZ * 0.06;
    const a = [cx - hx * w, 3.0, cz - hz * w], b = [cx + hx * w, 3.0, cz + hz * w];
    s.b.quad(a, b, [b[0], 3.7, b[2]], [a[0], 3.7, a[2]], [0, 0], [1, 0], [1, 1], [0, 1]);
  }

  cornerSigns(bi, bj) {
    const r = cellRect(bi, bj);
    // NW corner of this block: north face shows the row street, west face the column street
    if ((bi + bj) % 2 === 0) {
      this.sign(ROW_NAMES[bj], r.x0 + 4, r.z0, 0, -1);
      this.sign(COL_NAMES[bi], r.x0, r.z0 + 4, -1, 0);
    } else {
      this.sign(ROW_NAMES[bj + 1], r.x1 - 4, r.z1, 0, 1);
      this.sign(COL_NAMES[bi + 1], r.x1, r.z1 - 4, 1, 0);
    }
  }

  // ---------------------------------------------------------------- helpers for landmarks
  beam(B_, a, b, rad, color, seg = 6) {
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(rad, rad, len, seg);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1));
    B_.add(g, m, color);
  }
  prism(cx, cy, cz, len, w, h, color, alongX = true) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(0, h);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
    g.translate(0, 0, -len / 2);
    if (alongX) this.b.detail.geo(g, cx, cy, cz, color, 0, Math.PI / 2, 0);
    else this.b.detail.geo(g, cx, cy, cz, color);
  }
  arch(B_, cx, cy, cz, r, len, color, alongX) {
    const g = new THREE.CylinderGeometry(r, r, len, 24, 1, true, -Math.PI / 2, Math.PI);
    B_.geo(g, cx, cy, cz, color, -Math.PI / 2, alongX ? Math.PI / 2 : 0, 0);
  }
  label(text, x, y, z, w, h, ry, opts = {}) {
    const tex = makeLabel(text, opts);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.5 }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    this.group.add(m);
    this.nightMats.push([m.material, opts.glow || 0.8, 0.1]);
    return m;
  }
  grassArea(x0, z0, x1, z1) {
    this.b.grass.flat(x0, z0, x1, z1, 0.2, 10);
  }
  railing(x0, z0, x1, z1, color = C.black, h = 1.1) {
    const D = this.b.detail;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ang = Math.atan2(x1 - x0, z1 - z0);
    D.box((x0 + x1) / 2, h, (z0 + z1) / 2, 0.08, 0.08, len, color, ang);
    D.box((x0 + x1) / 2, 0.35, (z0 + z1) / 2, 0.08, 0.08, len, color, ang);
    const n = Math.floor(len / 0.6);
    for (let k = 0; k <= n; k += 1) {
      const t = k / n;
      D.box(x0 + (x1 - x0) * t, h / 2 + 0.1, z0 + (z1 - z0) * t, 0.04, h, 0.04, color);
    }
  }
  tree(x, z, s = 1) {
    this.trees.push([x, z, s]);
  }
  makeClockTexture() {
    if (!this.clockCanvas) {
      this.clockCanvas = makeCanvas(256, 256);
      drawClockFace(this.clockCanvas.getContext('2d'), 256, 10, 10);
      this.clockTex = canvasTex(this.clockCanvas, false);
      this.clockMat = new THREE.MeshStandardMaterial({ map: this.clockTex, emissiveMap: this.clockTex, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.5 });
      this.nightMats.push([this.clockMat, 0.9, 0.05]);
    }
    return this.clockMat;
  }
  clockFaces(x, y, z, half, size) {
    const mat = this.makeClockTexture();
    const geo = new THREE.PlaneGeometry(size, size);
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x + Math.sin(a) * half, y, z + Math.cos(a) * half);
      m.rotation.y = a;
      this.group.add(m);
    }
  }
  station(rect, name, style, front, roofColor = '#7d8f9b') {
    const { x0, z0, x1, z1 } = rect;
    const r = seededRandom(name.length * 99);
    const dep = 16;
    let fr;
    if (front === 'S') fr = [x0, z1 - dep, x1, z1];
    else if (front === 'N') fr = [x0, z0, x1, z0 + dep];
    else if (front === 'W') fr = [x0, z0, x0 + dep, z1];
    else fr = [x1 - dep, z0, x1, z1];
    this.addBuilding(fr[0], fr[1], fr[2], fr[3], 20, style, front, false, r);
    // shed
    const alongX = front === 'W' || front === 'E';
    if (alongX) {
      const sx0 = front === 'W' ? x0 + dep : x0, sx1 = front === 'W' ? x1 : x1 - dep;
      for (let k = 0; k < 2; k++) {
        const cz = z0 + (z1 - z0) * (0.25 + k * 0.5);
        this.arch(this.b.dbl, (sx0 + sx1) / 2, 12, cz, (z1 - z0) / 4, sx1 - sx0, roofColor, true);
      }
      this.b.detail.box((sx0 + sx1) / 2, 6, (z0 + z1) / 2, sx1 - sx0, 12, z1 - z0 - 1, '#6d6259');
    } else {
      const sz0 = front === 'N' ? z0 + dep : z0, sz1 = front === 'N' ? z1 : z1 - dep;
      for (let k = 0; k < 2; k++) {
        const cx = x0 + (x1 - x0) * (0.25 + k * 0.5);
        this.arch(this.b.dbl, cx, 12, (sz0 + sz1) / 2, (x1 - x0) / 4, sz1 - sz0, roofColor, false);
      }
      this.b.detail.box((x0 + x1) / 2, 6, (sz0 + sz1) / 2, x1 - x0 - 1, 12, sz1 - sz0, '#6d6259');
    }
    // name board on the front
    const cx = (fr[0] + fr[2]) / 2, cz = (fr[1] + fr[3]) / 2;
    const off = { S: [0, dep / 2 + 0.1, 0], N: [0, -dep / 2 - 0.1, Math.PI], W: [-dep / 2 - 0.1, 0, -Math.PI / 2], E: [dep / 2 + 0.1, 0, Math.PI / 2] }[front];
    const lx = front === 'W' || front === 'E' ? cx + off[0] : cx, lz = front === 'S' || front === 'N' ? cz + off[1] : cz;
    this.label(name.toUpperCase(), lx, 7, lz, 24, 2.6, off[2], { bg: '#1b2a5a', fg: '#ffffff', font: 'Arial, sans-serif', size: 64 });
    // canopy
    const D = this.b.detail;
    if (front === 'S' || front === 'N') D.box(cx, 4.6, lz + (front === 'S' ? 1.5 : -1.5), x1 - x0 - 10, 0.3, 3, '#2b2b2b');
    else D.box(lx + (front === 'E' ? 1.5 : -1.5), 4.6, cz, 3, 0.3, z1 - z0 - 10, '#2b2b2b');
  }

  // ---------------------------------------------------------------- landmarks
  lm_park(rect, r, bi, bj) {
    const { x0, z0, x1, z1 } = rect;
    this.grassArea(x0, z0, x1, z1);
    this.railing(x0, z0, x1, z0); this.railing(x1, z0, x1, z1); this.railing(x1, z1, x0, z1); this.railing(x0, z1, x0, z0);
    const D = this.b.detail;
    // gravel paths
    D.flat(x0, (z0 + z1) / 2 - 1.5, x1, (z0 + z1) / 2 + 1.5, 0.22, 1, C.gravel);
    D.flat((x0 + x1) / 2 - 1.5, z0, (x0 + x1) / 2 + 1.5, z1, 0.22, 1, C.gravel);
    const lake = (bi === 0 && bj === 3) || (bi === 3 && bj === 4);
    if (lake) {
      const g = new THREE.CircleGeometry(1, 40);
      this.b.water.geo(g, (x0 + x1) / 2 + 12, 0.25, (z0 + z1) / 2 + 14, null, -Math.PI / 2, 0, 0, 22, 12, 1);
    }
    for (let k = 0; k < 16; k++) {
      const x = x0 + 4 + r() * (x1 - x0 - 8), z = z0 + 4 + r() * (z1 - z0 - 8);
      if (Math.abs(x - (x0 + x1) / 2) < 4 || Math.abs(z - (z0 + z1) / 2) < 4) continue;
      if (lake && Math.hypot((x - (x0 + x1) / 2 - 12) / 26, (z - (z0 + z1) / 2 - 14) / 16) < 1) continue;
      this.tree(x, z, 0.9 + r() * 0.7);
    }
    // benches
    for (let k = 0; k < 4; k++) D.box((x0 + x1) / 2 + 4, 0.65, z0 + 10 + k * 16, 0.6, 0.15, 1.8, '#5a3d22');
    if (bi === 1 && bj === 2) {
      // Marble Arch
      const ax = x1 - 10, az = z0 + 10;
      D.box(ax - 4, 5, az, 3, 10, 4, C.white);
      D.box(ax + 4, 5, az, 3, 10, 4, C.white);
      D.box(ax, 11, az, 12, 3, 4.4, C.white);
    }
  }

  lm_paddington(rect) { this.station(rect, 'Paddington', 'stock', 'E'); }
  lm_liverpoolst(rect) { this.station(rect, 'Liverpool Street', 'brick', 'S'); }
  lm_waterloo(rect) { this.station(rect, 'Waterloo', 'stone', 'W'); }
  lm_londonbridge(rect) { this.station(rect, 'London Bridge', 'glass', 'S', '#9fb4bf'); }
  lm_kingscross(rect) {
    this.station(rect, "King's Cross", 'stock', 'S');
    const cx = (rect.x0 + rect.x1) / 2, z = rect.z1 - 8;
    const D = this.b.detail;
    D.box(cx, 15, z, 7, 30, 7, C.stock);
    D.cone(cx, 32.5, z, 4.6, 5, 4, C.slate, Math.PI / 4);
    this.clockFaces(cx, 26, z, 3.56, 4.4);
  }

  lm_museum(rect, r) {
    const { x0, z0, x1, z1 } = rect;
    const D = this.b.detail;
    this.addBuilding(x0, z0, x1, z0 + 20, 20, 'stone', 'N', false, r);
    this.addBuilding(x0, z0 + 20, x0 + 16, z1 - 10, 20, 'stone', 'W', false, r);
    this.addBuilding(x1 - 16, z0 + 20, x1, z1 - 10, 20, 'stone', 'E', false, r);
    // great court roof
    D.dome((x0 + x1) / 2, 18, (z0 + z1) / 2 - 2, 14, '#c9d4da', 0.35);
    // portico
    const pz = z1 - 6;
    D.box((x0 + x1) / 2, 0.8, pz, 44, 1.6, 10, C.stone);
    for (let k = 0; k < 12; k++) D.cyl(x0 + 18 + k * 3.7, 9, pz + 3, 0.7, 0.8, 14, 12, C.white);
    D.box((x0 + x1) / 2, 16.6, pz, 44, 1.5, 10, C.stone);
    this.prism((x0 + x1) / 2, 17.3, pz, 10, 44, 5, C.stone, false);
    D.box((x0 + x1) / 2, 9, z1 - 14, 44, 18, 6, C.stoneD);
    this.label('THE BRITISH MUSEUM', (x0 + x1) / 2, 2.6, z1 + 0.05, 16, 1.4, 0, { bg: '#e8e1cf', fg: '#222', size: 60 });
  }

  lm_piccadilly(rect, r) {
    this.fillGeneric(rect, 'west', r, { minH: 22, maxH: 26, style: 'stone' });
    // the famous curved screens at the corner
    const c = makeCanvas(1024, 256);
    this.billboard = { canvas: c, g: c.getContext('2d'), tex: canvasTex(c, false), t: 0, frame: 0 };
    const mat = new THREE.MeshBasicMaterial({ map: this.billboard.tex, toneMapped: false });
    const { x0, z0 } = rect;
    const g1 = new THREE.PlaneGeometry(30, 10);
    const m1 = new THREE.Mesh(g1, mat);
    m1.position.set(x0 + 16, 13, z0 - 0.25);
    m1.rotation.y = Math.PI;
    const g2 = new THREE.PlaneGeometry(30, 10);
    const uv = g2.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + 0.5);
    const uv1 = g1.attributes.uv;
    for (let i = 0; i < uv1.count; i++) uv1.setX(i, uv1.getX(i) * 0.5);
    const m2 = new THREE.Mesh(g2, mat);
    m2.position.set(x0 - 0.25, 13, z0 + 16);
    m2.rotation.y = -Math.PI / 2;
    this.group.add(m1, m2);
    this.drawBillboard();
    // Eros fountain on the corner pavement
    const D = this.b.detail;
    D.cyl(x0 - 2.5, 0.6, z0 - 2.5, 2.2, 2.6, 1.2, 16, C.bronze);
    D.cyl(x0 - 2.5, 2.4, z0 - 2.5, 0.5, 0.8, 3, 10, C.bronze);
    D.sphere(x0 - 2.5, 4.4, z0 - 2.5, 0.5, '#3b5a4c');
  }

  drawBillboard() {
    const bb = this.billboard;
    if (!bb) return;
    const g = bb.g;
    const ads = [
      ['#c8102e', '#fff', 'MIND THE GAP'], ['#0a3d91', '#ffd200', 'FISH & CHIPS'], ['#111', '#00e0ff', 'WEST END SHOWS'],
      ['#ffd200', '#111', 'TEA. PROPER.'], ['#1d7a3a', '#fff', 'LONDON 24/7'], ['#7a1fa2', '#fff', 'CABBIE FM 101.1'],
      ['#ff5a00', '#fff', 'DOUBLE DECKER COLA'], ['#e5e5e5', '#c8102e', 'KEEP CALM & HAIL A CAB'],
    ];
    for (let p = 0; p < 4; p++) {
      const a = ads[(bb.frame + p * 3) % ads.length];
      const x = p * 256;
      g.fillStyle = a[0];
      g.fillRect(x, 0, 256, 256);
      g.fillStyle = a[1];
      g.font = 'bold 40px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const words = a[2].split(' ');
      words.forEach((w, i) => g.fillText(w, x + 128, 128 + (i - (words.length - 1) / 2) * 46, 236));
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(x + 254, 0, 2, 256);
    }
    bb.tex.needsUpdate = true;
  }

  lm_harrods(rect, r) {
    const { x0, z0, x1, z1 } = rect;
    this.addBuilding(x0, z0, x1, z1, 26, 'brick', 'N', false, r);
    const D = this.b.detail;
    const cx = (x0 + x1) / 2;
    D.box(cx, 30, z0 + 8, 10, 8, 10, '#a8553a');
    D.dome(cx, 34, z0 + 8, 5.5, '#4f7a64', 1.3);
    D.cone(cx, 41.5, z0 + 8, 0.6, 3, 8, C.gold);
    for (let k = 0; k < 10; k++) D.box(x0 + 5 + k * 7.4, 4.2, z0 - 0.8, 5.5, 0.3, 1.8, '#1f4d2b', 0, 0.35);
    this.label('HARRODS', cx, 22, z0 - 0.1, 18, 3, Math.PI, { bg: '#1f4d2b', fg: '#d9b23c', size: 90, glow: 1.4 });
  }

  lm_palace(rect, r) {
    const { x0, z0, x1, z1 } = rect;
    const D = this.b.detail;
    D.flat(x0, z0, x1, z0 + 20, 0.2, 1, C.gravel);
    this.addBuilding(x0 + 2, z0 + 20, x1 - 2, z0 + 50, 24, 'stone', 'N', false, r);
    this.grassArea(x0, z0 + 50, x1, z1);
    const cx = (x0 + x1) / 2;
    // portico
    for (let k = 0; k < 6; k++) D.cyl(cx - 9 + k * 3.6, 10, z0 + 19, 0.7, 0.75, 16, 12, C.white);
    this.prism(cx, 24, z0 + 20, 3, 24, 4, C.stone, false);
    // forecourt railings (black & gold)
    this.railing(x0, z0 + 1, x1, z0 + 1, '#151515', 2.2);
    for (let k = 0; k < 8; k++) D.sphere(x0 + 4 + k * 9.6, 2.5, z0 + 1, 0.2, C.gold);
    // flag
    D.cyl(cx, 30, z0 + 35, 0.12, 0.12, 12, 6, '#ddd');
    const fc = makeCanvas(128, 64), g = fc.getContext('2d');
    g.fillStyle = '#012169'; g.fillRect(0, 0, 128, 64);
    g.strokeStyle = '#fff'; g.lineWidth = 12; g.beginPath(); g.moveTo(0, 0); g.lineTo(128, 64); g.moveTo(128, 0); g.lineTo(0, 64); g.stroke();
    g.strokeStyle = '#c8102e'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#fff'; g.fillRect(52, 0, 24, 64); g.fillRect(0, 22, 128, 20);
    g.fillStyle = '#c8102e'; g.fillRect(57, 0, 14, 64); g.fillRect(0, 26, 128, 12);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshStandardMaterial({ map: canvasTex(fc, false), side: THREE.DoubleSide }));
    flag.position.set(cx + 2, 34.8, z0 + 35);
    this.group.add(flag);
    this.flag = flag;
    // Victoria Memorial
    D.cyl(cx, 1.5, z0 + 10, 5, 6, 3, 16, C.white);
    D.cyl(cx, 6, z0 + 10, 1.6, 2.4, 6, 12, C.white);
    D.sphere(cx, 10, z0 + 10, 1.1, C.gold);
    D.cone(cx, 11.8, z0 + 10, 0.6, 2.2, 6, C.gold);
    // sentry boxes + guards
    for (const sx of [-14, 14]) {
      D.box(cx + sx, 1.5, z0 + 17, 1.4, 3, 1.4, '#20242a');
      D.box(cx + sx, 0.5, z0 + 15.8, 0.5, 1, 0.35, '#111');
      D.box(cx + sx, 1.4, z0 + 15.8, 0.55, 0.85, 0.4, C.red);
      D.sphere(cx + sx, 1.95, z0 + 15.8, 0.15, '#e0b090');
      D.cyl(cx + sx, 2.35, z0 + 15.8, 0.24, 0.22, 0.6, 10, '#0b0b0b');
    }
  }

  lm_trafalgar(rect, r) {
    const { x0, z0, x1, z1 } = rect;
    const D = this.b.detail;
    // National Gallery on the south side facing the square... gallery on the north side
    this.addBuilding(x0, z0, x1, z0 + 20, 16, 'stone', 'N', false, r);
    const cx = (x0 + x1) / 2;
    D.dome(cx, 16, z0 + 10, 4.5, '#6f7f80', 1.2);
    for (let k = 0; k < 8; k++) D.cyl(cx - 10 + k * 2.85, 6.5, z0 + 21.8, 0.5, 0.55, 11, 10, C.white);
    this.prism(cx, 12, z0 + 21.8, 2.5, 26, 3, C.stone, false);
    // square
    D.flat(x0, z0 + 20, x1, z1, 0.18, 1, '#c8c0aa');
    D.box(cx, 0.6, z0 + 24, x1 - x0, 1.2, 2, '#bdb39c');
    const nz = z1 - 18;
    D.box(cx, 2.5, nz, 9, 5, 9, '#bfb6a0');
    D.box(cx, 6, nz, 6, 2, 6, '#bfb6a0');
    D.cyl(cx, 27, nz, 1.1, 1.3, 40, 16, '#d8d0bc');
    D.box(cx, 47.5, nz, 3, 1, 3, '#a89f88');
    D.cyl(cx, 49.4, nz, 0.45, 0.55, 2.8, 8, '#555b55');
    D.sphere(cx, 51, nz, 0.4, '#555b55');
    for (const [lx, lz] of [[-6.5, 0], [6.5, 0], [0, -6.5], [0, 6.5]]) {
      D.box(cx + lx, 1.4, nz + lz, 2, 2.8, 4, '#bfb6a0');
      D.box(cx + lx, 3.3, nz + lz, 1.2, 1, 3, C.bronze);
      D.sphere(cx + lx, 3.9, nz + lz - 1, 0.6, C.bronze);
    }
    for (const fx of [-18, 18]) {
      D.cyl(cx + fx, 0.5, nz - 6, 5, 5.2, 1, 24, '#bdb39c');
      this.b.water.geo(new THREE.CircleGeometry(4.6, 24), cx + fx, 1.02, nz - 6, null, -Math.PI / 2, 0, 0);
      D.cyl(cx + fx, 2, nz - 6, 0.25, 0.6, 3, 8, '#bdb39c');
    }
  }

  lm_coventgarden(rect, r) {
    const { x0, z0, x1, z1 } = rect;
    this.fillGeneric(rect, 'central', r, { sides: ['N', 'S'], depth: 16 });
    const D = this.b.detail;
    D.flat(x0, z0 + 16, x1, z1 - 16, 0.18, 1, '#b8ab90');
    const mx0 = x0 + 12, mx1 = x1 - 6, mz0 = z0 + 24, mz1 = z1 - 24;
    D.box((mx0 + mx1) / 2, 3.5, (mz0 + mz1) / 2, mx1 - mx0, 7, mz1 - mz0, '#cfc4ab');
    this.arch(this.b.dbl, (mx0 + mx1) / 2, 7, (mz0 + mz1) / 2, (mz1 - mz0) / 2, mx1 - mx0, '#8ea2ab', true);
    for (let k = 0; k < 6; k++) D.cyl(x0 + 3, 4, z0 + 20 + k * 7, 0.5, 0.55, 8, 8, C.white);
    this.label('COVENT GARDEN', (mx0 + mx1) / 2, 5.2, mz1 + 0.05, 14, 1.4, 0, { bg: '#2d4d3a', fg: '#f5efe0' });
  }

  lm_stpauls(rect, r) {
    const { x0, z0, x1, z1 } = rect;
    const D = this.b.detail;
    this.grassArea(x0, z0, x1, z1);
    const cz = (z0 + z1) / 2;
    const S = '#d9d2c0';
    D.box(x0 + 41, 11, cz, 56, 22, 20, S); // nave + choir
    D.box(x0 + 41, 11, cz, 16, 22, 48, S); // transepts
    this.prism(x0 + 41, 22, cz, 56, 18, 4, '#8b9599');
    this.prism(x0 + 41, 22, cz, 48, 14, 4, '#8b9599', false);
    // west front + towers
    for (const tz of [-8, 8]) {
      D.box(x0 + 11, 16, cz + tz, 6, 32, 6, S);
      D.cyl(x0 + 11, 34, cz + tz, 2.4, 2.8, 4, 12, S);
      D.dome(x0 + 11, 36, cz + tz, 2.4, '#8b9599', 1.4);
      D.cone(x0 + 11, 40.5, cz + tz, 0.4, 2, 6, C.gold);
    }
    for (let k = 0; k < 6; k++) D.cyl(x0 + 7, 6, cz - 7 + k * 2.8, 0.55, 0.6, 12, 10, C.white);
    this.prism(x0 + 9, 22, cz, 3, 18, 4, S, false);
    // dome
    const dx = x0 + 45;
    D.cyl(dx, 27, cz, 11.5, 11.5, 10, 32, S);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      D.cyl(dx + Math.cos(a) * 12.3, 27, cz + Math.sin(a) * 12.3, 0.45, 0.5, 9, 6, C.white);
    }
    D.cyl(dx, 32.6, cz, 13, 13, 1.2, 32, S);
    D.cyl(dx, 36, cz, 10, 10, 6, 32, S);
    D.dome(dx, 39, cz, 10.2, '#7f8d94', 1.15, 32);
    D.cyl(dx, 52, cz, 1.6, 1.9, 4.5, 12, S);
    D.dome(dx, 54.2, cz, 1.6, '#7f8d94', 1.3);
    D.sphere(dx, 56.6, cz, 0.6, C.gold);
    D.box(dx, 58, cz, 0.25, 2.2, 0.25, C.gold);
    D.box(dx, 58.3, cz, 1.2, 0.25, 0.25, C.gold);
    for (let k = 0; k < 6; k++) this.tree(x0 + 6 + r() * 64, k % 2 ? z0 + 5 : z1 - 5, 0.8);
  }

  lm_gherkin(rect, r) {
    const { x0, z0, x1, z1 } = rect;
    this.fillGeneric(rect, 'city', r, { sides: ['N', 'E', 'S'], depth: 14 });
    this.b.detail.flat(x0, z0 + 14, x1 - 14, z1 - 14, 0.18, 1, '#9a9690');
    const pts = [];
    const prof = [[0.01, 0], [13, 0], [15.5, 14], [17, 32], [16.5, 52], [14, 72], [10, 90], [5, 102], [0.01, 108]];
    for (const [rr, y] of prof) pts.push(new THREE.Vector2(rr, y));
    const g = new THREE.LatheGeometry(pts, 40);
    const c = makeCanvas(512, 512), cg = c.getContext('2d');
    cg.fillStyle = '#5c7f8f';
    cg.fillRect(0, 0, 512, 512);
    for (let k = -512; k < 1024; k += 32) {
      cg.fillStyle = Math.floor(k / 32) % 2 ? '#1f3644' : '#3d6272';
      cg.beginPath(); cg.moveTo(k, 0); cg.lineTo(k + 16, 0); cg.lineTo(k + 16 + 512, 512); cg.lineTo(k + 512, 512); cg.fill();
    }
    cg.strokeStyle = 'rgba(220,230,235,0.6)';
    cg.lineWidth = 2;
    for (let k = -512; k < 1024; k += 16) { cg.beginPath(); cg.moveTo(k, 0); cg.lineTo(k - 512, 512); cg.stroke(); }
    for (let y = 0; y < 512; y += 12) { cg.beginPath(); cg.moveTo(0, y); cg.lineTo(512, y); cg.stroke(); }
    const t = canvasTex(c);
    t.repeat.set(2, 3);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: t, metalness: 0.55, roughness: 0.25, emissive: '#c8dcff', emissiveIntensity: 0, emissiveMap: t }));
    m.position.set((x0 + x1) / 2 - 6, 0, (z0 + z1) / 2);
    m.castShadow = true;
    this.group.add(m);
    this.nightMats.push([m.material, 0.35]);
  }

  lm_abbey(rect, r) {
    const { x0, z0, x1, z1 } = rect;
    const D = this.b.detail;
    this.grassArea(x0, z0, x1, z1);
    const G = '#bdb39b', cz = (z0 + z1) / 2;
    D.box(x0 + 40, 14, cz, 50, 28, 16, G);
    this.prism(x0 + 40, 28, cz, 50, 16, 6, '#6f7f80');
    D.box(x0 + 48, 14, cz, 14, 28, 40, G);
    this.prism(x0 + 48, 28, cz, 40, 14, 6, '#6f7f80', false);
    for (const tz of [-6, 6]) {
      D.box(x0 + 13, 22, cz + tz, 6, 44, 6, G);
      for (const [px, pz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) D.cone(x0 + 13 + px, 45.5, cz + tz + pz, 0.5, 3, 4, G);
    }
    for (let k = 0; k < 8; k++) {
      D.box(x0 + 20 + k * 6, 10, cz - 10, 1, 20, 3, G);
      D.box(x0 + 20 + k * 6, 10, cz + 10, 1, 20, 3, G);
    }
    const rose = makeCanvas(256, 256), rg = rose.getContext('2d');
    rg.fillStyle = '#bdb39b'; rg.fillRect(0, 0, 256, 256);
    for (let k = 10; k > 0; k--) {
      rg.fillStyle = k % 2 ? '#2a3d6b' : '#8b2a2a';
      rg.beginPath(); rg.arc(128, 128, k * 12, 0, Math.PI * 2); rg.fill();
    }
    this.tree(x1 - 6, z0 + 6, 1);
    this.tree(x1 - 6, z1 - 6, 1);
    this.tree(x0 + 30, z0 + 5, 0.9);
  }

  lm_parliament(rect, r) {
    const { x0, z0, x1, z1 } = rect;
    const D = this.b.detail;
    const G = C.gothic;
    this.grassArea(x0, z0, x1, z1);
    // main palace along the river
    this.addBuilding(x0 + 16, z0 + 30, x1, z1, 22, 'stone', 'S', false, r);
    this.prism((x0 + 16 + x1) / 2, 22, (z0 + 30 + z1) / 2, x1 - x0 - 16, z1 - z0 - 30, 5, '#5f6f6f');
    for (let x = x0 + 17; x < x1; x += 3.2) {
      D.cone(x, 23.6, z1 + 0.2, 0.35, 3.2, 4, G);
      D.cone(x, 23.6, z0 + 30, 0.35, 3.2, 4, G);
      D.box(x, 11, z1 + 0.2, 0.6, 22, 0.6, '#bba676');
    }
    // central spire
    D.cyl(x0 + 50, 26, z0 + 44, 4, 4, 10, 8, G);
    D.cone(x0 + 50, 36, z0 + 44, 4, 12, 8, '#5f6f6f');
    // Victoria Tower
    D.box(x1 - 8, 31, z0 + 38, 14, 62, 14, G);
    for (const [px, pz] of [[-6.5, -6.5], [6.5, -6.5], [-6.5, 6.5], [6.5, 6.5]]) D.cone(x1 - 8 + px, 64.5, z0 + 38 + pz, 0.8, 5, 4, G);
    D.cyl(x1 - 8, 66, z0 + 38, 0.08, 0.08, 6, 4, '#ddd');
    // Elizabeth Tower (Big Ben) at the corner by Westminster Bridge
    const bx = x0 + 6, bz = z1 - 6;
    D.box(bx, 26, bz, 9, 52, 9, G);
    for (let y = 4; y < 52; y += 4) D.box(bx, y, bz, 9.3, 0.3, 9.3, '#bba676');
    D.box(bx, 57, bz, 10.6, 10, 10.6, G);
    D.box(bx, 64.5, bz, 9.2, 5, 9.2, '#a7905f');
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      D.box(bx + Math.sin(a) * 4.65, 64.5, bz + Math.cos(a) * 4.65, 6, 3.6, 0.2, '#2b2b2b', a);
    }
    D.cone(bx, 75, bz, 6.6, 16, 4, '#3a4a4c', Math.PI / 4);
    D.cone(bx, 85, bz, 1.2, 6, 8, C.gold);
    D.box(bx, 88.5, bz, 0.2, 2, 0.2, C.gold);
    this.clockFaces(bx, 57, bz, 5.32, 7.6);
    // corner pinnacles
    for (const [px, pz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) D.cone(bx + px, 63.6, bz + pz, 0.5, 3, 4, G);
    this.tree(x0 + 30, z0 + 10, 1);
    this.tree(x0 + 50, z0 + 12, 1.1);
  }

  lm_tower(rect, r) {
    const { x0, z0, x1, z1 } = rect;
    const D = this.b.detail;
    this.grassArea(x0, z0, x1, z1);
    const W = '#cfc7b2';
    const i = 4, th = 3, h = 10;
    const wx0 = x0 + i, wz0 = z0 + i, wx1 = x1 - i, wz1 = z1 - i;
    D.box((wx0 + wx1) / 2, h / 2, wz0, wx1 - wx0, h, th, W);
    D.box((wx0 + wx1) / 2, h / 2, wz1, wx1 - wx0, h, th, W);
    D.box(wx0, h / 2, (wz0 + wz1) / 2, th, h, wz1 - wz0, W);
    D.box(wx1, h / 2, (wz0 + wz1) / 2, th, h, wz1 - wz0, W);
    for (let x = wx0; x <= wx1; x += 2) { D.box(x, h + 0.5, wz0, 1, 1, th, W); D.box(x, h + 0.5, wz1, 1, 1, th, W); }
    for (let z = wz0; z <= wz1; z += 2) { D.box(wx0, h + 0.5, z, th, 1, 1, W); D.box(wx1, h + 0.5, z, th, 1, 1, W); }
    for (const [cx, cz] of [[wx0, wz0], [wx1, wz0], [wx0, wz1], [wx1, wz1]]) D.cyl(cx, 7, cz, 4, 4.4, 14, 14, W);
    // White Tower
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    D.box(cx, 13, cz, 28, 26, 24, '#e8e2d0');
    for (let k = -2; k <= 2; k++) {
      D.box(cx + k * 5.5, 13, cz - 12.1, 2.2, 6, 0.3, '#2b2b2b');
      D.box(cx + k * 5.5, 13, cz + 12.1, 2.2, 6, 0.3, '#2b2b2b');
    }
    for (const [px, pz, round] of [[-14, -12, true], [14, -12, false], [-14, 12, false], [14, 12, false]]) {
      if (round) D.cyl(cx + px, 15, cz + pz, 3, 3, 30, 14, '#e8e2d0');
      else D.box(cx + px, 15, cz + pz, 5, 30, 5, '#e8e2d0');
      D.dome(cx + px, 30, cz + pz, 2.8, '#6f7f80', 1.2);
      D.cone(cx + px, 34, cz + pz, 0.4, 1.4, 6, C.gold);
    }
    this.label('TOWER OF LONDON', cx, 3, wz0 - 1.6, 12, 1.4, Math.PI, { bg: '#2b2b2b', fg: '#e7c15a' });
  }

  lm_countyhall(rect, r) {
    const { x0, z0, x1, z1 } = rect;
    this.addBuilding(x0, z0 + 8, x1, z1, 24, 'stone', 'N', false, r);
    this.b.detail.box((x0 + x1) / 2, 26, (z0 + 8 + z1) / 2, x1 - x0 - 4, 4, z1 - z0 - 12, '#8a4a3a');
    this.label('COUNTY HALL', (x0 + x1) / 2, 6, z1 + 0.08, 12, 1.4, 0, { bg: '#e0d9c6', fg: '#222' });
  }

  lm_eye(rect) {
    const { x0, z0, x1, z1 } = rect;
    this.grassArea(x0, z0, x1, z1);
    for (let k = 0; k < 10; k++) this.tree(x0 + 6 + k * 7, z1 - 6, 0.8);
    const cx = (x0 + x1) / 2, hy = 66, hz = z0 + 18;
    const wheel = new THREE.Group();
    wheel.position.set(cx, hy, hz);
    const white = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.4, metalness: 0.5, emissive: '#3d7dff', emissiveIntensity: 0 });
    this.nightMats.push([white, 0.9]);
    const R = 56;
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.7, 8, 120), white));
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R - 5, 0.4, 6, 120), white));
    const pts = [];
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      pts.push(0, 0, k % 2 ? 1.5 : -1.5, Math.cos(a) * R, Math.sin(a) * R, 0);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    wheel.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#dddddd' })));
    wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 6, 16).rotateX(Math.PI / 2), white));
    this.group.add(wheel);
    const capGeo = new THREE.SphereGeometry(1, 16, 10);
    capGeo.scale(1.6, 1.6, 4);
    const capMat = new THREE.MeshStandardMaterial({ color: '#cfe3ef', roughness: 0.1, metalness: 0.7, emissive: '#ffffff', emissiveIntensity: 0 });
    this.nightMats.push([capMat, 0.5]);
    const caps = new THREE.InstancedMesh(capGeo, capMat, 32);
    this.group.add(caps);
    this.eye = { wheel, caps, R: R + 2.2, angle: 0, cx, hy, hz };
    // A-frame legs
    const D = this.b.detail;
    this.beam(D, [cx - 1, hy, hz + 3], [cx - 22, 0, hz + 30], 1.1, '#e6e6e6', 8);
    this.beam(D, [cx + 1, hy, hz + 3], [cx + 22, 0, hz + 30], 1.1, '#e6e6e6', 8);
    this.beam(D, [cx, hy, hz + 3], [cx, 0, hz + 40], 0.3, '#cccccc', 6);
    D.box(cx, 0.8, hz + 6, 30, 1.6, 6, '#a8a8a8');
  }

  lm_tate(rect, r) {
    const { x0, z0, x1, z1 } = rect;
    this.grassArea(x0, z0, x1, z1);
    this.addBuilding(x0 + 2, z0 + 22, x1 - 2, z1 - 2, 30, 'brick', 'S', false, r);
    const D = this.b.detail;
    const cx = (x0 + x1) / 2;
    D.box(cx, 36, z0 + 14, 8, 72, 8, '#7a3e2c');
    const lb = new THREE.Mesh(new THREE.BoxGeometry(8.4, 4, 8.4), new THREE.MeshStandardMaterial({ color: '#cfd8dc', emissive: '#ffffff', emissiveIntensity: 0.1 }));
    lb.position.set(cx, 70, z0 + 14);
    this.group.add(lb);
    this.nightMats.push([lb.material, 1.5, 0.1]);
    for (let k = 0; k < 8; k++) this.tree(x0 + 6 + k * 9, z0 + 6, 0.7);
    this.label('TATE MODERN', cx, 6, z1 - 1.9, 14, 1.6, 0, { bg: '#111', fg: '#fff', font: 'Arial, sans-serif' });
  }

  lm_shard(rect, r) {
    const { x0, z0, x1, z1 } = rect;
    this.fillGeneric(rect, 'southcity', r, { sides: ['N'], depth: 14 });
    this.b.detail.flat(x0, z0 + 14, x1, z1, 0.18, 1, '#9a9690');
    const c = makeCanvas(256, 1024), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 256, 1024);
    gr.addColorStop(0, '#d8e6ef'); gr.addColorStop(0.5, '#8fb0c4'); gr.addColorStop(1, '#5f7f92');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 1024);
    g.strokeStyle = 'rgba(40,50,60,0.35)';
    for (let y = 0; y < 1024; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    for (let x = 0; x < 256; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1024); g.stroke(); }
    const e = makeCanvas(256, 1024), ge = e.getContext('2d');
    ge.fillStyle = '#000'; ge.fillRect(0, 0, 256, 1024);
    for (let y = 0; y < 1024; y += 8) for (let x = 0; x < 256; x += 16) if (Math.random() < 0.4) { ge.fillStyle = '#fff2dc'; ge.fillRect(x + 1, y + 1, 14, 6); }
    ge.fillStyle = '#ffffff'; ge.fillRect(0, 0, 256, 50);
    const geo = new THREE.CylinderGeometry(0.6, 24, 190, 7, 12);
    geo.translate(0, 95, 0);
    const mat = new THREE.MeshStandardMaterial({ map: canvasTex(c, false), emissiveMap: canvasTex(e, false), emissive: '#ffffff', emissiveIntensity: 0, metalness: 0.6, roughness: 0.15 });
    this.nightMats.push([mat, 0.8]);
    const m = new THREE.Mesh(geo, mat);
    m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2 + 8);
    m.rotation.y = 0.3;
    m.castShadow = true;
    this.group.add(m);
  }

  lm_borough(rect, r) {
    const { x0, z0, x1, z1 } = rect;
    this.fillGeneric(rect, 'south', r, { sides: ['E', 'N'], depth: 14 });
    const D = this.b.detail;
    const mx0 = x0 + 2, mx1 = x1 - 16, mz0 = z0 + 16, mz1 = z1 - 2;
    D.flat(mx0, mz0, mx1, mz1, 0.18, 1, '#8f8678');
    for (let x = mx0; x <= mx1; x += 6) for (const z of [mz0, mz1]) D.cyl(x, 4, z, 0.25, 0.25, 8, 6, '#244a34');
    this.arch(this.b.dbl, (mx0 + mx1) / 2, 8, (mz0 + mz1) / 2, (mz1 - mz0) / 2, mx1 - mx0, '#3f6b52', true);
    for (let k = 0; k < 18; k++) {
      const sx = mx0 + 4 + (k % 6) * 9, sz = mz0 + 8 + Math.floor(k / 6) * 16;
      D.box(sx, 0.6, sz, 4, 1.2, 2, ['#c44', '#4a4', '#da3', '#66c', '#c84'][k % 5]);
      D.box(sx, 2.4, sz, 4.4, 0.1, 2.4, ['#eee', '#c33', '#363', '#fe8'][k % 4]);
    }
    this.label('BOROUGH MARKET', (mx0 + mx1) / 2, 5.5, mz0 - 0.1, 14, 1.6, Math.PI, { bg: '#244a34', fg: '#f0e0a0' });
  }

  // ---------------------------------------------------------------- bridges & embankment
  buildBridges() {
    const D = this.b.detail;
    const xMax = (NX - 1) * B;
    // embankment parapets (with gaps for bridges)
    const bxs = Object.keys(BRIDGES).map(Number).map((i) => i * B);
    const cuts = [-60, ...bxs.flatMap((x) => [x - HALF_ROAD, x + HALF_ROAD]), xMax + 60];
    for (let k = 0; k < cuts.length; k += 2) {
      const a = cuts[k], b = cuts[k + 1];
      D.box((a + b) / 2, 0.55, RIVER_Z0 + 0.5, b - a, 1.1, 1, '#b8b0a0');
      D.box((a + b) / 2, 0.55, RIVER_Z1 - 0.5, b - a, 1.1, 1, '#b8b0a0');
      for (let x = a + 6; x < b - 3; x += 22) {
        this.lamps.push([x, RIVER_Z0 + 0.5, 1]);
        this.lamps.push([x, RIVER_Z1 - 0.5, 1]);
      }
    }
    const styles = { 3: ['#2f5d3a', '#7a8c80'], 6: ['#c9c3b5', '#a8a296'], 9: ['#b0aea6', '#8f8d86'], 12: ['#6b8db5', '#8a8577'] };
    for (const i of Object.keys(BRIDGES).map(Number)) {
      const x = i * B;
      const [par, pier] = styles[i];
      D.box(x - HALF_ROAD - 0.3, 0.55, (RIVER_Z0 + RIVER_Z1) / 2, 0.6, 1.1, RIVER_Z1 - RIVER_Z0, par);
      D.box(x + HALF_ROAD + 0.3, 0.55, (RIVER_Z0 + RIVER_Z1) / 2, 0.6, 1.1, RIVER_Z1 - RIVER_Z0, par);
      D.box(x, -0.6, (RIVER_Z0 + RIVER_Z1) / 2, 2 * HALF_ROAD + 1.2, 1.1, RIVER_Z1 - RIVER_Z0, pier);
      for (const pz of [RIVER_Z0 + 22, (RIVER_Z0 + RIVER_Z1) / 2, RIVER_Z1 - 22]) {
        if (i === 12 && Math.abs(pz - (RIVER_Z0 + RIVER_Z1) / 2) < 1) continue;
        D.box(x, -1.6, pz, 2 * HALF_ROAD + 2, 2, 4, pier);
      }
      for (let z = RIVER_Z0 + 10; z < RIVER_Z1; z += 18) {
        this.lamps.push([x - HALF_ROAD - 0.3, z, 1]);
        this.lamps.push([x + HALF_ROAD + 0.3, z, 1]);
      }
      if (i === 12) this.towerBridge(x);
    }
    this.label('WESTMINSTER BRIDGE', 3 * B + HALF_ROAD + 0.65, 0.6, RIVER_Z0 + 20, 6, 0.5, Math.PI / 2, { bg: '#2f5d3a', fg: '#fff', size: 60 });
  }

  towerBridge(x) {
    const D = this.b.detail;
    const S = '#d4cbb5', BL = '#6b8db5';
    const t1 = RIVER_Z0 + 24, t2 = RIVER_Z1 - 24;
    for (const tz of [t1, t2]) {
      for (const sx of [-10.5, 10.5]) {
        D.box(x + sx, 18, tz, 5, 36, 9, S);
        D.box(x + sx, 38, tz, 4, 4, 8, S);
        D.cone(x + sx, 43, tz, 3, 6, 4, '#4a4f58', Math.PI / 4);
        for (const [px, pz] of [[-2, -4], [2, -4], [-2, 4], [2, 4]]) D.cone(x + sx + px, 41.5, tz + pz, 0.5, 4, 4, '#4a4f58');
      }
      D.box(x, 35, tz, 26, 3, 6, S);
      D.box(x, -1.5, tz, 30, 3, 14, '#8a8577');
    }
    for (const sz of [-2.5, 2.5]) D.box(x, 33, (t1 + t2) / 2 + sz, 2, 3, t2 - t1, BL);
    for (const sx of [-10.5, 10.5]) {
      this.beam(D, [x + sx, 28, t1 - 4], [x + sx, 4, RIVER_Z0 - 2], 0.5, BL);
      this.beam(D, [x + sx, 28, t2 + 4], [x + sx, 4, RIVER_Z1 + 2], 0.5, BL);
    }
  }

  // ---------------------------------------------------------------- furniture
  buildFurniture() {
    const r = seededRandom(4242);
    // lamps along roads (both pavements) and street trees on some roads
    const treeRows = new Set([6]), treeCols = new Set([1, 5]);
    for (let j = 0; j < NZ; j++)
      for (let i = 0; i < NX - 1; i++) {
        for (let s = 16; s < B - 12; s += 34) {
          if (j !== RIVER_ROW && j > 0) this.lamps.push([i * B + s, j * B - HALF_ROAD - 0.6, 0]);
          if (j !== RIVER_ROW + 1 && j < NZ - 1) this.lamps.push([i * B + s + 10, j * B + HALF_ROAD + 0.6, 0]);
        }
        if (treeRows.has(j)) for (let s = 18; s < B - 12; s += 14) this.tree(i * B + s, j * B - 9.5, 0.75);
      }
    for (let i = 0; i < NX; i++)
      for (let j = 0; j < NZ - 1; j++) {
        if (!hasEdgeV(i, j) || j === RIVER_ROW) continue;
        for (let s = 20; s < B - 12; s += 34) {
          if (i > 0) this.lamps.push([i * B - HALF_ROAD - 0.6, j * B + s, 0]);
          if (i < NX - 1) this.lamps.push([i * B + HALF_ROAD + 0.6, j * B + s + 10, 0]);
        }
        if (treeCols.has(i)) for (let s = 18; s < B - 12; s += 14) { this.tree(i * B - 9.5, j * B + s, 0.75); this.tree(i * B + 9.5, j * B + s, 0.75); }
      }
    // phone boxes and post boxes near corners of generic blocks
    for (let k = 0; k < 70; k++) {
      const bi = Math.floor(r() * (NX - 1)), bj = Math.floor(r() * (NZ - 1));
      if (bj === RIVER_ROW) continue;
      const rc = cellRect(bi, bj);
      const corner = Math.floor(r() * 4);
      const x = corner % 2 ? rc.x1 - 3 - r() * 10 : rc.x0 + 3 + r() * 10;
      const z = corner < 2 ? rc.z0 - 1.2 : rc.z1 + 1.2;
      if (k % 2) this.phoneBoxes.push([x, z]);
      else this.postBoxes.push([x, z]);
    }

    // instanced meshes
    const inst = (geo, mat, list, fn, shadow = true) => {
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      const o = new THREE.Object3D();
      list.forEach((it, idx) => {
        fn(o, it);
        o.updateMatrix();
        m.setMatrixAt(idx, o.matrix);
      });
      m.castShadow = shadow;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    const poleMat = new THREE.MeshStandardMaterial({ color: '#23302a', roughness: 0.6, metalness: 0.4 });
    inst(new THREE.CylinderGeometry(0.07, 0.11, 6, 6), poleMat, this.lamps, (o, [x, z]) => { o.position.set(x, 3, z); });
    inst(new THREE.CylinderGeometry(0.18, 0.28, 0.6, 6), this.lampMat, this.lamps, (o, [x, z]) => { o.position.set(x, 6.1, z); }, false);
    // pools of warm light under each street lamp (visible at night)
    this.poolMat = new THREE.MeshBasicMaterial({ map: makeGlow('rgba(255,196,120,1)'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const poolGeo = new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2);
    const pools = inst(poolGeo, this.poolMat, this.lamps, (o, [x, z]) => { o.position.set(x, 0.2, z); }, false);
    pools.receiveShadow = false;
    pools.renderOrder = 2;
    // a glowing halo around each lamp head
    this.haloMat = new THREE.SpriteMaterial({ map: makeGlow('rgba(255,220,170,1)'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const haloGeo = new THREE.PlaneGeometry(2.2, 2.2);
    this.halos = new THREE.InstancedMesh(haloGeo, new THREE.MeshBasicMaterial({ map: this.haloMat.map, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), this.lamps.length);
    this.halos.frustumCulled = false;
    this.group.add(this.halos);
    this.haloQ = new THREE.Quaternion();
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#6b5a45', roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    inst(new THREE.CylinderGeometry(0.2, 0.3, 4, 6), trunkMat, this.trees, (o, [x, z, s]) => { o.position.set(x, 2 * s, z); o.scale.set(s, s, s); o.rotation.set(0, 0, 0); });
    // clumpy crown made of several lumps with colour variation
    const cb = new GeoBuilder();
    const tr = seededRandom(31);
    const lumps = [[0, 0, 0, 2.4], [1.4, 0.6, 0.4, 1.7], [-1.3, 0.4, -0.6, 1.8], [0.3, 1.5, -1.0, 1.6], [-0.4, 1.2, 1.3, 1.6], [0.9, -0.5, -1.3, 1.5], [-1.0, -0.4, 1.1, 1.5]];
    const ico = new THREE.IcosahedronGeometry(1, 2);
    for (const [lx, ly, lz, lr] of lumps) {
      const g = ico.clone();
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = 0.82 + tr() * 0.3; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
      g.computeVertexNormals();
      const c = new THREE.Color().setHSL(0.24 + tr() * 0.06, 0.45 + tr() * 0.15, 0.22 + tr() * 0.1);
      cb.geo(g, lx, ly, lz, c, 0, 0, 0, lr, lr * 0.9, lr);
    }
    const crown = cb.build();
    inst(crown, leafMat, this.trees, (o, [x, z, s]) => { o.position.set(x, 5.6 * s, z); o.scale.set(s, s * 1.15, s); o.rotation.set(0, x * 0.37, 0); });
    const red = new THREE.MeshStandardMaterial({ color: '#c8102e', roughness: 0.45 });
    inst(new THREE.BoxGeometry(1, 2.5, 1), red, this.phoneBoxes, (o, [x, z]) => { o.position.set(x, 1.4, z); o.rotation.set(0, 0, 0); });
    inst(new THREE.BoxGeometry(1.1, 0.25, 1.1), red, this.phoneBoxes, (o, [x, z]) => { o.position.set(x, 2.72, z); });
    inst(new THREE.CylinderGeometry(0.3, 0.3, 1.5, 12), red, this.postBoxes, (o, [x, z]) => { o.position.set(x, 0.9, z); });
    inst(new THREE.CylinderGeometry(0.34, 0.34, 0.12, 12), new THREE.MeshStandardMaterial({ color: '#111' }), this.postBoxes, (o, [x, z]) => { o.position.set(x, 1.68, z); });
  }

  // ---------------------------------------------------------------- traffic signals
  buildSignals() {
    const heads = [];
    for (const n of this.nodes) {
      if (!n.signal) continue;
      for (const a of n.adj) {
        const o = this.nodes[a];
        const dx = Math.sign(n.x - o.x), dz = Math.sign(n.z - o.z);
        const lx = dz, lz = -dx;
        const axis = dx !== 0 ? 'x' : 'z';
        // primary on near-left, secondary on far-right
        heads.push({ node: n, axis, x: n.x - dx * 9 + lx * 8.3, z: n.z - dz * 9 + lz * 8.3, fx: -dx, fz: -dz });
        heads.push({ node: n, axis, x: n.x + dx * 9 - lx * 8.3, z: n.z + dz * 9 - lz * 8.3, fx: -dx, fz: -dz });
      }
    }
    this.heads = heads;
    const o = new THREE.Object3D();
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6), new THREE.MeshStandardMaterial({ color: '#202020' }), heads.length);
    const box = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 1.05, 0.26), new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.6 }), heads.length);
    const lampGeo = new THREE.CircleGeometry(0.12, 12);
    const lampMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.lampsR = new THREE.InstancedMesh(lampGeo, lampMat, heads.length);
    this.lampsA = new THREE.InstancedMesh(lampGeo, lampMat.clone(), heads.length);
    this.lampsG = new THREE.InstancedMesh(lampGeo, lampMat.clone(), heads.length);
    const blk = new THREE.Color('#222');
    heads.forEach((h, k) => {
      const ry = Math.atan2(h.fx, h.fz);
      o.rotation.set(0, ry, 0);
      o.position.set(h.x, 1.7, h.z);
      o.updateMatrix();
      pole.setMatrixAt(k, o.matrix);
      o.position.set(h.x, 3.7, h.z);
      o.updateMatrix();
      box.setMatrixAt(k, o.matrix);
      [this.lampsR, this.lampsA, this.lampsG].forEach((lm, li) => {
        o.position.set(h.x + h.fx * 0.135, 4.03 - li * 0.32, h.z + h.fz * 0.135);
        o.updateMatrix();
        lm.setMatrixAt(k, o.matrix);
        lm.setColorAt(k, blk);
      });
    });
    pole.castShadow = true;
    this.group.add(pole, box, this.lampsR, this.lampsA, this.lampsG);
    this.colOn = { R: new THREE.Color(3, 0.1, 0.05), A: new THREE.Color(3, 1.4, 0), G: new THREE.Color(0.2, 3, 0.8) };
    this.colOff = { R: new THREE.Color('#3a0d0d'), A: new THREE.Color('#3a2a0a'), G: new THREE.Color('#0d2a17') };
  }

  updateSignals() {
    const R = this.lampsR, A = this.lampsA, G = this.lampsG;
    this.heads.forEach((h, k) => {
      const s = this.lightState(h.node, h.axis);
      R.setColorAt(k, s === 'R' || s === 'RA' ? this.colOn.R : this.colOff.R);
      A.setColorAt(k, s === 'A' || s === 'RA' ? this.colOn.A : this.colOff.A);
      G.setColorAt(k, s === 'G' ? this.colOn.G : this.colOff.G);
    });
    R.instanceColor.needsUpdate = A.instanceColor.needsUpdate = G.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- collision
  buildObstacles() {
    const O = this.obstacles;
    const xMax = (NX - 1) * B, zMax = (NZ - 1) * B;
    for (let bj = 0; bj < NZ - 1; bj++)
      for (let bi = 0; bi < NX - 1; bi++) {
        if (bj === RIVER_ROW) continue;
        O.push([bi * B + HALF_ROAD, bj * B + HALF_ROAD, (bi + 1) * B - HALF_ROAD, (bj + 1) * B - HALF_ROAD]);
      }
    const bxs = Object.keys(BRIDGES).map(Number).map((i) => i * B);
    const cuts = [-3000, ...bxs.flatMap((x) => [x - HALF_ROAD, x + HALF_ROAD]), 3000];
    for (let k = 0; k < cuts.length; k += 2) O.push([cuts[k], RIVER_Z0, cuts[k + 1], RIVER_Z1]);
    O.push([-3000, -3000, -HALF_ROAD, 3000]);
    O.push([xMax + HALF_ROAD, -3000, 3000, 3000]);
    O.push([-3000, -3000, 3000, -HALF_ROAD]);
    O.push([-3000, zMax + HALF_ROAD, 3000, 3000]);
  }

  /** push circle out of obstacles. returns penetration normal or null */
  collideCircle(x, z, rad) {
    let hit = null;
    for (const [x0, z0, x1, z1] of this.obstacles) {
      if (x < x0 - rad || x > x1 + rad || z < z0 - rad || z > z1 + rad) continue;
      const cx = clamp(x, x0, x1), cz = clamp(z, z0, z1);
      let dx = x - cx, dz = z - cz;
      let d = Math.hypot(dx, dz);
      if (d >= rad) continue;
      if (d < 1e-6) {
        // centre inside: push out along smallest axis
        const opts = [[x - x0, -1, 0], [x1 - x, 1, 0], [z - z0, 0, -1], [z1 - z, 0, 1]].sort((a, b) => a[0] - b[0]);
        const [pen, nx, nz] = opts[0];
        x += nx * (pen + rad);
        z += nz * (pen + rad);
        hit = { nx, nz, x, z };
        continue;
      }
      dx /= d;
      dz /= d;
      x += dx * (rad - d);
      z += dz * (rad - d);
      hit = { nx: dx, nz: dz, x, z };
    }
    return hit;
  }

  // ---------------------------------------------------------------- places / addresses
  buildPlaces() {
    this.places = PLACES.map((p) => ({ ...p, ...this.kerbSpot(p.cell[0], p.cell[1], p.side, 0.5) }));
  }

  kerbSpot(bi, bj, side, t) {
    const L = B - 2 * INSET;
    const off = HALF_ROAD + 1.2;
    let x, z, fx, fz, road;
    if (side === 'N') { x = bi * B + INSET + t * L; z = bj * B + off; fx = 0; fz = -1; road = ROW_NAMES[bj]; }
    else if (side === 'S') { x = bi * B + INSET + t * L; z = (bj + 1) * B - off; fx = 0; fz = 1; road = ROW_NAMES[bj + 1]; }
    else if (side === 'W') { x = bi * B + off; z = bj * B + INSET + t * L; fx = -1; fz = 0; road = COL_NAMES[bi]; }
    else { x = (bi + 1) * B - off; z = bj * B + INSET + t * L; fx = 1; fz = 0; road = COL_NAMES[bi + 1]; }
    // segment end nodes
    let n1, n2;
    if (side === 'N') { n1 = nodeId(bi, bj); n2 = nodeId(bi + 1, bj); }
    else if (side === 'S') { n1 = nodeId(bi, bj + 1); n2 = nodeId(bi + 1, bj + 1); }
    else if (side === 'W') { n1 = nodeId(bi, bj); n2 = nodeId(bi, bj + 1); }
    else { n1 = nodeId(bi + 1, bj); n2 = nodeId(bi + 1, bj + 1); }
    return { x, z, fx, fz, road, nodes: [n1, n2], cell: [bi, bj], side };
  }

  randomAddress(r = Math.random) {
    for (let tries = 0; tries < 50; tries++) {
      const bi = Math.floor(r() * (NX - 1)), bj = Math.floor(r() * (NZ - 1));
      if (bj === RIVER_ROW) continue;
      const side = 'NSEW'[Math.floor(r() * 4)];
      const sp = this.kerbSpot(bi, bj, side, 0.12 + r() * 0.76);
      const num = 1 + Math.floor(r() * 220);
      return { ...sp, name: `${num} ${sp.road}`, key: 'addr' };
    }
    return null;
  }

  streetAt(x, z) {
    const j = Math.round(z / B), i = Math.round(x / B);
    const onRow = Math.abs(z - j * B) <= HALF_ROAD + 1 && j >= 0 && j < NZ;
    const onCol = Math.abs(x - i * B) <= HALF_ROAD + 1 && i >= 0 && i < NX;
    if (onRow && onCol) return `${ROW_NAMES[j]} / ${COL_NAMES[i]}`;
    if (onCol && z > RIVER_Z0 - 1 && z < RIVER_Z1 + 1 && BRIDGES[i]) return BRIDGES[i];
    if (onRow) return ROW_NAMES[j];
    if (onCol) return COL_NAMES[i];
    return '';
  }

  /** nearest road segment (as node pair) to a point */
  nearestSegment(x, z) {
    let best = null, bd = Infinity;
    for (const n of this.nodes)
      for (const a of n.adj) {
        if (a < n.id) continue;
        const o = this.nodes[a];
        const vx = o.x - n.x, vz = o.z - n.z;
        const t = clamp(((x - n.x) * vx + (z - n.z) * vz) / (vx * vx + vz * vz), 0, 1);
        const d = Math.hypot(x - (n.x + vx * t), z - (n.z + vz * t));
        if (d < bd) { bd = d; best = [n.id, a, t]; }
      }
    return best;
  }

  /** shortest route from a position/heading to a kerb spot. returns array of [x,z] */
  route(x, z, fx, fz, dest) {
    const seg = this.nearestSegment(x, z);
    if (!seg) return null;
    const N = this.nodes;
    const dist = new Float64Array(N.length).fill(Infinity);
    const prev = new Int32Array(N.length).fill(-1);
    const done = new Uint8Array(N.length);
    for (const id of [seg[0], seg[1]]) {
      const n = N[id];
      const dx = n.x - x, dz = n.z - z;
      const d = Math.hypot(dx, dz);
      const behind = d > 3 && (dx * fx + dz * fz) / d < -0.3;
      dist[id] = Math.min(dist[id], d + (behind ? 90 : 0));
    }
    for (;;) {
      let u = -1, bd = Infinity;
      for (let k = 0; k < N.length; k++) if (!done[k] && dist[k] < bd) { bd = dist[k]; u = k; }
      if (u < 0) break;
      done[u] = 1;
      for (const v of N[u].adj) {
        const nd = dist[u] + Math.hypot(N[v].x - N[u].x, N[v].z - N[u].z);
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; }
      }
    }
    // same segment shortcut
    const sameSeg = (seg[0] === dest.nodes[0] && seg[1] === dest.nodes[1]) || (seg[0] === dest.nodes[1] && seg[1] === dest.nodes[0]);
    let bestEnd = -1, bestCost = Infinity;
    for (const id of dest.nodes) {
      const c = dist[id] + Math.hypot(N[id].x - dest.x, N[id].z - dest.z);
      if (c < bestCost) { bestCost = c; bestEnd = id; }
    }
    if (sameSeg) {
      const dd = Math.hypot(dest.x - x, dest.z - z);
      const ahead = (dest.x - x) * fx + (dest.z - z) * fz > 0;
      if (ahead || dd < 30) return { pts: [[x, z], [dest.x, dest.z]], len: dd };
    }
    const path = [];
    let u = bestEnd;
    while (u >= 0) { path.unshift([N[u].x, N[u].z]); u = prev[u]; }
    path.unshift([x, z]);
    path.push([dest.x, dest.z]);
    let len = 0;
    for (let k = 1; k < path.length; k++) len += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
    return { pts: path, len };
  }

  // ---------------------------------------------------------------- per-frame
  setNight(n) {
    for (const [m, k, base = 0] of this.nightMats) m.emissiveIntensity = base + n * k;
    this.lampMat.emissiveIntensity = 0.15 + n * 6;
    const k = Math.max(0, (n - 0.35) / 0.65);
    if (this.poolMat) this.poolMat.opacity = k * 0.55;
    if (this.halos) this.halos.material.opacity = k * 0.9;
    this.halos && (this.halos.visible = k > 0.01);
  }

  /** orient lamp halos to face the camera (cheap billboards) */
  updateHalos(camera) {
    if (!this.halos || !this.halos.visible) return;
    const o = new THREE.Object3D();
    o.quaternion.copy(camera.quaternion);
    const cx = camera.position.x, cz = camera.position.z;
    let k = 0;
    for (const [x, z] of this.lamps) {
      if (Math.abs(x - cx) > 260 || Math.abs(z - cz) > 260) continue;
      o.position.set(x, 6.1, z);
      o.updateMatrix();
      this.halos.setMatrixAt(k++, o.matrix);
    }
    this.halos.count = k;
    this.halos.instanceMatrix.needsUpdate = true;
  }

  update(dt, clock) {
    this.time += dt;
    this.waterNormal.offset.set(this.time * 0.012, this.time * 0.02);
    this.updateSignals();
    if (this.eye) {
      const e = this.eye;
      e.angle += dt * 0.02;
      e.wheel.rotation.z = e.angle;
      const o = new THREE.Object3D();
      for (let k = 0; k < 32; k++) {
        const a = e.angle + (k / 32) * Math.PI * 2;
        o.position.set(e.cx + Math.cos(a) * e.R, e.hy + Math.sin(a) * e.R, e.hz);
        o.updateMatrix();
        e.caps.setMatrixAt(k, o.matrix);
      }
      e.caps.instanceMatrix.needsUpdate = true;
    }
    if (this.billboard) {
      this.billboard.t += dt;
      if (this.billboard.t > 4) {
        this.billboard.t = 0;
        this.billboard.frame++;
        this.drawBillboard();
      }
    }
    if (this.flag) this.flag.rotation.y = Math.sin(this.time * 2) * 0.2;
    if (this.clockCanvas && clock) {
      const key = Math.floor(clock.minutes);
      if (key !== this.lastClock) {
        this.lastClock = key;
        drawClockFace(this.clockCanvas.getContext('2d'), 256, Math.floor(clock.minutes / 60), clock.minutes % 60);
        this.clockTex.needsUpdate = true;
      }
    }
  }
}
