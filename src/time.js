import { TIMEZONE } from './config.js';

export function parseDuration(input) {
  const text = String(input).trim();
  const invalid = () => new Error(`Invalid duration "${input}". Use e.g. 90, 90s, 45m, 2h, 1:30, 1:23:40`);

  const unit = /^(\d+(?:\.\d+)?)([smh]?)$/.exec(text);
  if (unit) return Number(unit[1]) * { '': 1, s: 1, m: 60, h: 3600 }[unit[2]];

  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(text);
  if (!clock) throw invalid();
  const [, hours, minutes, seconds] = clock;
  if (Number(seconds) >= 60 || (hours !== undefined && Number(minutes) >= 60)) throw invalid();
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export function formatDuration(totalSec) {
  const t = Math.round(totalSec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Milliseconds to add to a UTC instant to get wall-clock time in timeZone.
function tzOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wallAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function localToUtcIso(input, timeZone = TIMEZONE) {
  const invalid = () => new Error(`Invalid schedule "${input}". Use YYYY-MM-DDTHH:MM in Florida local time`);
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(input).trim());
  if (!m) throw invalid();
  const [y, mo, d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0));
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) {
    throw invalid();
  }
  // Guess using the offset at the wall time, then correct with the offset at the guess (handles DST edges).
  let utc = wall - tzOffsetMs(new Date(wall), timeZone);
  utc = wall - tzOffsetMs(new Date(utc), timeZone);
  return new Date(utc).toISOString();
}

const displayFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export const toLocalDisplay = (iso) => displayFormat.format(new Date(iso));
