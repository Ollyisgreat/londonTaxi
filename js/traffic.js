import { B, LANE } from './config.js';
import { buildCab, buildCar, buildVan, buildBus, CAR_COLORS } from './vehicles.js';
import { pick, clamp } from './util.js';

const TYPES = [
  { kind: 'car', w: 50, len: 4.2, halfW: 0.9, vmax: [11, 14] },
  { kind: 'cab', w: 22, len: 4.6, halfW: 0.95, vmax: [11, 14] },
  { kind: 'van', w: 12, len: 5.3, halfW: 1.0, vmax: [10, 13] },
  { kind: 'bus', w: 10, len: 10.6, halfW: 1.28, vmax: [8, 10.5] },
];

function pickType() {
  let t = Math.random() * TYPES.reduce((a, b) => a + b.w, 0);
  for (const ty of TYPES) { t -= ty.w; if (t <= 0) return ty; }
  return TYPES[0];
}

export class Traffic {
  constructor(scene, city, count = 46) {
    this.scene = scene;
    this.city = city;
    this.vehicles = [];
    for (let k = 0; k < count; k++) {
      const ty = pickType();
      let mesh;
      if (ty.kind === 'car') mesh = buildCar(pick(CAR_COLORS));
      else if (ty.kind === 'cab') mesh = buildCab();
      else if (ty.kind === 'van') mesh = buildVan();
      else mesh = buildBus();
      if (ty.kind === 'cab') mesh.userData.sign.userData.setLit(Math.random() < 0.5);
      scene.add(mesh);
      const v = { ...ty, mesh, speed: 0, vmaxBase: ty.vmax[0] + Math.random() * (ty.vmax[1] - ty.vmax[0]), stuck: 0, ghost: 0, honkT: 0, blockedByPlayer: 0 };
      this.vehicles.push(v);
    }
    this.honk = null; // callback
  }

  edgeGeom(from, to) {
    const a = this.city.nodes[from], b = this.city.nodes[to];
    const dx = Math.sign(b.x - a.x), dz = Math.sign(b.z - a.z);
    return { a, b, dx, dz, lx: dz, lz: -dx, len: B };
  }

  lanePos(e, s) {
    return [e.a.x + e.dx * s + e.lx * LANE, e.a.z + e.dz * s + e.lz * LANE];
  }

  spawnAll(px, pz) {
    for (const v of this.vehicles) this.respawn(v, px, pz, 0, 420, true);
  }

  respawn(v, px, pz, minD, maxD, anywhere = false) {
    const nodes = this.city.nodes;
    for (let tries = 0; tries < 60; tries++) {
      const n = nodes[Math.floor(Math.random() * nodes.length)];
      const to = pick(n.adj);
      const e = this.edgeGeom(n.id, to);
      const s = 12 + Math.random() * (B - 30);
      const [x, z] = this.lanePos(e, s);
      const d = Math.hypot(x - px, z - pz);
      if (d < minD || d > maxD) continue;
      if (!anywhere && d < 200) continue;
      let clash = false;
      for (const o of this.vehicles) if (o !== v && o.x !== undefined && Math.hypot(o.x - x, o.z - z) < 14) { clash = true; break; }
      if (clash) continue;
      v.from = n.id; v.to = to; v.e = e; v.s = s; v.mode = 'lane'; v.next = null; v.turn = null;
      v.x = x; v.z = z; v.fx = e.dx; v.fz = e.dz;
      v.speed = v.vmaxBase * 0.6;
      v.stuck = 0; v.ghost = 0;
      this.place(v);
      return;
    }
  }

  chooseNext(v) {
    const n = this.city.nodes[v.to];
    const opts = n.adj.filter((id) => id !== v.from);
    if (!opts.length) return v.from;
    // prefer straight on
    const e = v.e;
    const straight = opts.find((id) => {
      const o = this.city.nodes[id];
      return Math.sign(o.x - n.x) === e.dx && Math.sign(o.z - n.z) === e.dz;
    });
    if (straight !== undefined && Math.random() < 0.55) return straight;
    return pick(opts);
  }

  beginTurn(v) {
    const e = v.e;
    const ne = this.edgeGeom(v.to, v.next);
    const p0 = this.lanePos(e, e.len - 8);
    const p2 = this.lanePos(ne, 8);
    let p1;
    if (ne.dx === e.dx && ne.dz === e.dz) p1 = [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2];
    else p1 = [e.b.x + e.lx * LANE + ne.lx * LANE, e.b.z + e.lz * LANE + ne.lz * LANE];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    v.turn = { p0, p1, p2, t: 0, len: len * 0.92, straight: ne.dx === e.dx && ne.dz === e.dz };
    v.mode = 'turn';
  }

  place(v) {
    v.mesh.position.set(v.x, 0, v.z);
    v.mesh.rotation.y = Math.atan2(-v.fx, -v.fz);
  }

  update(dt, player, audio) {
    const city = this.city;
    for (const v of this.vehicles) {
      // recycle far-away vehicles to keep traffic around the player
      const dp = Math.hypot(v.x - player.x, v.z - player.z);
      if (dp > 430) { this.respawn(v, player.x, player.z, 160, 400); continue; }

      let target = v.vmaxBase;
      let redStop = false;
      if (v.mode === 'lane') {
        const e = v.e;
        if (!v.next && v.s > e.len - 45) v.next = this.chooseNext(v);
        const toEnd = e.len - 8 - v.s;
        if (v.next !== null && v.next !== undefined) {
          const ne = this.edgeGeom(v.to, v.next);
          const straight = ne.dx === e.dx && ne.dz === e.dz;
          if (!straight && toEnd < 25) target = Math.min(target, 5.5 + toEnd * 0.3);
        }
        const node = e.b;
        if (node.signal) {
          const st = city.lightState(node, e.dx !== 0 ? 'x' : 'z');
          const stopAt = e.len - 9.5 - v.len / 2;
          const dStop = stopAt - v.s;
          if (dStop > -0.5 && (st === 'R' || st === 'RA' || (st === 'A' && dStop > 7))) {
            target = Math.min(target, Math.max(0, dStop * 0.9));
            if (dStop < 0.3) { target = 0; v.s = Math.min(v.s, stopAt + 0.3); }
            redStop = true;
          }
        } else if (toEnd < 18) target = Math.min(target, 7);
      } else if (!v.turn.straight) target = Math.min(target, 6);

      // car following
      let gap = Infinity;
      let blockerIsPlayer = false;
      const lx = v.fz, lz = -v.fx;
      const check = (ox, oz, oLen, oHalfW, isPlayer) => {
        const rx = ox - v.x, rz = oz - v.z;
        const ahead = rx * v.fx + rz * v.fz;
        if (ahead <= 0 || ahead > 40) return;
        const lat = Math.abs(rx * lx + rz * lz);
        if (lat > 1.5 + oHalfW) return;
        const g = ahead - v.len / 2 - oLen / 2;
        if (g < gap) { gap = g; blockerIsPlayer = isPlayer; }
      };
      if (v.ghost <= 0) for (const o of this.vehicles) if (o !== v && Math.abs(o.x - v.x) < 45 && Math.abs(o.z - v.z) < 45) check(o.x, o.z, o.len, o.halfW, false);
      check(player.x, player.z, 4.6, 0.95, true);
      if (gap < Infinity) target = Math.min(target, Math.max(0, (gap - 2.5) * 0.8));
      if (gap < 1.2) target = 0;

      // accelerate / brake
      const dv = target - v.speed;
      v.speed += clamp(dv, -8 * dt, 2.4 * dt);
      if (v.speed < 0) v.speed = 0;

      // stuck handling
      if (v.speed < 0.2 && !redStop) {
        v.stuck += dt;
        if (blockerIsPlayer) {
          v.blockedByPlayer += dt;
          v.honkT -= dt;
          if (v.blockedByPlayer > 4 && v.honkT <= 0 && dp < 60) { v.honkT = 3 + Math.random() * 4; audio && audio.horn(0.35, dp); }
        }
        if (v.stuck > 7 && !blockerIsPlayer) { v.ghost = 2.5; v.stuck = 0; }
      } else { v.stuck = 0; v.blockedByPlayer = 0; }
      if (v.ghost > 0) v.ghost -= dt;

      // advance
      const ds = v.speed * dt;
      if (v.mode === 'lane') {
        v.s += ds;
        if (v.s >= v.e.len - 8) {
          if (v.next === null || v.next === undefined) v.next = this.chooseNext(v);
          this.beginTurn(v);
        } else {
          [v.x, v.z] = this.lanePos(v.e, v.s);
          v.fx = v.e.dx; v.fz = v.e.dz;
        }
      }
      if (v.mode === 'turn') {
        const T = v.turn;
        T.t += ds / T.len;
        if (T.t >= 1) {
          v.from = v.to; v.to = v.next; v.next = null;
          v.e = this.edgeGeom(v.from, v.to);
          v.s = 8 + (T.t - 1) * T.len;
          v.mode = 'lane'; v.turn = null;
          [v.x, v.z] = this.lanePos(v.e, v.s);
          v.fx = v.e.dx; v.fz = v.e.dz;
        } else {
          const t = T.t, u = 1 - t;
          v.x = u * u * T.p0[0] + 2 * u * t * T.p1[0] + t * t * T.p2[0];
          v.z = u * u * T.p0[1] + 2 * u * t * T.p1[1] + t * t * T.p2[1];
          let tx = 2 * u * (T.p1[0] - T.p0[0]) + 2 * t * (T.p2[0] - T.p1[0]);
          let tz = 2 * u * (T.p1[1] - T.p0[1]) + 2 * t * (T.p2[1] - T.p1[1]);
          const l = Math.hypot(tx, tz) || 1;
          v.fx = tx / l; v.fz = tz / l;
        }
      }
      this.place(v);
    }
  }

  /** Resolve collisions between the player taxi and traffic. Returns impact speed. */
  collidePlayer(p) {
    let impact = 0;
    const pc = [1.35, 0, -1.35].map((o) => [p.x + p.fwdX * o, p.z + p.fwdZ * o]);
    for (const v of this.vehicles) {
      if (Math.abs(v.x - p.x) > 12 || Math.abs(v.z - p.z) > 12) continue;
      const n = Math.max(2, Math.round(v.len / 2));
      const span = v.len / 2 - v.halfW;
      for (let k = 0; k < n; k++) {
        const o = -span + (2 * span * k) / (n - 1);
        const vx = v.x + v.fx * o, vz = v.z + v.fz * o;
        for (const c of pc) {
          const dx = c[0] - vx, dz = c[1] - vz;
          const d = Math.hypot(dx, dz);
          const rr = 1.0 + v.halfW;
          if (d < rr && d > 1e-4) {
            const nx = dx / d, nz = dz / d;
            const push = rr - d;
            p.x += nx * push;
            p.z += nz * push;
            c[0] += nx * push;
            c[1] += nz * push;
            const rvx = p.vx - v.fx * v.speed, rvz = p.vz - v.fz * v.speed;
            const vn = rvx * nx + rvz * nz;
            if (vn < 0) {
              impact = Math.max(impact, -vn);
              p.vx -= nx * vn * 1.2;
              p.vz -= nz * vn * 1.2;
              v.speed *= 0.3;
            }
          }
        }
      }
    }
    return impact;
  }
}
