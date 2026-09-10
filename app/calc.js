// Pure calculations for the income speedometer. No DOM, no storage.
// All times are local-time epoch milliseconds unless named otherwise.

export const DEFAULTS = Object.freeze({
  goalName: 'FIRE',
  goalAmount: 30000000,
  deadline: '2040-01-01',
  startDate: '2026-04-01',
  startBalance: 4200000,
  netMonthly: 350000,
  spendMonthly: 200000,
  workDays: [1, 2, 3, 4, 5], // 0 = Sunday
  workStart: '09:00',
  workEnd: '18:00',
  phosphor: 'cyan',
  keepAwake: true,
  boosts: [], // { id, date: 'YYYY-MM-DD', amount, note }
});

export const WEEKS_PER_MONTH = 52.1775 / 12;
export const MONTH_MS = 30.4375 * 24 * 3600000;
export const HOUR_MS = 3600000;

export function parseLocalDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function toYmd(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function startOfDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function minutesOf(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Hours in one work window (end - start). */
export function windowHours(cfg) {
  return Math.max(0, (minutesOf(cfg.workEnd) - minutesOf(cfg.workStart)) / 60);
}

/** Average paid hours per month. */
export function monthlyWorkHours(cfg) {
  return windowHours(cfg) * cfg.workDays.length * WEEKS_PER_MONTH;
}

/** Yen earned (手取り) per work hour. */
export function earnRate(cfg) {
  const h = monthlyWorkHours(cfg);
  return h > 0 ? cfg.netMonthly / h : 0;
}

/** Yen saved per work hour. Can be negative if spending exceeds income. */
export function saveRate(cfg) {
  const h = monthlyWorkHours(cfg);
  return h > 0 ? (cfg.netMonthly - cfg.spendMonthly) / h : 0;
}

/** Cost of living per hour of life (all 24h, every day). */
export function lifeCostPerHour(cfg) {
  return cfg.spendMonthly / (MONTH_MS / HOUR_MS);
}

/** Hours of life off the clock bought by one hour of work. */
export function freedomHoursPerWorkHour(cfg) {
  const life = lifeCostPerHour(cfg);
  return life > 0 ? saveRate(cfg) / life : 0;
}

function isWorkDay(dayStartMs, cfg) {
  return cfg.workDays.includes(new Date(dayStartMs).getDay());
}

/** Work-window overlap (hours) between [fromMs, toMs] on a single calendar day. */
function overlapHoursOnDay(dayStartMs, fromMs, toMs, cfg) {
  if (!isWorkDay(dayStartMs, cfg)) return 0;
  const wStart = dayStartMs + minutesOf(cfg.workStart) * 60000;
  const wEnd = dayStartMs + minutesOf(cfg.workEnd) * 60000;
  const a = Math.max(wStart, fromMs);
  const b = Math.min(wEnd, toMs);
  return b > a ? (b - a) / HOUR_MS : 0;
}

/** Total work hours between two instants, honouring work days and the daily window. */
export function workedHours(fromMs, toMs, cfg) {
  if (toMs <= fromMs) return 0;
  let total = 0;
  let day = startOfDay(fromMs);
  const lastDay = startOfDay(toMs);
  while (day <= lastDay) {
    total += overlapHoursOnDay(day, fromMs, toMs, cfg);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    day = next.getTime();
  }
  return total;
}

/** Are we inside the work window right now? */
export function isClockedIn(nowMs, cfg) {
  return overlapHoursOnDay(startOfDay(nowMs), nowMs - 1, nowMs, cfg) > 0;
}

/**
 * Walk forward from nowMs until `hours` of work have been accumulated.
 * Returns the epoch ms of that instant, or null if it takes more than maxYears.
 */
export function projectArrival(nowMs, hours, cfg, maxYears = 100) {
  if (hours <= 0) return nowMs;
  if (windowHours(cfg) <= 0 || cfg.workDays.length === 0) return null;
  let remaining = hours;
  let day = startOfDay(nowMs);
  const limit = day + maxYears * 365.25 * 24 * HOUR_MS;
  let from = nowMs;
  while (day < limit) {
    const dayEnd = day + 24 * HOUR_MS;
    const avail = overlapHoursOnDay(day, from, dayEnd, cfg);
    if (avail >= remaining) {
      const wStart = day + minutesOf(cfg.workStart) * 60000;
      const begin = Math.max(wStart, from);
      return begin + remaining * HOUR_MS;
    }
    remaining -= avail;
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    day = next.getTime();
    from = day;
  }
  return null;
}

export function boostsTotal(cfg, uptoMs = Infinity) {
  return cfg.boosts.reduce((sum, b) => (parseLocalDate(b.date) <= uptoMs ? sum + Number(b.amount || 0) : sum), 0);
}

/** A "nice" gauge ceiling whose thirds are round hundreds. */
export function gaugeMax(cfg, reqRate) {
  const top = Math.max(earnRate(cfg), isFinite(reqRate) ? reqRate : 0, 100) * 1.15;
  return Math.max(300, Math.ceil(top / 300) * 300);
}

/** Everything the dashboard needs, for one instant. */
export function snapshot(nowMs, cfg) {
  const earn = earnRate(cfg);
  const save = saveRate(cfg);
  const clockedIn = isClockedIn(nowMs, cfg);
  const startMs = parseLocalDate(cfg.startDate);
  const deadlineMs = parseLocalDate(cfg.deadline);
  const todayStart = startOfDay(nowMs);

  const hoursSinceStart = workedHours(startMs, nowMs, cfg);
  const hoursToday = workedHours(Math.max(startMs, todayStart), nowMs, cfg);
  const saved = cfg.startBalance + boostsTotal(cfg, nowMs) + save * hoursSinceStart;
  const boostsToday = cfg.boosts.reduce((s, b) => (b.date === toYmd(nowMs) ? s + Number(b.amount || 0) : s), 0);
  const savedToday = save * hoursToday + boostsToday;

  const gap = Math.max(0, cfg.goalAmount - saved);
  const arrived = gap <= 0;
  const hoursToDeadline = workedHours(nowMs, deadlineMs, cfg);
  const reqRate = arrived ? 0 : hoursToDeadline > 0 ? gap / hoursToDeadline : Infinity;

  let arrivalMs = null;
  if (arrived) arrivalMs = nowMs;
  else if (save > 0) arrivalMs = projectArrival(nowMs, gap / save, cfg);
  const lateMonths = arrivalMs === null ? null : Math.round((arrivalMs - deadlineMs) / MONTH_MS);
  const onPace = arrivalMs !== null && lateMonths <= 0;

  return {
    earnRate: earn,
    saveRate: save,
    shownSaveRate: clockedIn ? Math.max(0, save) : 0,
    shownEarnRate: clockedIn ? earn : 0,
    clockedIn,
    saved,
    savedToday,
    gap,
    arrived,
    progress: cfg.goalAmount > 0 ? Math.min(1, saved / cfg.goalAmount) : 0,
    reqRate,
    arrivalMs,
    lateMonths,
    onPace,
    startMs,
    deadlineMs,
    freedomHours: freedomHoursPerWorkHour(cfg),
    gaugeMax: gaugeMax(cfg, reqRate),
  };
}
