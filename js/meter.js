// Taximeter, loosely modelled on TfL's tariffs (approximate).
// Game distances are compressed, so the meter scales distance/time up.
export const DIST_SCALE = 5;
export const TIME_SCALE = 3;
const SLOW_SPEED = 4.6; // m/s (~10mph): below this the meter charges on time

export const TARIFFS = {
  1: { label: 'Tariff 1 — Mon-Fri 05:00-20:00', min: 380, dist: 105, time: 22.6, initial: 2.2 },
  2: { label: 'Tariff 2 — Evenings & weekends', min: 380, dist: 86, time: 18.4, initial: 2.2 },
  3: { label: 'Tariff 3 — Nights 22:00-05:00', min: 380, dist: 72, time: 15.5, initial: 2.2 },
};

export function tariffFor(dayIndex, hour) {
  const weekend = dayIndex >= 5;
  if (hour >= 22 || hour < 5) return 3;
  if (weekend || hour >= 20) return 2;
  return 1;
}

export class Meter {
  constructor() {
    this.state = 'vacant';
    this.fare = 0;
    this.extras = 0;
    this.tariff = 1;
    this.acc = 0;
    this.onTick = null;
    this.distance = 0;
    this.seconds = 0;
  }
  start(tariff) {
    this.state = 'hired';
    this.tariff = tariff;
    this.fare = TARIFFS[tariff].min;
    this.acc = -TARIFFS[tariff].initial;
    this.extras = 0;
    this.distance = 0;
    this.seconds = 0;
  }
  stop() {
    if (this.state === 'hired') this.state = 'stopped';
  }
  clear() {
    this.state = 'vacant';
    this.fare = 0;
    this.extras = 0;
  }
  get total() {
    return this.fare + this.extras;
  }
  update(dt, speed, moved) {
    if (this.state !== 'hired') return;
    const t = TARIFFS[this.tariff];
    this.distance += moved * DIST_SCALE;
    this.seconds += dt * TIME_SCALE;
    if (Math.abs(speed) > SLOW_SPEED) this.acc += (moved * DIST_SCALE) / t.dist;
    else this.acc += (dt * TIME_SCALE) / t.time;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.fare += 20;
      if (this.onTick) this.onTick();
    }
  }
}
