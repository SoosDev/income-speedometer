import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, windowHours, monthlyWorkHours, earnRate, saveRate, workedHours,
  isClockedIn, projectArrival, snapshot, gaugeMax, parseLocalDate, freedomHoursPerWorkHour,
} from '../app/calc.js';

const cfg = { ...DEFAULTS, boosts: [] };
const at = (ymd, hhmm = '00:00') => {
  const [h, m] = hhmm.split(':').map(Number);
  return parseLocalDate(ymd) + (h * 60 + m) * 60000;
};

test('window and monthly hours', () => {
  assert.equal(windowHours(cfg), 9);
  assert.ok(Math.abs(monthlyWorkHours(cfg) - 9 * 5 * (52.1775 / 12)) < 1e-9);
});

test('rates', () => {
  const h = monthlyWorkHours(cfg);
  assert.ok(Math.abs(earnRate(cfg) - 350000 / h) < 1e-9);
  assert.ok(Math.abs(saveRate(cfg) - 150000 / h) < 1e-9);
  assert.equal(saveRate({ ...cfg, workDays: [] }), 0);
  assert.ok(freedomHoursPerWorkHour(cfg) > 1);
});

test('workedHours counts only the window on work days', () => {
  // Wed 2026-09-09 full day inside the window
  assert.equal(workedHours(at('2026-09-09'), at('2026-09-10'), cfg), 9);
  // partial: 10:30 to 12:00
  assert.equal(workedHours(at('2026-09-09', '10:30'), at('2026-09-09', '12:00'), cfg), 1.5);
  // weekend: Sat 12 + Sun 13 = 0
  assert.equal(workedHours(at('2026-09-12'), at('2026-09-14'), cfg), 0);
  // Mon 14 through Fri 18 = 45
  assert.equal(workedHours(at('2026-09-14'), at('2026-09-19'), cfg), 45);
  // before the window on a work day
  assert.equal(workedHours(at('2026-09-09', '06:00'), at('2026-09-09', '08:59'), cfg), 0);
  // reversed range
  assert.equal(workedHours(at('2026-09-10'), at('2026-09-09'), cfg), 0);
});

test('isClockedIn', () => {
  assert.equal(isClockedIn(at('2026-09-09', '09:00'), cfg), false); // exactly at start: zero-length overlap before
  assert.equal(isClockedIn(at('2026-09-09', '09:01'), cfg), true);
  assert.equal(isClockedIn(at('2026-09-09', '17:59'), cfg), true);
  assert.equal(isClockedIn(at('2026-09-09', '18:01'), cfg), false);
  assert.equal(isClockedIn(at('2026-09-12', '12:00'), cfg), false); // Saturday
});

test('projectArrival walks the calendar', () => {
  // Wed 09:00, need 9h -> Wed 18:00
  assert.equal(projectArrival(at('2026-09-09', '09:00'), 9, cfg), at('2026-09-09', '18:00'));
  // Wed 12:00, need 10h -> 6h Wed + 4h Thu -> Thu 13:00
  assert.equal(projectArrival(at('2026-09-09', '12:00'), 10, cfg), at('2026-09-10', '13:00'));
  // Fri 17:00, need 2h -> 1h Fri + skip weekend + 1h Mon -> Mon 10:00
  assert.equal(projectArrival(at('2026-09-11', '17:00'), 2, cfg), at('2026-09-14', '10:00'));
  // Sunday, need 1h -> Mon 10:00
  assert.equal(projectArrival(at('2026-09-13', '12:00'), 1, cfg), at('2026-09-14', '10:00'));
  assert.equal(projectArrival(at('2026-09-13'), 0, cfg), at('2026-09-13'));
  assert.equal(projectArrival(at('2026-09-13'), 5, { ...cfg, workDays: [] }), null);
  assert.equal(projectArrival(at('2026-09-13'), 1e9, cfg), null);
});

test('snapshot: sample numbers land 1 to 2 years late', () => {
  const s = snapshot(at('2026-09-10', '12:00'), cfg);
  assert.equal(s.clockedIn, true);
  assert.ok(s.saved > 4200000);
  assert.ok(s.reqRate > s.saveRate, 'required rate exceeds saving rate');
  assert.equal(s.onPace, false);
  assert.ok(s.lateMonths > 6 && s.lateMonths < 36, `late by ${s.lateMonths} months`);
  assert.ok(s.arrivalMs > s.deadlineMs);
  assert.equal(s.shownSaveRate, s.saveRate);
});

test('snapshot: off the clock shows zero needle but keeps totals', () => {
  const s = snapshot(at('2026-09-12', '12:00'), cfg);
  assert.equal(s.clockedIn, false);
  assert.equal(s.shownSaveRate, 0);
  assert.equal(s.shownEarnRate, 0);
  assert.ok(s.saved > 4200000);
  assert.equal(s.savedToday, 0);
});

test('snapshot: boosts count from their date, and in today trip', () => {
  const withBoost = { ...cfg, boosts: [{ id: '1', date: '2026-09-10', amount: 50000, note: '' }] };
  const before = snapshot(at('2026-09-09', '12:00'), withBoost);
  const after = snapshot(at('2026-09-10', '12:00'), withBoost);
  const plain = snapshot(at('2026-09-10', '12:00'), cfg);
  assert.ok(Math.abs(after.saved - plain.saved - 50000) < 1e-6);
  assert.ok(Math.abs(after.savedToday - plain.savedToday - 50000) < 1e-6);
  assert.ok(before.saved < plain.saved + 1); // not yet counted
});

test('snapshot: goal reached', () => {
  const rich = { ...cfg, startBalance: 40000000 };
  const s = snapshot(at('2026-09-10', '12:00'), rich);
  assert.equal(s.arrived, true);
  assert.equal(s.gap, 0);
  assert.equal(s.progress, 1);
  assert.equal(s.onPace, true);
});

test('snapshot: negative saving never arrives, deadline passed gives infinite requirement', () => {
  const broke = { ...cfg, spendMonthly: 400000 };
  const s = snapshot(at('2026-09-10', '12:00'), broke);
  assert.equal(s.arrivalMs, null);
  assert.equal(s.onPace, false);
  assert.equal(s.shownSaveRate, 0);
  const past = { ...cfg, deadline: '2020-01-01' };
  const p = snapshot(at('2026-09-10', '12:00'), past);
  assert.equal(p.reqRate, Infinity);
});

test('gaugeMax is a multiple of 300 above earn and required', () => {
  const m = gaugeMax(cfg, 1000);
  assert.equal(m % 300, 0);
  assert.ok(m > earnRate(cfg));
  assert.equal(gaugeMax({ ...cfg, netMonthly: 0 }, 0), 300);
});
