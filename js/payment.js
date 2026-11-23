import { fmtMoney, pick, clamp } from './util.js';

export const DENOMS = [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
const NOTES = new Set([5000, 2000, 1000, 500]);
const label = (d) => (d >= 100 ? '£' + d / 100 : d + 'p');

export function startingFloat() {
  return { 5000: 0, 2000: 1, 1000: 3, 500: 4, 200: 6, 100: 10, 50: 10, 20: 12, 10: 12, 5: 10, 2: 10, 1: 10 };
}
export const floatTotal = (f) => DENOMS.reduce((a, d) => a + d * (f[d] || 0), 0);

function moneyEl(d, extra = '') {
  const el = document.createElement('div');
  if (NOTES.has(d)) {
    el.className = `note n${d} ${extra}`;
    el.innerHTML = `<span class="nv">${label(d)}</span><span class="nq"></span><span class="nb">BANK OF ENGLAND</span><span class="nv2">${d / 100}</span>`;
  } else {
    el.className = `coin c${d} ${extra}`;
    el.innerHTML = `<span>${label(d)}</span>`;
  }
  return el;
}

function greedy(amount, avail) {
  const out = [];
  for (const d of DENOMS) {
    let n = avail ? avail[d] || 0 : 99;
    while (amount >= d && n > 0) { out.push(d); amount -= d; n--; }
  }
  return amount === 0 ? out : null;
}

function makeTender(fare) {
  if (Math.random() < 0.12) return { items: greedy(fare), exact: true };
  const combos = [[500], [1000], [1000, 500], [2000], [2000, 500], [2000, 1000], [2000, 2000], [5000], [2000, 2000, 1000], [5000, 2000], [5000, 5000]];
  const ok = combos.map((c) => [c, c.reduce((a, b) => a + b, 0)]).filter(([, s]) => s >= fare).sort((a, b) => a[1] - b[1]);
  let k = 0;
  if (ok.length > 1 && Math.random() < 0.3) k = 1;
  if (ok.length > 2 && Math.random() < 0.08) k = 2;
  const c = ok[k] || [[5000, 5000, 5000], 15000];
  // sometimes add coins to make change easier ("I've got the 40p")
  const items = c[0].slice();
  const pence = fare % 100;
  if (!items.includes(5000) && pence && Math.random() < 0.25) items.push(...greedy(pence));
  return { items, exact: false };
}

export class Payment {
  constructor(root, sound) {
    this.root = root;
    this.sound = sound;
    this.active = false;
    this.txns = 0;
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  open(opts) {
    this.o = opts;
    this.active = true;
    this.root.classList.remove('hidden');
    this.result = { method: opts.pax.payCard ? 'card' : 'cash', received: 0, tip: 0, charged: 0, moodDelta: 0, notes: [], toFloat: {}, fromFloat: {} };
    this.root.innerHTML = '';
    const p = opts.pax;
    const head = document.createElement('div');
    head.className = 'pay-head';
    head.innerHTML = `
      <div class="pay-meter"><div class="lbl">METER</div><div class="val">${fmtMoney(opts.fare)}</div><div class="lbl">TARIFF ${opts.tariff}</div></div>
      <div class="pay-pax"><div class="pax-av" style="background:${p.look.top}"><div class="pax-face" style="background:${p.look.skin}"></div><div class="pax-hair" style="background:${p.look.hair}"></div></div>
      <div><div class="pax-name">${p.name}</div><div class="pax-type">${p.type}</div></div></div>`;
    this.root.appendChild(head);
    this.speech = document.createElement('div');
    this.speech.className = 'pay-speech';
    this.root.appendChild(this.speech);
    this.body = document.createElement('div');
    this.body.className = 'pay-body';
    this.root.appendChild(this.body);
    this.hint = document.createElement('div');
    this.hint.className = 'pay-hint';
    this.root.appendChild(this.hint);
    if (p.payCard) this.startCard(true);
    else this.startCash(true);
  }

  say(text, who = 'pax') {
    const name = who === 'pax' ? this.o.pax.name : 'You';
    this.speech.innerHTML = `<b>${name}:</b> ${text}`;
    this.speech.classList.remove('pop');
    void this.speech.offsetWidth;
    this.speech.classList.add('pop');
    if (this.o.onSay) this.o.onSay(text, who);
  }

  later(ms, fn) {
    const id = setTimeout(() => { if (this.active) fn(); }, ms);
    (this.timers ||= []).push(id);
  }

  close() {
    this.active = false;
    (this.timers || []).forEach(clearTimeout);
    this.timers = [];
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
  }

  finish() {
    const r = this.result;
    this.later(1400, () => {
      this.close();
      this.o.onDone(r);
    });
  }

  // ================================================================ CARD
  startCard(first) {
    const p = this.o.pax;
    this.term = { state: 'menu', amount: 0, inserted: false, declines: 0, needChip: this.o.fare > 10000 || Math.random() < 0.08 };
    this.body.innerHTML = `
      <div class="pdq-wrap">
        <div class="pdq">
          <div class="pdq-top"><span class="brand">PayCab</span><span class="sig">▂▄▆ 4G</span><span class="bat">▮▮▮▯</span></div>
          <div class="pdq-screen"><div class="s-title"></div><div class="s-body"></div><div class="s-foot"></div></div>
          <div class="pdq-ctls" title="Contactless">)))</div>
          <div class="pdq-keys">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => `<button data-k="${k}">${k}<small>${['', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ'][k - 1]}</small></button>`).join('')}
            <button data-k="*">*</button><button data-k="0">0</button><button data-k="#">#</button>
            <button data-k="X" class="kx">✕<small>CANCEL</small></button><button data-k="C" class="kc">&lt;<small>CLEAR</small></button><button data-k="E" class="ke">O<small>ENTER</small></button>
          </div>
          <div class="pdq-slot"></div>
          <div class="pdq-printer"><div class="receipt"></div></div>
        </div>
        <div class="card-anim"></div>
      </div>
      <div class="pay-side">
        <div class="steps">
          <div data-s="1">Select <b>1 · SALE</b></div>
          <div data-s="2">Key in the fare shown on the meter, press <b class="g">ENTER</b></div>
          <div data-s="3">Pass the terminal through the partition</div>
          <div data-s="4">Passenger pays</div>
          <div data-s="5">Customer copy? <b class="g">ENTER</b> = yes, <b class="r">CANCEL</b> = no</div>
        </div>
        <button class="big-btn" id="handBtn" disabled>Pass terminal to passenger ➜</button>
        <div class="kbd-tip">Tip: you can type on your keyboard — digits, Backspace = clear, Enter = OK, Esc = cancel</div>
      </div>`;
    this.scr = { t: this.body.querySelector('.s-title'), b: this.body.querySelector('.s-body'), f: this.body.querySelector('.s-foot') };
    this.body.querySelectorAll('.pdq-keys button').forEach((b) => b.addEventListener('click', () => this.press(b.dataset.k)));
    this.handBtn = this.body.querySelector('#handBtn');
    this.handBtn.addEventListener('click', () => this.handOver());
    this.cardAnim = this.body.querySelector('.card-anim');
    this.receipt = this.body.querySelector('.receipt');
    if (first) {
      this.say(pick(['Card alright?', 'Can I pay by card?', "I'll tap, if that's OK.", 'Contactless OK, mate?']) + (p.wantsReceipt ? ' And could I get a receipt please?' : ''));
    }
    this.renderTerm();
  }

  step(n) {
    this.body.querySelectorAll('.steps div').forEach((d) => d.classList.toggle('on', +d.dataset.s === n));
  }

  renderTerm() {
    const T = this.term, s = this.scr;
    const set = (t, b, f) => { s.t.innerHTML = t; s.b.innerHTML = b; s.f.innerHTML = f; };
    this.handBtn.disabled = T.state !== 'confirm';
    switch (T.state) {
      case 'menu': this.step(1); set('MAIN MENU', '<div class="menu">1. SALE<br>2. REFUND<br>3. X-REPORT<br>4. SETTINGS</div>', 'SELECT OPTION'); break;
      case 'amount': this.step(2); set('SALE', `<div class="small">ENTER AMOUNT</div><div class="amt">${fmtMoney(T.amount)}</div>`, 'ENTER TO CONFIRM'); break;
      case 'confirm': this.step(3); set('SALE', `<div class="amt">${fmtMoney(T.amount)}</div><div class="small">PASS TO CUSTOMER</div>`, ''); break;
      case 'tip': this.step(4); set('ADD A TIP?', `<div class="tips">${T.tipOpts.map((o, i) => `<span class="${i === T.tipSel ? 'sel' : ''}">${o === 0 ? 'NO TIP' : o + '%'}</span>`).join('')}</div>`, `SALE ${fmtMoney(T.amount)}`); break;
      case 'present': this.step(4); set(`TOTAL ${fmtMoney(T.total)}`, `<div class="cl-icon">)))</div><div class="small">${T.chip ? 'INSERT CARD' : 'PRESENT CARD'}</div>`, T.chip ? 'CONTACTLESS LIMIT — CHIP & PIN' : 'TAP · INSERT · SWIPE'); break;
      case 'pin': this.step(4); set(`TOTAL ${fmtMoney(T.total)}`, `<div class="small">ENTER PIN</div><div class="pin">${'*'.repeat(T.pin)}<span class="cur">_</span></div>`, 'PRESS ENTER'); break;
      case 'auth': this.step(4); set('PROCESSING', `<div class="small">${T.authMsg}</div><div class="dots"><i></i><i></i><i></i></div>`, 'DO NOT REMOVE CARD'); break;
      case 'declined': this.step(4); set('DECLINED', '<div class="bad">NOT AUTHORISED</div>', T.inserted ? 'REMOVE CARD' : ''); break;
      case 'approved': this.step(4); set('APPROVED', `<div class="ok">✔ ${fmtMoney(T.total)}</div><div class="small">AUTH CODE ${T.auth}</div>`, T.inserted ? 'PLEASE REMOVE CARD' : 'THANK YOU'); break;
      case 'receipt': this.step(5); set('CUSTOMER COPY?', '<div class="menu">PRINT CUSTOMER<br>RECEIPT?</div>', '<span class="g">ENTER</span>=YES &nbsp; <span class="r">CANCEL</span>=NO'); break;
      case 'done': this.step(0); set('', '<div class="ok">THANK YOU</div>', 'REMOVE RECEIPT'); break;
      case 'msg': set(T.msgT, `<div class="small">${T.msgB}</div>`, 'PRESS CANCEL'); break;
    }
    if (this.o.onTerminal) this.o.onTerminal([s.t.textContent, s.b.textContent.slice(0, 18), s.f.textContent.slice(0, 18)]);
  }

  onKey(e) {
    if (!this.active) return;
    if (this.term && this.result.method === 'card') {
      if (/^[0-9]$/.test(e.key)) this.press(e.key);
      else if (e.key === 'Backspace') this.press('C');
      else if (e.key === 'Enter') this.press('E');
      else if (e.key === 'Escape') this.press('X');
      else return;
      e.preventDefault();
      e.stopPropagation();
    }
  }

  press(k) {
    const T = this.term;
    if (!T || this.result.method !== 'card') return;
    const driverHas = ['menu', 'amount', 'confirm', 'receipt', 'msg'].includes(T.state);
    if (!driverHas) { this.sound.tone(500, 0.08, 'square', 0.05); return; }
    this.sound.key();
    if (T.state === 'msg') { if (k === 'X' || k === 'E') { T.state = 'menu'; this.renderTerm(); } return; }
    if (T.state === 'menu') {
      if (k === '1') { T.state = 'amount'; T.amount = 0; }
      else if (k === '2') { T.state = 'msg'; T.msgT = 'REFUND'; T.msgB = 'SUPERVISOR CARD REQUIRED'; }
      else if (k === '3') { T.state = 'msg'; T.msgT = 'X-REPORT'; T.msgB = `${this.txns} TXNS THIS SHIFT`; }
      else if (k === '4') { T.state = 'msg'; T.msgT = 'SETTINGS'; T.msgB = 'ENTER ENGINEER PIN'; }
    } else if (T.state === 'amount') {
      if (/^[0-9]$/.test(k)) { if (T.amount < 100000) T.amount = T.amount * 10 + +k; }
      else if (k === 'C') T.amount = Math.floor(T.amount / 10);
      else if (k === 'X') T.state = 'menu';
      else if (k === 'E') {
        if (T.amount === 0) { this.sound.declined(); return; }
        T.state = 'confirm';
      }
    } else if (T.state === 'confirm') {
      if (k === 'X') T.state = 'amount';
      else if (k === 'E') { this.handOver(); return; }
    } else if (T.state === 'receipt') {
      if (k === 'E') { this.printReceipt(true); return; }
      if (k === 'X') { this.printReceipt(false); return; }
    }
    this.renderTerm();
  }

  handOver() {
    const T = this.term;
    if (T.state !== 'confirm') return;
    const fare = this.o.fare;
    this.body.querySelector('.pdq').classList.add('away');
    this.say('…', 'pax');
    if (T.amount > fare) {
      this.later(1300, () => {
        this.result.moodDelta -= 12;
        this.say(pick([`Hang on — the meter says ${fmtMoney(fare)}, not ${fmtMoney(T.amount)}!`, `Er, that's more than the meter. It says ${fmtMoney(fare)}.`, `Nice try. Meter says ${fmtMoney(fare)}, mate.`]));
        this.body.querySelector('.pdq').classList.remove('away');
        T.state = 'amount';
        T.amount = 0;
        this.renderTerm();
      });
      return;
    }
    if (T.amount < fare) this.result.notes.push(`You undercharged by ${fmtMoney(fare - T.amount)}`);
    // tip prompt (passenger chooses)
    T.tipOpts = [0, 10, 12.5, 15];
    T.tipSel = -1;
    T.state = 'tip';
    this.renderTerm();
    const p = this.o.pax;
    const moodF = clamp((p.mood - 30) / 60, 0, 1.2);
    const want = p.tipRate * moodF * 100;
    let best = 0, bd = 1e9;
    T.tipOpts.forEach((o, i) => { if (Math.abs(o - want) < bd) { bd = Math.abs(o - want); best = i; } });
    this.later(900, () => { T.tipSel = 0; this.renderTerm(); });
    for (let i = 1; i <= best; i++) this.later(900 + i * 350, () => { T.tipSel = i; this.renderTerm(); this.sound.key(); });
    this.later(1300 + best * 350 + 600, () => {
      const pct = T.tipOpts[best];
      T.tip = Math.round((T.amount * pct) / 100);
      T.total = T.amount + T.tip;
      if (pct > 0) this.say(pick([`I'll add ${pct}% for you.`, `There's a bit extra for you.`, 'Tip added — cheers!']));
      else if (p.mood < 40) this.say('No tip. Not after that driving.');
      T.chip = T.needChip;
      T.state = 'present';
      this.renderTerm();
      this.later(1100, () => this.presentCard());
    });
  }

  presentCard() {
    const T = this.term;
    const ca = this.cardAnim;
    ca.className = 'card-anim show ' + (T.chip ? 'insert' : 'tap');
    ca.innerHTML = `<div class="bank-card ${pick(['c1', 'c2', 'c3', 'c4'])}"><div class="chip"></div><div class="cnum">•••• •••• •••• ${1000 + Math.floor(Math.random() * 8999)}</div><div class="cname">${this.o.pax.name.toUpperCase()}</div><div class="cl">)))</div></div>`;
    if (T.chip) {
      this.later(1200, () => {
        T.inserted = true;
        this.sound.click();
        T.state = 'pin';
        T.pin = 0;
        this.renderTerm();
        for (let i = 1; i <= 4; i++) this.later(450 * i, () => { T.pin = i; this.sound.key(); this.renderTerm(); });
        this.later(2300, () => this.authorise());
      });
    } else {
      this.later(900, () => { this.sound.beep(); this.authorise(); });
    }
  }

  authorise() {
    const T = this.term;
    T.state = 'auth';
    T.authMsg = 'CONNECTING…';
    this.renderTerm();
    this.later(800, () => { T.authMsg = 'AUTHORISING…'; this.renderTerm(); });
    this.later(1800, () => {
      const decline = T.declines === 0 ? Math.random() < 0.07 : Math.random() < 0.3;
      if (decline) {
        T.declines++;
        T.state = 'declined';
        this.sound.declined();
        this.renderTerm();
        this.later(1500, () => {
          this.cardAnim.className = 'card-anim';
          if (T.declines >= 2) {
            this.say("Oh, how embarrassing. I'll pay cash.");
            this.later(1600, () => { this.result.method = 'cash'; this.term = null; this.startCash(false); });
          } else {
            this.say(pick(["That's weird. Try this one.", 'Hmm. Let me try my other card.', "Ugh, my bank. Here's another."]));
            T.state = 'present';
            T.inserted = false;
            this.renderTerm();
            this.later(1300, () => this.presentCard());
          }
        });
        return;
      }
      T.state = 'approved';
      T.auth = Math.random().toString(36).slice(2, 8).toUpperCase();
      this.sound.approved();
      this.renderTerm();
      this.later(T.inserted ? 1500 : 1000, () => {
        this.cardAnim.className = 'card-anim';
        T.inserted = false;
        this.body.querySelector('.pdq').classList.remove('away');
        T.state = 'receipt';
        this.renderTerm();
        this.say(pick(['Thanks!', 'Lovely, thank you.', 'Cheers.']));
      });
    });
  }

  printReceipt(yes) {
    const T = this.term, p = this.o.pax;
    this.txns++;
    if (yes) {
      this.sound.printer();
      const d = this.o.when || '';
      this.receipt.innerHTML = `<b>PAYCAB</b><br>LONDON HACKNEY CARRIAGE<br>LIC No 21847<br>${d}<br>------------------<br>SALE ${fmtMoney(T.amount)}<br>TIP ${fmtMoney(T.tip)}<br><b>TOTAL ${fmtMoney(T.total)}</b><br>CONTACTLESS ${T.chip ? 'CHIP+PIN' : ''}<br>AUTH ${T.auth}<br>------------------<br>CUSTOMER COPY<br>THANK YOU`;
      this.receipt.parentElement.classList.add('printing');
      if (p.wantsReceipt) { this.result.moodDelta += 4; this.say('Perfect, thanks for the receipt.'); }
      else this.say("Oh, I don't need that — but thanks.");
    } else if (p.wantsReceipt) {
      this.result.moodDelta -= 8;
      this.say('Er... I did ask for a receipt. Never mind.');
    }
    T.state = 'done';
    this.renderTerm();
    this.result.charged = T.amount;
    this.result.tip = T.tip;
    this.result.received = T.total;
    this.finish();
  }

  // ================================================================ CASH
  startCash(first) {
    const fare = this.o.fare, p = this.o.pax;
    const t = makeTender(fare);
    const tendered = t.items.reduce((a, b) => a + b, 0);
    let expected = tendered - fare;
    let line;
    if (t.exact) { line = pick(["There you go — exact money.", "I think that's the right amount."]); expected = 0; }
    else {
      const tipWant = Math.round(fare * p.tipRate * clamp((p.mood - 30) / 60, 0, 1.2));
      const roundTo = Math.ceil((fare + tipWant) / 100) * 100;
      if (expected > 0 && expected <= 200 && p.tipRate > 0.05 && p.mood > 55) { line = pick(['Keep the change.', "Keep the change, mate.", 'Call it square, keep the rest.']); expected = 0; }
      else if (tipWant >= 50 && roundTo < tendered && p.mood > 50) { line = `Here's ${t.items.length > 1 ? 'that' : label(t.items[0])} — make it ${fmtMoney(roundTo)}.`; expected = tendered - roundTo; }
      else line = pick([`Here's ${label(t.items[0])}${t.items.length > 1 ? ' and a bit' : ''}.`, 'Cash OK? There you go.', tendered >= 5000 ? "Sorry, I've only got a fifty." : 'Here you are.']);
    }
    this.cash = { tendered, items: t.items, expected, tray: [], tries: 0 };
    this.result.method = 'cash';
    this.say(line);
    this.body.innerHTML = `
      <div class="cash-wrap">
        <div class="cash-row"><div class="cash-lbl">Passenger hands you <b>${fmtMoney(tendered)}</b></div><div class="tendered"></div></div>
        <div class="cash-row"><div class="cash-lbl">Change to give: <b class="tray-total">£0.00</b> <span class="muted">(work it out yourself — no calculator in a cab!)</span></div><div class="tray"></div></div>
        <div class="cash-lbl">Your money bag & coin dispenser — click to take out</div>
        <div class="float"></div>
        <div class="cash-actions"><button class="big-btn" id="giveBtn">Hand over change</button></div>
      </div>`;
    const ten = this.body.querySelector('.tendered');
    t.items.forEach((d, i) => { const el = moneyEl(d, 'in'); el.style.animationDelay = i * 0.15 + 's'; ten.appendChild(el); });
    this.sound.note();
    this.renderFloat();
    this.body.querySelector('#giveBtn').addEventListener('click', () => this.giveChange());
    void first;
  }

  renderFloat() {
    const f = this.o.float;
    const box = this.body.querySelector('.float');
    box.innerHTML = '';
    for (const d of DENOMS) {
      const n = f[d] || 0;
      const slot = document.createElement('div');
      slot.className = 'fslot' + (n === 0 ? ' empty' : '');
      const el = moneyEl(d);
      slot.appendChild(el);
      const c = document.createElement('div');
      c.className = 'fcount';
      c.textContent = '×' + n;
      slot.appendChild(c);
      slot.addEventListener('click', () => {
        if ((f[d] || 0) <= 0) { this.sound.tone(300, 0.08, 'square', 0.05); return; }
        f[d]--;
        this.cash.tray.push(d);
        NOTES.has(d) ? this.sound.note() : this.sound.coins();
        this.renderFloat();
        this.renderTray();
      });
      box.appendChild(slot);
    }
  }

  renderTray() {
    const tray = this.body.querySelector('.tray');
    tray.innerHTML = '';
    const f = this.o.float;
    this.cash.tray.slice().sort((a, b) => b - a).forEach((d) => {
      const el = moneyEl(d, 'small');
      el.title = 'Click to put back';
      el.addEventListener('click', () => {
        const i = this.cash.tray.indexOf(d);
        if (i >= 0) this.cash.tray.splice(i, 1);
        f[d] = (f[d] || 0) + 1;
        this.renderFloat();
        this.renderTray();
      });
      tray.appendChild(el);
    });
    this.body.querySelector('.tray-total').textContent = fmtMoney(this.cash.tray.reduce((a, b) => a + b, 0));
  }

  giveChange() {
    const C = this.cash, f = this.o.float;
    const given = C.tray.reduce((a, b) => a + b, 0);
    const diff = given - C.expected;
    if (diff < 0) {
      C.tries++;
      this.result.moodDelta -= 10;
      this.say(pick([`Erm… I think you're ${fmtMoney(-diff)} short.`, `That's not right — you owe me another ${fmtMoney(-diff)}.`, `Hang on, I'm ${fmtMoney(-diff)} short there.`]));
      this.sound.declined();
      return;
    }
    // take the passenger's money
    for (const d of C.items) f[d] = (f[d] || 0) + 1;
    let kept = given;
    if (diff > 0) {
      if (Math.random() < 0.6) {
        this.say(pick([`You've given me ${fmtMoney(diff)} too much — here.`, `Oops, that's too much. Have ${fmtMoney(diff)} back.`]));
        const back = greedy(diff) || [];
        for (const d of back) f[d] = (f[d] || 0) + 1;
        kept = C.expected;
      } else {
        this.say(pick(['Cheers! Lovely.', 'Ta very much.']));
        this.result.notes.push(`You overpaid change by ${fmtMoney(diff)}`);
        this.result.moodDelta += 3;
      }
    } else {
      this.result.moodDelta += 4;
      this.say(C.expected === 0 ? pick(['Ta, have a good one!', 'Cheers drive!']) : pick(['Perfect, cheers!', 'Spot on, thanks.', 'Thanks — have a good one!']));
    }
    this.sound.cash();
    C.tray = [];
    const net = C.tendered - kept;
    this.result.received = net;
    this.result.charged = Math.min(this.o.fare, net);
    this.result.tip = Math.max(0, net - this.o.fare);
    this.body.querySelector('#giveBtn').disabled = true;
    this.txns++;
    this.finish();
  }
}
