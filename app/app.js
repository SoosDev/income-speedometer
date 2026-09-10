import { DEFAULTS, snapshot, toYmd, parseLocalDate, MONTH_MS } from './calc.js';

const STORAGE_KEY = 'income-speedometer:v1';
const SEGMENTS = 40;
const CELLS = 40;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// ---------- storage ----------
function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS, boosts: [] };
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULTS, boosts: [] };
  }
}
function sanitize(obj) {
  const cfg = { ...DEFAULTS, ...obj };
  cfg.workDays = Array.isArray(cfg.workDays) ? cfg.workDays.map(Number).filter((d) => d >= 0 && d <= 6) : [...DEFAULTS.workDays];
  cfg.boosts = Array.isArray(cfg.boosts) ? cfg.boosts.filter((b) => b && b.date && isFinite(Number(b.amount))) : [];
  for (const k of ['goalAmount', 'startBalance', 'netMonthly', 'spendMonthly']) cfg[k] = Number(cfg[k]) || 0;
  if (!['cyan', 'green', 'amber'].includes(cfg.phosphor)) cfg.phosphor = 'cyan';
  return cfg;
}
function saveConfig(cfg) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch { /* private mode: keep running in memory */ }
}

let cfg = loadConfig();

// ---------- formatting ----------
const fmt0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthYear = (ms) => { const d = new Date(ms); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

// ---------- gauge geometry ----------
const CX = 175, CY = 178, R1 = 130, R2 = 156;
function pt(r, deg) { const a = (deg - 90) * Math.PI / 180; return [CX + r * Math.cos(a), CY + r * Math.sin(a)]; }
const segAngle = (i) => -100 + 200 * (i + 0.5) / SEGMENTS;
const NS = 'http://www.w3.org/2000/svg';
function line(deg) {
  const [x1, y1] = pt(R1, deg); const [x2, y2] = pt(R2, deg);
  const el = document.createElementNS(NS, 'line');
  el.setAttribute('x1', x1.toFixed(1)); el.setAttribute('y1', y1.toFixed(1));
  el.setAttribute('x2', x2.toFixed(1)); el.setAttribute('y2', y2.toFixed(1));
  return el;
}

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const el = {
  dest: $('dest'), destLbl: $('destLbl'), pace: $('pace'), saveRate: $('saveRate'), reqRate: $('reqRate'), earnRate: $('earnRate'),
  clock: $('clock'), pct: $('pct'), total: $('total'), today: $('today'), eta: $('eta'), cells: $('cells'),
  tlStart: $('tlStart'), tlDeadline: $('tlDeadline'), tlEnd: $('tlEnd'), freedom: $('freedom'),
  segOff: $('segOff'), segOn: $('segOn'), segReq: $('segReq'), reqLine: $('reqLine'), segLabels: $('segLabels'), earnMark: $('earnMark'),
};

const offLines = [], onLines = [];
for (let i = 0; i < SEGMENTS; i++) {
  const a = segAngle(i);
  const off = line(a); el.segOff.appendChild(off); offLines.push(off);
  const on = line(a); on.style.display = 'none'; el.segOn.appendChild(on); onLines.push(on);
}
const labelEls = [];
for (let i = 0; i < 4; i++) {
  const t = document.createElementNS(NS, 'text');
  const [x, y] = pt(R2 + 16, -100 + 200 * i / 3);
  t.setAttribute('x', x.toFixed(1)); t.setAttribute('y', y.toFixed(1));
  el.segLabels.appendChild(t); labelEls.push(t);
}
const cellEls = [];
for (let i = 0; i < CELLS; i++) { const c = document.createElement('div'); el.cells.appendChild(c); cellEls.push(c); }

// ---------- render ----------
let lastStatic = '';
function render(now) {
  const s = snapshot(now, cfg);
  const max = s.gaugeMax;
  const litCount = Math.round(SEGMENTS * Math.min(max, s.shownSaveRate) / max);
  const reqIdx = s.arrived || !isFinite(s.reqRate) ? -1 : Math.min(SEGMENTS - 1, Math.floor(SEGMENTS * Math.min(max, s.reqRate) / max));

  for (let i = 0; i < SEGMENTS; i++) onLines[i].style.display = i < litCount && i !== reqIdx ? '' : 'none';

  // things that change rarely: rebuild only when their key changes
  const staticKey = [max, reqIdx, s.onPace, s.arrived, s.arrivalMs === null, s.clockedIn, cfg.goalName, cfg.goalAmount, cfg.deadline, toYmd(now)].join('|');
  if (staticKey !== lastStatic) {
    lastStatic = staticKey;
    el.destLbl.textContent = `Dest · ${monthYear(s.deadlineMs)}`;
    el.dest.textContent = `${cfg.goalName.toUpperCase()} ¥${fmt0.format(cfg.goalAmount)}`;
    labelEls.forEach((t, i) => { t.textContent = String(Math.round(max * i / 3 / 100)); });
    if (reqIdx < 0) el.segReq.classList.add('hidden');
    else {
      el.segReq.classList.remove('hidden');
      const l = line(segAngle(reqIdx));
      el.reqLine.setAttribute('x1', l.getAttribute('x1')); el.reqLine.setAttribute('y1', l.getAttribute('y1'));
      el.reqLine.setAttribute('x2', l.getAttribute('x2')); el.reqLine.setAttribute('y2', l.getAttribute('y2'));
    }
    const earnA = -100 + 200 * Math.min(max, s.shownEarnRate) / max;
    const [ex, ey] = pt(R2 + 4, earnA);
    el.earnMark.setAttribute('transform', `translate(${ex.toFixed(1)} ${ey.toFixed(1)}) rotate(${earnA.toFixed(1)})`);

    el.pace.className = 'pace';
    if (s.arrived) el.pace.textContent = 'Arrived';
    else if (s.arrivalMs === null) { el.pace.textContent = 'Never'; el.pace.classList.add('never'); }
    else if (s.onPace) el.pace.textContent = 'On pace';
    else { el.pace.textContent = 'Too slow'; el.pace.classList.add('slow', 'blink'); }

    el.reqRate.textContent = s.arrived ? '0' : isFinite(s.reqRate) ? fmt0.format(s.reqRate) : '––––';
    el.earnRate.textContent = fmt0.format(s.shownEarnRate);
    el.clock.textContent = s.clockedIn ? `IN ${cfg.workStart}–${cfg.workEnd}` : 'OFF · 0 ¥/H';
    el.clock.classList.toggle('off', !s.clockedIn);

    // arrival timeline
    const end = Math.max(s.arrivalMs ?? s.deadlineMs, s.deadlineMs);
    const span = Math.max(1, end - s.startMs);
    const nowCell = Math.floor(CELLS * (now - s.startMs) / span);
    const dlCell = Math.min(CELLS - 1, Math.floor(CELLS * (s.deadlineMs - s.startMs) / span));
    cellEls.forEach((c, i) => { c.className = i === dlCell ? 'dl' : i <= nowCell ? 'on' : ''; });
    el.tlStart.textContent = monthYear(s.startMs);
    el.tlDeadline.textContent = `DEADLINE ${monthYear(s.deadlineMs)}`;
    el.tlEnd.textContent = s.arrivalMs === null ? '∞' : monthYear(end);
    el.eta.className = 'eta' + (s.onPace || s.arrived ? '' : ' slow');
    if (s.arrived) el.eta.textContent = 'GOAL REACHED';
    else if (s.arrivalMs === null) el.eta.textContent = 'NEVER · SAVING ≤ 0';
    else if (s.lateMonths === 0) el.eta.textContent = `${monthYear(s.arrivalMs)} · ON THE DEADLINE`;
    else if (s.onPace) el.eta.textContent = `${monthYear(s.arrivalMs)} · ${Math.abs(s.lateMonths)} MO EARLY`;
    else el.eta.textContent = `${monthYear(s.arrivalMs)} · ${s.lateMonths} MO LATE`;

    el.freedom.textContent = s.freedomHours.toFixed(1);
  }

  el.saveRate.textContent = fmt0.format(s.shownSaveRate);
  el.total.textContent = fmt2.format(s.saved);
  el.today.textContent = `${s.savedToday < 0 ? '−' : '+'}${fmt2.format(Math.abs(s.savedToday))}`;
  el.pct.textContent = `${(100 * s.progress).toFixed(1)}%`;
}

let timer = null;
function startLoop() { if (timer === null) { render(Date.now()); timer = setInterval(() => render(Date.now()), 100); } }
function stopLoop() { if (timer !== null) { clearInterval(timer); timer = null; } }
function applyConfig() { document.body.dataset.phosphor = cfg.phosphor; lastStatic = ''; render(Date.now()); requestWakeLock(); }

// ---------- wake lock ----------
let wakeLock = null;
async function requestWakeLock() {
  if (!cfg.keepAwake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { startLoop(); requestWakeLock(); }
  else stopLoop();
});

// ---------- boosts ----------
const boostDialog = $('boostDialog'), boostForm = $('boostForm'), boostList = $('boostList');
$('boostBtn').addEventListener('click', () => {
  boostForm.reset();
  boostForm.elements.date.value = toYmd(Date.now());
  renderBoostList();
  boostDialog.showModal();
});
boostForm.addEventListener('submit', (e) => {
  const amount = Number(boostForm.elements.amount.value);
  if (!isFinite(amount) || amount === 0) { e.preventDefault(); return; }
  cfg.boosts.push({ id: String(Date.now()), date: boostForm.elements.date.value, amount, note: boostForm.elements.note.value.trim() });
  cfg.boosts.sort((a, b) => a.date.localeCompare(b.date));
  saveConfig(cfg); applyConfig();
});
function renderBoostList() {
  boostList.replaceChildren(...[...cfg.boosts].reverse().map((b) => {
    const item = document.createElement('div'); item.className = 'item';
    const left = document.createElement('div');
    const amt = document.createElement('div'); amt.className = 'dot'; amt.textContent = `${b.amount < 0 ? '−' : '+'}${fmt0.format(Math.abs(b.amount))}`;
    const meta = document.createElement('div'); meta.className = 'note'; meta.textContent = b.note ? `${b.date} · ${b.note}` : b.date;
    left.append(amt, meta);
    const del = document.createElement('button'); del.type = 'button'; del.className = 'del'; del.textContent = '×'; del.setAttribute('aria-label', 'Delete boost');
    del.addEventListener('click', () => { cfg.boosts = cfg.boosts.filter((x) => x.id !== b.id); saveConfig(cfg); applyConfig(); renderBoostList(); });
    item.append(left, del);
    return item;
  }));
}

// ---------- settings ----------
const settingsDialog = $('settingsDialog'), settingsForm = $('settingsForm');
$('settingsBtn').addEventListener('click', () => {
  const f = settingsForm.elements;
  for (const k of ['goalName', 'goalAmount', 'deadline', 'startDate', 'startBalance', 'netMonthly', 'spendMonthly', 'workStart', 'workEnd', 'phosphor']) f[k].value = cfg[k];
  f.keepAwake.checked = !!cfg.keepAwake;
  for (const box of settingsForm.querySelectorAll('input[name="workDays"]')) box.checked = cfg.workDays.includes(Number(box.value));
  settingsDialog.showModal();
});
settingsForm.addEventListener('submit', (e) => {
  const f = settingsForm.elements;
  const days = [...settingsForm.querySelectorAll('input[name="workDays"]:checked')].map((b) => Number(b.value));
  if (days.length === 0 || f.workEnd.value <= f.workStart.value) { e.preventDefault(); alert('Pick at least one work day, and an end time after the start time.'); return; }
  cfg = sanitize({
    ...cfg,
    goalName: f.goalName.value.trim() || 'GOAL', goalAmount: Number(f.goalAmount.value), deadline: f.deadline.value,
    startDate: f.startDate.value, startBalance: Number(f.startBalance.value),
    netMonthly: Number(f.netMonthly.value), spendMonthly: Number(f.spendMonthly.value),
    workDays: days, workStart: f.workStart.value, workEnd: f.workEnd.value,
    phosphor: f.phosphor.value, keepAwake: f.keepAwake.checked,
  });
  saveConfig(cfg); applyConfig();
});
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => b.closest('dialog').close());

$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `income-speedometer-${toYmd(Date.now())}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try { cfg = sanitize(JSON.parse(await file.text())); saveConfig(cfg); applyConfig(); settingsDialog.close(); }
  catch { alert('That file is not a valid export.'); }
  e.target.value = '';
});

// ---------- boot ----------
applyConfig();
startLoop();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
