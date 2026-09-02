/**
 * Timezone-aware date helpers.
 *
 * Everything is resolved against an explicit IANA zone (Europe/Brussels by
 * default) rather than the browser's local time. A wall tablet is exactly the
 * kind of device that ends up on the wrong timezone after a factory reset, and
 * a calendar that silently shifts every event by an hour is worse than one that
 * fails loudly.
 */

let zone = 'Europe/Brussels';

/** Set the zone every calculation resolves against. */
export function setTimeZone(tz) {
  if (tz) zone = tz;
}

export function getTimeZone() {
  return zone;
}

const partsCache = new Map();

function formatter(options) {
  const key = JSON.stringify(options) + zone;
  let fmt = partsCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', { timeZone: zone, ...options });
    partsCache.set(key, fmt);
  }
  return fmt;
}

/** Break a Date into calendar parts as seen in the active zone. */
export function zonedParts(date) {
  const parts = formatter({
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const out = {};
  for (const p of parts) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** Offset of the active zone from UTC, in ms, at a given instant. */
function zoneOffset(date) {
  const p = zonedParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Build a Date from wall-clock values interpreted in the active zone.
 * Two passes settle DST boundaries, where the first guess can land on the
 * wrong side of a transition.
 */
export function zonedDate(year, month, day, hour = 0, minute = 0, second = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let result = guess - zoneOffset(new Date(guess));
  result = guess - zoneOffset(new Date(result));
  return new Date(result);
}

/** `YYYY-MM-DD` for a Date, as seen in the active zone. */
export function dayKey(date) {
  const p = zonedParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Midnight at the start of a `YYYY-MM-DD` key, in the active zone. */
export function startOfDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return zonedDate(y, m, d, 0, 0, 0);
}

/** Midnight ending a `YYYY-MM-DD` key (i.e. the next day's start). */
export function endOfDay(key) {
  return startOfDay(addDays(key, 1));
}

/** Today's key in the active zone. */
export function todayKey() {
  return dayKey(new Date());
}

/** Shift a `YYYY-MM-DD` key by whole days. */
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + n));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Whole days between two keys (b - a). */
export function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** `19:00` */
export function fmtTime(date) {
  return formatter({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

/** `14:32` for the header clock, always the active zone. */
export function fmtClock(date = new Date()) {
  return fmtTime(date);
}

/** `Wednesday` */
export function fmtWeekday(date) {
  return formatter({ weekday: 'long' }).format(date);
}

/** `2 September 2026` */
export function fmtLongDate(date) {
  return formatter({ day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

/** `Wed 2 Sep` */
export function fmtShortDate(date) {
  return formatter({ weekday: 'short', day: 'numeric', month: 'short' }).format(date);
}

/** `September 2026` */
export function fmtMonthYear(date) {
  return formatter({ month: 'long', year: 'numeric' }).format(date);
}

/**
 * Human day heading: `Today`, `Tomorrow`, `Yesterday`, else `Wed 2 Sep`.
 * @param {string} key
 */
export function fmtDayHeading(key) {
  const diff = daysBetween(todayKey(), key);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return fmtShortDate(startOfDay(key));
}

/** Relative due label for tasks: `Today`, `3d late`, `Fri`, `12 Oct`. */
export function fmtDue(key) {
  const diff = daysBetween(todayKey(), key);
  if (diff === 0) return { text: 'Today', tone: 'due' };
  if (diff === 1) return { text: 'Tomorrow', tone: 'due' };
  if (diff < 0) return { text: `${Math.abs(diff)}d late`, tone: 'overdue' };
  if (diff <= 6) return { text: formatter({ weekday: 'short' }).format(startOfDay(key)), tone: 'soon' };
  return { text: formatter({ day: 'numeric', month: 'short' }).format(startOfDay(key)), tone: 'later' };
}

/**
 * `YYYY-MM-DD HH:MM:SS` in the active zone — the naive local format Home
 * Assistant's calendar and to-do services expect.
 */
export function haLocalDateTime(date) {
  const p = zonedParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** ISO instant, for REST query parameters. */
export function isoInstant(date) {
  return date.toISOString();
}

/**
 * Day keys filling a Monday-first month grid, padded to whole weeks.
 * @param {number} year
 * @param {number} month 1-12
 * @returns {{key:string, inMonth:boolean}[]}
 */
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // getUTCDay: 0=Sun. Shift so Monday is 0.
  const lead = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;

  const cells = [];
  for (let i = 0; i < total; i++) {
    const offset = i - lead;
    const d = new Date(Date.UTC(year, month - 1, 1 + offset));
    cells.push({
      key: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
      inMonth: offset >= 0 && offset < daysInMonth,
    });
  }
  return cells;
}

/** Monday-first weekday initials for the month grid header. */
export const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function pad(n) {
  return String(n).padStart(2, '0');
}
