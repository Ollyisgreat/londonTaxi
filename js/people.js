import * as THREE from 'three';
import { B, NX, NZ, RIVER_ROW } from './config.js';
import { GeoBuilder, pick, rand } from './util.js';

const SKIN = ['#f1c7a5', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e', '#ffdbac', '#d9a07a'];
const TOPS = ['#1f3b73', '#7a1f2b', '#2d5a3d', '#c9b37a', '#333', '#5a5a5a', '#8a3d8a', '#d36b2a', '#e8e8e8', '#16323f', '#6d4c2f', '#b02e2e', '#2a2a5a'];
const BOTTOMS = ['#1f2a44', '#222', '#4a4a4a', '#2d3e2d', '#6b5b45', '#1a1a3a', '#7a7a7a', '#3a2a1a'];
const HAIR = ['#2b1d14', '#111', '#6b4423', '#d4b06a', '#999', '#8b3a1a', '#3b2a1a'];

const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
const geoCache = new Map();

function bodyGeo(v, pose) {
  const key = v.id + pose;
  let g = geoCache.get(key);
  if (g) return g;
  const b = new GeoBuilder();
  const { skin, top, hair, bottom, coat } = v;
  if (pose === 'sit') {
    b.box(0, 0.33, 0, 0.4, 0.56, 0.24, top);
    b.box(0, 0.64, 0, 0.12, 0.08, 0.1, skin);
    b.sphere(0, 0.8, 0, 0.115, skin, 12, 8);
    b.sphere(0, 0.84, 0.01, 0.12, hair, 10, 6, 1, 0.75, 1);
    b.box(-0.04, 0.8, -0.108, 0.025, 0.015, 0.01, '#111');
    b.box(0.04, 0.8, -0.108, 0.025, 0.015, 0.01, '#111');
    for (const x of [-0.1, 0.1]) {
      b.box(x, 0.04, -0.22, 0.15, 0.14, 0.45, bottom);
      b.box(x, -0.22, -0.44, 0.14, 0.46, 0.14, bottom);
      b.box(x, -0.46, -0.48, 0.12, 0.06, 0.24, '#151515');
    }
    for (const x of [-0.25, 0.25]) {
      b.box(x, 0.36, -0.06, 0.1, 0.4, 0.1, top);
      b.box(x * 0.8, 0.14, -0.22, 0.1, 0.1, 0.3, top);
      b.sphere(x * 0.6, 0.14, -0.38, 0.05, skin, 8, 6);
    }
  } else {
    const coatLen = coat ? 0.25 : 0;
    b.box(0, 1.18 - coatLen / 2, 0, 0.4, 0.58 + coatLen, 0.24, top);
    b.box(0, 1.5, 0, 0.12, 0.08, 0.1, skin);
    b.sphere(0, 1.64, 0, 0.115, skin, 12, 8);
    b.sphere(0, 1.68, 0.01, 0.12, hair, 10, 6, 1, 0.75, 1);
    b.box(-0.04, 1.64, -0.108, 0.025, 0.015, 0.01, '#111');
    b.box(0.04, 1.64, -0.108, 0.025, 0.015, 0.01, '#111');
    b.box(-0.25, 1.15, 0, 0.1, 0.56, 0.1, top);
    b.sphere(-0.25, 0.84, 0, 0.05, skin, 8, 6);
    if (pose === 'hail') {
      b.box(0.27, 1.66, -0.06, 0.1, 0.56, 0.1, top, 0, -0.25, -0.15);
      b.sphere(0.31, 1.95, -0.14, 0.055, skin, 8, 6);
    } else {
      b.box(0.25, 1.15, 0, 0.1, 0.56, 0.1, top);
      b.sphere(0.25, 0.84, 0, 0.05, skin, 8, 6);
    }
    if (v.bag) b.box(-0.31, 0.82, 0, 0.08, 0.3, 0.32, v.bag);
  }
  g = b.build();
  geoCache.set(key, g);
  return g;
}

const legCache = new Map();
function legGeo(color) {
  let g = legCache.get(color);
  if (!g) {
    const b = new GeoBuilder();
    b.box(0, -0.4, 0, 0.14, 0.8, 0.16, color);
    b.box(0, -0.84, -0.04, 0.13, 0.08, 0.26, '#151515');
    g = b.build();
    legCache.set(color, g);
  }
  return g;
}

let vid = 0;
export function randomLook() {
  return {
    id: 'v' + vid++,
    skin: pick(SKIN),
    top: pick(TOPS),
    bottom: pick(BOTTOMS),
    hair: pick(HAIR),
    coat: Math.random() < 0.4,
    bag: Math.random() < 0.3 ? pick(['#5a3b23', '#222', '#7a1f2b', '#c9b37a']) : null,
  };
}

export class Person {
  constructor(look = randomLook()) {
    this.look = look;
    this.group = new THREE.Group();
    this.body = new THREE.Mesh(bodyGeo(look, 'stand'), mat);
    this.body.castShadow = true;
    this.group.add(this.body);
    this.legs = [];
    for (const x of [-0.1, 0.1]) {
      const l = new THREE.Mesh(legGeo(look.bottom), mat);
      l.position.set(x, 0.88, 0);
      l.castShadow = true;
      this.group.add(l);
      this.legs.push(l);
    }
    this.phase = Math.random() * 6;
    this.hailing = false;
  }
  setHail(on) {
    if (on === this.hailing) return;
    this.hailing = on;
    this.body.geometry = bodyGeo(this.look, on ? 'hail' : 'stand');
  }
  walkAnim(dt, speed) {
    this.phase += dt * speed * 4.2;
    const a = Math.sin(this.phase) * 0.45 * Math.min(1, speed);
    this.legs[0].rotation.x = a;
    this.legs[1].rotation.x = -a;
    this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.03 * Math.min(1, speed);
  }
  face(fx, fz) {
    this.group.rotation.y = Math.atan2(-fx, -fz);
  }
}

export function seatedPerson(look) {
  const m = new THREE.Mesh(bodyGeo(look, 'sit'), mat);
  m.castShadow = false;
  return m;
}

// --------------------------------------------------------------- walkers
export class Crowd {
  constructor(scene, count = 70) {
    this.scene = scene;
    this.walkers = [];
    for (let k = 0; k < count; k++) {
      const p = new Person();
      scene.add(p.group);
      this.walkers.push({ p, bi: 0, bj: 0, t: 0, dir: 1, speed: rand(1.1, 1.6) });
    }
  }
  place(w, px, pz, near) {
    for (let tries = 0; tries < 30; tries++) {
      const bi = Math.floor(Math.random() * (NX - 1)), bj = Math.floor(Math.random() * (NZ - 1));
      if (bj === RIVER_ROW) continue;
      const cx = (bi + 0.5) * B, cz = (bj + 0.5) * B;
      const d = Math.hypot(cx - px, cz - pz);
      if (near && d > 220) continue;
      if (!near && (d < 140 || d > 260)) continue;
      w.bi = bi; w.bj = bj; w.t = Math.random(); w.dir = Math.random() < 0.5 ? 1 : -1;
      return;
    }
  }
  init(px, pz) { for (const w of this.walkers) this.place(w, px, pz, true); }
  update(dt, px, pz) {
    const inset = 9.4, L = B - 2 * inset;
    for (const w of this.walkers) {
      const cx0 = w.bi * B + inset, cz0 = w.bj * B + inset;
      const d = Math.hypot(cx0 + L / 2 - px, cz0 + L / 2 - pz);
      if (d > 280) { this.place(w, px, pz, false); continue; }
      w.t = (w.t + (w.dir * w.speed * dt) / (4 * L) + 1) % 1;
      const s = w.t * 4 * L;
      let x, z, fx, fz;
      if (s < L) { x = cx0 + s; z = cz0; fx = 1; fz = 0; }
      else if (s < 2 * L) { x = cx0 + L; z = cz0 + (s - L); fx = 0; fz = 1; }
      else if (s < 3 * L) { x = cx0 + L - (s - 2 * L); z = cz0 + L; fx = -1; fz = 0; }
      else { x = cx0; z = cz0 + L - (s - 3 * L); fx = 0; fz = -1; }
      // walk on the outer edge of the pavement depending on direction
      w.p.group.position.set(x, 0.15, z);
      w.p.face(fx * w.dir, fz * w.dir);
      const vis = d < 200;
      w.p.group.visible = vis;
      if (vis) w.p.walkAnim(dt, w.speed);
    }
  }
}

// --------------------------------------------------------------- passenger personalities
const FIRST = ['James', 'Priya', 'Tom', 'Aisha', 'Oliver', 'Mei', 'Hannah', 'Kwame', 'Sophie', 'Raj', 'Emily', 'Carlos', 'Fatima', 'George', 'Chloe', 'Dmitri', 'Grace', 'Liam', 'Nadia', 'Arthur', 'Yuki', 'Bridget', 'Ade', 'Margaret'];

export const PAX_TYPES = [
  {
    type: 'Tourist', card: 0.85, tip: [0.0, 0.18], hurry: 0.15, receipt: 0.2,
    hello: ['Hello! Are you free?', 'Oh wonderful, a real black cab!', 'Hi there! Can you take us somewhere?'],
    chat: [
      ['Is it always this grey in London?', ['Only on days ending in Y!', 'You get used to it.']],
      ['Do you really have to learn every street?', ["It's called The Knowledge. Took me four years.", 'Every single one, mate.']],
      ['What should we see while we\'re here?', ['Get up the Shard at sunset.', 'Borough Market — trust me.']],
    ],
  },
  {
    type: 'Banker', card: 0.97, tip: [0.05, 0.22], hurry: 0.65, receipt: 0.8,
    hello: ['Taxi! Quickly please.', 'You free? Great.'],
    chat: [
      ['Markets are all over the place today.', ['Never a dull day in the City.', "I'll stick to the meter, thanks."]],
      ['Can you go any faster? I\'m late.', ["I'll do my best, guv.", 'Safety first, sir.']],
    ],
  },
  {
    type: 'Pensioner', card: 0.3, tip: [0.0, 0.12], hurry: 0, receipt: 0.3,
    hello: ['Oh, thank you dear.', 'Hello love, are you for hire?'],
    chat: [
      ['London\'s changed so much since my day.', ['Still the best city in the world though.', 'Hasn\'t it just.']],
      ['My grandson wants to be a cabbie.', ['Tell him to start on The Knowledge now!', 'Good lad.']],
    ],
  },
  {
    type: 'Student', card: 0.7, tip: [0, 0.05], hurry: 0.3, receipt: 0.05,
    hello: ['Hiya! Are you free?', 'Alright? Can you take me somewhere?'],
    chat: [
      ['This is going to eat my whole loan, isn\'t it?', ["I'll take the quick way.", 'Bus is cheaper, to be fair.']],
      ['Got an exam tomorrow. Terrified.', ["You'll smash it.", 'Good luck, mate!']],
    ],
  },
  {
    type: 'Commuter', card: 0.9, tip: [0, 0.1], hurry: 0.5, receipt: 0.5,
    hello: ['Evening. You free?', 'Hi, can you take me?'],
    chat: [
      ['Tube\'s on strike again.', ['Good for business!', 'Nightmare, isn\'t it.']],
      ['Long day. Very long day.', ['Sit back, I\'ll get you there.', 'Tell me about it.']],
    ],
  },
  {
    type: 'Night Out', card: 0.6, tip: [0.1, 0.3], hurry: 0.2, receipt: 0.02, night: true,
    hello: ['TAXIIII! Oh my days, you stopped!', 'Mate! Legend! Are you free?'],
    chat: [
      ['Can you put some music on?', ['Only Magic FM in this cab.', 'Best I can do is the radio news.']],
      ['I love you, cabbie. I love London.', ["Love you too. Don't be sick in my cab.", 'Steady on!']],
    ],
  },
];

export function makePassenger(night) {
  const pool = PAX_TYPES.filter((t) => (night ? true : !t.night));
  const t = pick(pool);
  return {
    name: pick(FIRST),
    type: t.type,
    def: t,
    look: randomLook(),
    payCard: Math.random() < t.card,
    tipRate: rand(t.tip[0], t.tip[1]),
    hurry: Math.random() < t.hurry,
    wantsReceipt: Math.random() < t.receipt,
    mood: 75,
    chatted: 0,
  };
}
