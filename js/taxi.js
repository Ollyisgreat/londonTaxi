import * as THREE from 'three';
import { buildCab } from './vehicles.js';
import { GeoBuilder, makeCanvas, canvasTex, clamp, smooth, fmtMoney } from './util.js';

const WHEELBASE = 2.9;
export const EYE = new THREE.Vector3(0.44, 1.43, 0.08); // driver sits on the RIGHT

export class Taxi {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.model = buildCab({ separateWheels: true });
    this.group.add(this.model);
    this.x = 0;
    this.z = 0;
    this.heading = 0;
    this.vx = 0;
    this.vz = 0;
    this.speed = 0; // signed forward speed
    this.steer = 0;
    this.gear = 'D';
    this.reverseHold = 0;
    this.pitch = 0;
    this.roll = 0;
    this.accelLong = 0;
    this.accelLat = 0;
    this.wheelSpin = 0;
    this.odometer = 0;
    this.lastImpact = 0;
    this.indicator = 0; // -1 left, 1 right
    this.hazards = false;
    this.headlights = false;
    this.wipers = 0; // 0 off 1 on
    this.wiperT = 0;
    this.doorsLocked = true;
    this.forHire = true;
    this.buildInterior();
    this.buildHeadlights();
  }

  get fwdX() { return -Math.sin(this.heading); }
  get fwdZ() { return -Math.cos(this.heading); }

  place(x, z, heading) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.vx = this.vz = this.speed = 0;
    this.syncMesh();
  }

  buildHeadlights() {
    const l = new THREE.SpotLight('#fff4dc', 0, 70, 0.55, 0.5, 1.2);
    l.position.set(0, 0.9, -2.2);
    l.target.position.set(0, 0, -20);
    this.group.add(l, l.target);
    this.headLight = l;
    const l2 = new THREE.PointLight('#ffe0b0', 0, 4, 2);
    l2.position.set(0, 1.7, 0.9);
    this.group.add(l2);
    this.cabinLight = l2;
  }

  // ------------------------------------------------------------ interior
  buildInterior() {
    const I = new THREE.Group();
    this.interior = I;
    this.group.add(I);
    const b = new GeoBuilder();
    const dash = '#232326', dash2 = '#2e2e31', trim = '#3a3a3d', liner = '#8d8a83', floor = '#1c1c1c';
    // dashboard
    b.box(0, 0.93, -0.84, 1.86, 0.34, 0.46, dash);
    b.box(0, 1.1, -0.92, 1.86, 0.06, 0.32, dash2, 0, -0.18);
    // instrument binnacle over the cluster
    b.box(EYE.x, 1.17, -0.64, 0.46, 0.04, 0.16, dash, 0, -0.1);
    b.box(EYE.x - 0.22, 1.08, -0.6, 0.03, 0.16, 0.1, dash);
    b.box(EYE.x + 0.22, 1.08, -0.6, 0.03, 0.16, 0.1, dash);
    // air vents
    for (const x of [-0.75, -0.18, 0.12, 0.82]) {
      b.box(x, 1.0, -0.575, 0.14, 0.06, 0.02, '#111');
      for (let k = 0; k < 4; k++) b.box(x, 0.98 + k * 0.012, -0.57, 0.13, 0.004, 0.015, '#555');
    }
    // centre console
    b.box(0.0, 0.7, -0.45, 0.28, 0.3, 0.5, dash);
    b.box(0.0, 0.86, -0.32, 0.26, 0.02, 0.3, '#1a1a1a');
    // gear selector buttons P R N D
    ['#c33', '#ddd', '#ddd', '#3c3'].forEach((c, k) => b.box(0.06, 0.875, -0.46 + k * 0.045, 0.05, 0.015, 0.035, c));
    // coin holder tubes
    const coins = [['#b87333', 0.009], ['#c0c0c0', 0.011], ['#d4af37', 0.012], ['#c0c0c0', 0.013], ['#e0e0e0', 0.014]];
    coins.forEach(([c, r], k) => b.cyl(-0.07 + (k % 3) * 0.035, 0.89, -0.25 - Math.floor(k / 3) * 0.04, r, r, 0.04, 10, c));
    // A-pillars, header, roof liner
    const pillar = (x0, x1) => {
      const a = new THREE.Vector3(x0, 1.1, -1.03), c = new THREE.Vector3(x1, 1.78, -0.46);
      const dir = c.clone().sub(a);
      const len = dir.length();
      const g = new THREE.BoxGeometry(0.065, len, 0.065);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      b.add(g, new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)), trim);
    };
    pillar(-0.9, -0.86);
    pillar(0.9, 0.86);
    b.box(0, 1.8, -0.43, 1.9, 0.08, 0.12, liner);
    b.box(0, 1.85, 0.85, 1.9, 0.04, 2.7, liner);
    // doors & sills
    for (const s of [-1, 1]) {
      b.box(s * 0.94, 0.8, -0.35, 0.06, 0.6, 1.3, '#2b2b2e');
      b.box(s * 0.9, 0.98, -0.3, 0.08, 0.05, 0.6, '#3d3d40');
      b.box(s * 0.95, 1.12, -0.35, 0.05, 0.04, 1.3, '#444');
      b.box(s * 0.93, 1.45, 0.07, 0.07, 0.68, 0.1, trim); // B pillar
      b.box(s * 0.94, 0.85, 1.3, 0.06, 0.7, 1.9, '#2b2b2e');
      b.box(s * 0.94, 1.45, 2.15, 0.07, 0.68, 0.14, trim);
    }
    // luggage platform on the left front (no front passenger seat in a London cab)
    b.box(-0.45, 0.48, -0.25, 0.85, 0.06, 0.95, floor);
    b.box(-0.5, 0.65, -0.2, 0.42, 0.28, 0.2, '#5a3b23'); // a bag
    b.box(-0.5, 0.82, -0.2, 0.18, 0.04, 0.03, '#2a1a10');
    // driver seat (mostly out of view)
    b.box(EYE.x, 0.62, 0.15, 0.5, 0.14, 0.5, '#151515');
    b.box(EYE.x, 1.05, 0.42, 0.5, 0.8, 0.12, '#151515', 0, 0.1);
    // partition
    b.box(0, 0.75, 0.58, 1.86, 0.5, 0.05, '#2f2f33');
    b.box(0, 1.79, 0.58, 1.86, 0.06, 0.06, '#222');
    b.box(-0.08, 1.38, 0.58, 0.04, 0.8, 0.06, '#222');
    b.box(0, 1.0, 0.58, 1.86, 0.04, 0.07, '#222');
    // intercom grille + speaker
    b.box(0.45, 0.88, 0.545, 0.2, 0.1, 0.02, '#111');
    for (let k = 0; k < 5; k++) b.box(0.45, 0.85 + k * 0.016, 0.54, 0.18, 0.006, 0.01, '#444');
    // rear compartment: bench seat, jump seats, yellow grab handles
    b.box(0, 0.62, 1.75, 1.7, 0.18, 0.62, '#111');
    b.box(0, 1.05, 2.1, 1.7, 0.8, 0.14, '#121212', 0, -0.12);
    b.box(-0.55, 0.85, 0.75, 0.48, 0.5, 0.08, '#161616');
    b.box(0.55, 0.85, 0.75, 0.48, 0.5, 0.08, '#161616');
    for (const s of [-1, 1]) {
      b.box(s * 0.88, 1.45, 1.0, 0.04, 0.5, 0.04, '#f1c40f');
      b.box(s * 0.88, 1.7, 1.5, 0.04, 0.04, 0.5, '#f1c40f');
    }
    b.box(0, 0.47, 1.2, 1.8, 0.04, 1.8, floor);
    b.box(0, 0.47, -0.4, 1.8, 0.04, 1.2, floor);
    // windscreen wiper pivots
    b.box(0, 1.09, -1.08, 1.7, 0.03, 0.06, '#111');
    const mesh = b.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), false);
    I.add(mesh);

    // partition glass
    const pg = new THREE.Mesh(new THREE.PlaneGeometry(1.84, 0.76), new THREE.MeshStandardMaterial({ color: '#cfe6ee', transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }));
    pg.position.set(0, 1.39, 0.58);
    I.add(pg);
    // partition stickers (visible when you turn round)
    const sticker = (lines, bg, fg, w, h, x, y) => {
      const c = makeCanvas(256, Math.round((256 * h) / w)), g = c.getContext('2d');
      g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      lines.forEach((l, i) => { g.font = `bold ${l[1]}px Arial, sans-serif`; g.fillText(l[0], 128, ((i + 0.5) * c.height) / lines.length, 240); });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: canvasTex(c, false), side: THREE.DoubleSide }));
      m.position.set(x, y, 0.575);
      m.rotation.y = Math.PI;
      I.add(m);
    };
    sticker([['LICENSED HACKNEY', 22], ['CARRIAGE', 22], ['No. 21847', 30]], '#fff', '#111', 0.16, 0.12, -0.6, 1.62);
    sticker([['NO SMOKING', 34]], '#fff', '#c8102e', 0.14, 0.05, 0.3, 1.7);
    sticker([['CARD & CONTACTLESS', 20], ['ACCEPTED HERE', 20]], '#1b2a5a', '#fff', 0.16, 0.07, -0.3, 1.1);

    // steering wheel
    const sw = new THREE.Group();
    sw.position.set(EYE.x, 1.02, -0.43);
    sw.rotation.x = -0.38;
    const swInner = new THREE.Group();
    sw.add(swInner);
    const leather = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.55 });
    swInner.add(new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 10, 40), leather));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16).rotateX(Math.PI / 2), leather);
    swInner.add(hub);
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.025, 16), new THREE.MeshStandardMaterial({ color: '#c0c0c0', metalness: 0.9, roughness: 0.2 }));
    badge.position.z = 0.031;
    swInner.add(badge);
    const spMat = new THREE.MeshStandardMaterial({ color: '#2a2a2a' });
    for (const [x, y, w, h] of [[-0.11, -0.015, 0.12, 0.03], [0.11, -0.015, 0.12, 0.03], [0, -0.11, 0.03, 0.12]]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), spMat);
      sp.position.set(x, y, 0);
      swInner.add(sp);
    }
    // indicator / wiper stalks
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.015, 0.015), new THREE.MeshStandardMaterial({ color: '#222' }));
    stalk.position.set(-0.17, 0.02, -0.06);
    sw.add(stalk);
    const stalk2 = stalk.clone();
    stalk2.position.x = 0.17;
    sw.add(stalk2);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.3, 10).rotateX(Math.PI / 2), leather);
    col.position.z = -0.17;
    sw.add(col);
    I.add(sw);
    this.wheelInner = swInner;
    this.indicatorStalk = stalk;

    // cluster screen
    this.clusterCanvas = makeCanvas(512, 200);
    this.clusterTex = canvasTex(this.clusterCanvas, false);
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.156), new THREE.MeshBasicMaterial({ map: this.clusterTex, toneMapped: false }));
    cl.position.set(EYE.x, 1.04, -0.6);
    cl.rotation.x = -0.18;
    I.add(cl);

    // taximeter on top of the dash
    this.meterCanvas = makeCanvas(512, 200);
    this.meterTex = canvasTex(this.meterCanvas, false);
    const mb = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.1, 0.09), new THREE.MeshStandardMaterial({ color: '#0d0d0d', roughness: 0.4 }));
    mb.position.set(-0.04, 1.17, -0.86);
    mb.rotation.x = -0.05;
    I.add(mb);
    const md = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.0976), new THREE.MeshBasicMaterial({ map: this.meterTex, toneMapped: false }));
    md.position.set(-0.04, 1.17, -0.814);
    md.rotation.x = -0.05;
    I.add(md);

    // card terminal in its cradle beside the meter
    this.termCanvas = makeCanvas(160, 200);
    this.termTex = canvasTex(this.termCanvas, false);
    const tb = new THREE.Group();
    tb.position.set(-0.32, 1.02, -0.56);
    tb.rotation.x = -0.75;
    tb.rotation.y = -0.25;
    const tbody = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.16, 0.03), new THREE.MeshStandardMaterial({ color: '#1e1e22', roughness: 0.5 }));
    tb.add(tbody);
    const tscr = new THREE.Mesh(new THREE.PlaneGeometry(0.064, 0.08), new THREE.MeshBasicMaterial({ map: this.termTex, toneMapped: false }));
    tscr.position.set(0, 0.03, 0.0155);
    tb.add(tscr);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
      const k = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.009, 0.004), new THREE.MeshStandardMaterial({ color: r === 3 ? ['#c62828', '#555', '#2e7d32'][c] : '#444' }));
      k.position.set(-0.022 + c * 0.022, -0.025 - r * 0.013, 0.016);
      tb.add(k);
    }
    I.add(tb);
    this.terminal3d = tb;

    // nav screen
    this.navCanvas = makeCanvas(320, 200);
    this.navTex = canvasTex(this.navCanvas, false);
    const nav = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.15), new THREE.MeshBasicMaterial({ map: this.navTex, toneMapped: false }));
    nav.position.set(0.0, 0.98, -0.605);
    nav.rotation.x = -0.25;
    I.add(nav);
    const navFrame = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.17, 0.02), new THREE.MeshStandardMaterial({ color: '#111' }));
    navFrame.position.set(0.0, 0.98, -0.62);
    navFrame.rotation.x = -0.25;
    I.add(navFrame);

    // rear-view mirror with live view of the back of the cab
    this.mirrorRT = new THREE.WebGLRenderTarget(384, 112);
    this.mirrorRT.texture.colorSpace = THREE.SRGBColorSpace;
    const mg = new THREE.PlaneGeometry(0.24, 0.07);
    const uv = mg.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    const mm = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ map: this.mirrorRT.texture }));
    mm.position.set(0.04, 1.69, -0.5);
    mm.rotation.y = 0.12;
    mm.rotation.x = 0.05;
    I.add(mm);
    const mf = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.085, 0.03), new THREE.MeshStandardMaterial({ color: '#111' }));
    mf.position.set(0.04, 1.69, -0.517);
    mf.rotation.y = 0.12;
    I.add(mf);
    const ms = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12), new THREE.MeshStandardMaterial({ color: '#111' }));
    ms.position.set(0.04, 1.77, -0.5);
    I.add(ms);
    this.mirrorCam = new THREE.PerspectiveCamera(24, 0.24 / 0.07, 0.1, 160);
    this.mirrorCam.position.set(0.02, 1.62, -0.45);
    this.mirrorCam.rotation.set(-0.04, Math.PI - 0.12, 0);
    this.group.add(this.mirrorCam);

    // windscreen glass + rain layer
    this.rainCanvas = makeCanvas(512, 256);
    this.rainTex = canvasTex(this.rainCanvas, false);
    const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.76, 0.92), new THREE.MeshBasicMaterial({ map: this.rainTex, transparent: true, depthWrite: false }));
    ws.position.set(0, 1.43, -0.745);
    ws.rotation.x = 0.705;
    I.add(ws);
    this.drops = [];

    // wipers
    this.wiperArms = [];
    for (const px of [-0.62, 0.08]) {
      const piv = new THREE.Group();
      piv.position.set(px, 1.1, -1.03);
      piv.rotation.x = 0.705;
      const blade = new THREE.Group();
      piv.add(blade);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.012, 0.012), new THREE.MeshStandardMaterial({ color: '#0a0a0a' }));
      arm.position.set(0.31, 0, 0.02);
      blade.add(arm);
      I.add(piv);
      this.wiperArms.push(blade);
    }

    // passenger seat anchor (child of the cab)
    this.paxAnchor = new THREE.Group();
    this.paxAnchor.position.set(-0.4, 0.62, 1.72);
    this.group.add(this.paxAnchor);
  }

  setCockpit(on) {
    this.interior.visible = on;
    this.model.userData.glass.visible = !on;
    this.model.userData.sign.visible = !on;
    this.model.userData.lights.visible = !on;
    this.cockpit = on;
  }

  // ------------------------------------------------------------ physics
  update(dt, input, city, traffic) {
    let throttle = input.throttle, brake = input.brake;
    const fx = this.fwdX, fz = this.fwdZ;
    const rx = -fz, rz = fx; // right vector
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * rx + this.vz * rz;

    // automatic gearbox: once stopped, release the brake and press it again (and hold) to select reverse.
    // Simply holding the brake while you wait at a kerb keeps you stopped in D.
    const brakeDown = brake > 0.5;
    if (this.gear === 'D') {
      if (Math.abs(vF) < 0.3 && !brakeDown) this.reverseArmed = true;
      if (Math.abs(vF) > 0.6 || throttle > 0.1) this.reverseArmed = false;
      if (this.reverseArmed && brakeDown && Math.abs(vF) < 0.3 && throttle < 0.1 && !input.handbrake) {
        this.reverseHold += dt;
        if (this.reverseHold > 0.45) { this.gear = 'R'; this.reverseHold = 0; this.reverseArmed = false; }
      } else this.reverseHold = 0;
    } else if (this.gear === 'R') {
      if (Math.abs(vF) < 0.3 && throttle > 0.5 && brake < 0.1) {
        this.reverseHold += dt;
        if (this.reverseHold > 0.2) { this.gear = 'D'; this.reverseHold = 0; }
      } else this.reverseHold = 0;
      [throttle, brake] = [brake, throttle];
    }
    const dir = this.gear === 'R' ? -1 : 1;
    const maxV = this.gear === 'R' ? 5 : 24;
    let a = 0;
    if (throttle > 0) a += dir * throttle * 3.4 * Math.max(0, 1 - Math.abs(vF) / maxV);
    if (brake > 0 && Math.abs(vF) > 0.05) a -= Math.sign(vF) * brake * 8.5;
    if (input.handbrake && Math.abs(vF) > 0.05) a -= Math.sign(vF) * 5;
    // resistance
    a -= Math.sign(vF) * (0.25 + 0.0016 * vF * vF);
    const newVF = vF + a * dt;
    if (Math.sign(newVF) !== Math.sign(vF) && vF !== 0 && throttle * dir * Math.sign(vF) <= 0) vF = 0;
    else vF = newVF;
    // creep in D like an automatic
    if (this.gear === 'D' && throttle === 0 && brake === 0 && !input.handbrake && vF < 1.2) vF = Math.min(1.2, vF + 0.6 * dt);
    if (this.gear === 'R' && throttle === 0 && brake === 0 && !input.handbrake && vF > -0.8) vF = Math.max(-0.8, vF - 0.4 * dt);
    if (input.handbrake && Math.abs(vF) < 0.4) vF = 0;

    // steering (London cab: famously tight turning circle)
    const maxSteer = 0.64 / (1 + Math.abs(vF) * 0.055);
    const target = input.steer * maxSteer;
    this.steer += clamp(target - this.steer, -2.4 * dt, 2.4 * dt);
    const yawRate = (vF * Math.tan(this.steer)) / WHEELBASE;
    this.heading += yawRate * dt;
    const grip = input.handbrake ? 1.2 : 9;
    vR *= Math.exp(-grip * dt);
    if (input.handbrake) vR += -yawRate * Math.abs(vF) * 0.05 * dt;

    const nfx = this.fwdX, nfz = this.fwdZ, nrx = -nfz, nrz = nfx;
    this.vx = nfx * vF + nrx * vR;
    this.vz = nfz * vF + nrz * vR;
    const px = this.x, pz = this.z;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // collisions
    let impact = 0;
    const circles = [1.35, 0, -1.35];
    for (let iter = 0; iter < 2; iter++)
      for (const o of circles) {
        const cx = this.x + nfx * o, cz = this.z + nfz * o;
        const h = city.collideCircle(cx, cz, 1.0);
        if (h) {
          this.x += h.x - cx;
          this.z += h.z - cz;
          const vn = this.vx * h.nx + this.vz * h.nz;
          if (vn < 0) {
            impact = Math.max(impact, -vn);
            this.vx -= h.nx * vn * 1.25;
            this.vz -= h.nz * vn * 1.25;
          }
        }
      }
    if (traffic) {
      const hit = traffic.collidePlayer(this);
      if (hit) impact = Math.max(impact, hit);
    }
    if (impact > 0) {
      // scrub speed
      const nvF = this.vx * nfx + this.vz * nfz;
      this.vx *= 0.85;
      this.vz *= 0.85;
      void nvF;
    }
    this.lastImpact = impact;
    this.speed = this.vx * nfx + this.vz * nfz;
    const moved = Math.hypot(this.x - px, this.z - pz);
    this.odometer += moved;
    this.accelLong = smooth(this.accelLong, a, 6, dt);
    this.accelLat = smooth(this.accelLat, yawRate * this.speed, 6, dt);
    this.wheelSpin += (this.speed / 0.36) * dt;
    this.syncMesh(dt);
    return moved;
  }

  syncMesh(dt = 0) {
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.heading;
    this.pitch = smooth(this.pitch, clamp(this.accelLong * 0.006, -0.04, 0.03), 8, dt || 1);
    this.roll = smooth(this.roll, clamp(-this.accelLat * 0.006, -0.04, 0.04), 8, dt || 1);
    this.model.rotation.x = -this.pitch;
    this.model.rotation.z = this.roll;
    this.interior.rotation.x = -this.pitch;
    this.interior.rotation.z = this.roll;
    for (const w of this.model.userData.wheels || []) {
      w.spin.rotation.x = -this.wheelSpin;
      if (w.front) w.piv.rotation.y = this.steer;
    }
    if (this.wheelInner) this.wheelInner.rotation.z = -this.steer * 5.5;
  }

  // ------------------------------------------------------------ displays
  drawCluster(state) {
    const g = this.clusterCanvas.getContext('2d');
    const W = 512, H = 200;
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, W, H);
    const mph = Math.abs(this.speed) * 2.237;
    // speedo
    const cx = 380, cy = 110, r = 80;
    g.strokeStyle = '#223';
    g.lineWidth = 10;
    g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
    g.strokeStyle = mph > 31 ? '#ff4d3d' : '#38b6ff';
    g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 0.75 + (Math.min(mph, 60) / 60) * Math.PI * 1.5); g.stroke();
    g.fillStyle = '#cfe8ff';
    g.font = 'bold 54px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(Math.round(mph), cx, cy - 6);
    g.font = '18px Arial, sans-serif';
    g.fillStyle = '#7f9db5';
    g.fillText('mph', cx, cy + 30);
    // 20 limit roundel
    g.fillStyle = '#fff'; g.beginPath(); g.arc(cx + 92, 32, 20, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#d22'; g.lineWidth = 5; g.beginPath(); g.arc(cx + 92, 32, 18, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#111'; g.font = 'bold 18px Arial'; g.fillText(state.limit || 30, cx + 92, 33);
    // left: power / battery
    g.textAlign = 'left';
    g.fillStyle = '#5ad17a';
    g.font = 'bold 20px Arial, sans-serif';
    g.fillText('READY', 20, 30);
    g.fillStyle = '#7f9db5';
    g.font = '16px Arial, sans-serif';
    g.fillText('BATTERY', 20, 70);
    g.fillStyle = '#223';
    g.fillRect(20, 82, 160, 16);
    g.fillStyle = state.battery < 0.2 ? '#ff4d3d' : '#5ad17a';
    g.fillRect(20, 82, 160 * state.battery, 16);
    g.fillStyle = '#cfe8ff';
    g.font = 'bold 18px Arial';
    g.fillText(Math.round(state.battery * 100) + '%', 190, 91);
    g.fillStyle = '#7f9db5';
    g.font = '16px Arial';
    g.fillText('ODO ' + (this.odometer / 1609 * 5).toFixed(1) + ' mi', 20, 125);
    g.fillText(state.clock, 20, 150);
    // gear
    g.font = 'bold 28px Arial';
    ['P', 'R', 'N', 'D'].forEach((gch, k) => {
      g.fillStyle = gch === this.gear ? '#fff' : '#3a4a5a';
      g.fillText(gch, 200 + k * 24, 175);
    });
    // indicators
    const blink = Math.floor(performance.now() / 380) % 2 === 0;
    if (blink && (this.indicator === -1 || this.hazards)) { g.fillStyle = '#3f3'; g.beginPath(); g.moveTo(230, 30); g.lineTo(250, 18); g.lineTo(250, 42); g.fill(); }
    if (blink && (this.indicator === 1 || this.hazards)) { g.fillStyle = '#3f3'; g.beginPath(); g.moveTo(290, 30); g.lineTo(270, 18); g.lineTo(270, 42); g.fill(); }
    if (this.headlights) { g.fillStyle = '#3af'; g.font = 'bold 18px Arial'; g.fillText('◐ ≡', 230, 70); }
    if (this.doorsLocked) { g.fillStyle = '#f7b500'; g.font = 'bold 16px Arial'; g.fillText('🔒 LOCKED', 205, 110); }
    this.clusterTex.needsUpdate = true;
  }

  drawMeter(meter, clockStr) {
    const g = this.meterCanvas.getContext('2d');
    const W = 512, H = 200;
    g.fillStyle = '#070303';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ff2a1a';
    g.textBaseline = 'middle';
    g.font = 'bold 30px "Courier New", monospace';
    g.textAlign = 'left';
    const st = meter.state === 'vacant' ? 'FOR HIRE' : meter.state === 'hired' ? 'HIRED' : 'STOPPED';
    g.fillStyle = meter.state === 'vacant' ? '#33ff66' : '#ff2a1a';
    g.fillText(st, 18, 30);
    g.fillStyle = '#ff2a1a';
    g.textAlign = 'right';
    g.fillText('TARIFF ' + meter.tariff, W - 18, 30);
    g.font = 'bold 92px "Courier New", monospace';
    const fare = meter.state === 'vacant' ? '- - . - -' : fmtMoney(meter.fare).replace('£', '');
    g.fillText(fare, W - 20, 112);
    g.textAlign = 'left';
    g.font = 'bold 48px "Courier New", monospace';
    g.fillText('£', 18, 112);
    g.font = 'bold 26px "Courier New", monospace';
    g.fillText('EXTRAS ' + fmtMoney(meter.extras || 0).replace('£', ''), 18, 176);
    g.textAlign = 'right';
    g.fillText(clockStr, W - 18, 176);
    this.meterTex.needsUpdate = true;
  }

  drawTerminal(lines) {
    const g = this.termCanvas.getContext('2d');
    g.fillStyle = '#d8e4d0';
    g.fillRect(0, 0, 160, 200);
    g.fillStyle = '#1a2a1a';
    g.font = 'bold 18px Arial';
    g.textAlign = 'center';
    lines.forEach((l, i) => g.fillText(l, 80, 40 + i * 34, 150));
    this.termTex.needsUpdate = true;
  }

  // rain drops on the windscreen
  updateRain(dt, raining, speed) {
    const g = this.rainCanvas.getContext('2d');
    if (raining) {
      const n = Math.random() < dt * (14 + Math.abs(speed) * 2) ? 2 : 0;
      for (let k = 0; k < n; k++) this.drops.push({ x: Math.random() * 512, y: Math.random() * 256, r: 1.5 + Math.random() * 3.5, vy: 0 });
    }
    // wipers clear drops in their sweep
    if (this.wipers) {
      this.wiperT += dt * 2.2;
      const ang = (Math.sin(this.wiperT * Math.PI) * 0.5 + 0.5) * 1.75;
      this.wiperArms.forEach((w) => (w.rotation.z = ang));
      const sweepX = (ang / 1.75) * 512;
      this.drops = this.drops.filter((d) => Math.abs(d.x - (512 - sweepX)) > 40 && Math.abs(d.x - (512 - sweepX) + 220) > 40);
    } else {
      this.wiperArms.forEach((w) => (w.rotation.z = smooth(w.rotation.z, 0, 6, dt)));
    }
    if (this.drops.length > 220) this.drops.splice(0, this.drops.length - 220);
    for (const d of this.drops) {
      d.vy += (d.r > 3.5 ? 18 : 0) * dt - Math.abs(speed) * 0.4 * dt;
      d.y += d.vy * dt * 3;
    }
    this.drops = this.drops.filter((d) => d.y > -10 && d.y < 270);
    g.clearRect(0, 0, 512, 256);
    for (const d of this.drops) {
      g.fillStyle = 'rgba(200,220,235,0.35)';
      g.beginPath();
      g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.beginPath();
      g.arc(d.x - d.r * 0.3, d.y - d.r * 0.3, d.r * 0.35, 0, Math.PI * 2);
      g.fill();
    }
    this.rainTex.needsUpdate = true;
  }
}
