/**
 * Waste collection parsing.
 *
 * The Recycle! integration emits one all-day event per fraction, with the full
 * address repeated in every summary:
 *
 *   "12 Example Street, 1000 - Anytown Paper-cardboard"
 *
 * It also mixes languages — some fractions come through translated ("Paper-
 * cardboard"), others stay Dutch ("Huisvuil", "Gft"). Both forms are matched
 * here and normalised to the Dutch label that appears on the actual bag, with
 * the EcoWerf collection colour, so the banner matches what goes on the kerb.
 */

/** Ordered so the first match wins; longer/more specific patterns come first. */
const FRACTIONS = [
  {
    key: 'papier',
    label: 'Papier & karton',
    color: '#D8A22A',
    match: /paper|papier|karton|cardboard/i,
  },
  {
    key: 'pmd',
    label: 'PMD',
    color: '#1E68C4',
    match: /\bpmd\b|plastic.*metal|drankkarton/i,
  },
  {
    key: 'gft',
    label: 'GFT',
    color: '#2E7D32',
    match: /\bgft\b|groenafval|organic|tuinafval/i,
  },
  {
    key: 'huisvuil',
    label: 'Huisvuil',
    color: '#5A6472',
    match: /huisvuil|restafval|residual|household/i,
  },
  { key: 'glas', label: 'Glas', color: '#3E9C8F', match: /glas|glass/i },
  { key: 'textiel', label: 'Textiel', color: '#8E5AA8', match: /textiel|textile|kleding/i },
  { key: 'snoeihout', label: 'Snoeihout', color: '#6E8B3D', match: /snoeihout|groen.?hout|branches/i },
  { key: 'grofvuil', label: 'Grofvuil', color: '#9A5B3D', match: /grofvuil|bulky|grof huisvuil/i },
];

const FALLBACK = { key: 'other', label: 'Ophaling', color: '#6B7280' };

/**
 * Strip the address prefix an event summary carries and return the fraction.
 *
 * @param {string} summary Raw event summary from Home Assistant.
 * @param {string|null} prefix The calendar's address prefix, if known.
 * @returns {{key:string, label:string, color:string, raw:string}}
 */
export function parseFraction(summary, prefix) {
  let text = (summary || '').trim();

  if (prefix) {
    const normalised = prefix.trim();
    if (text.toLowerCase().startsWith(normalised.toLowerCase())) {
      text = text.slice(normalised.length).trim();
    }
  }

  // Some feeds separate the address with a dash or colon rather than repeating
  // it verbatim; drop anything before a trailing separator when what follows
  // still looks like a fraction name.
  const tail = text.split(/\s[-–:]\s/).pop().trim();
  if (tail && tail.length < text.length && FRACTIONS.some((f) => f.match.test(tail))) {
    text = tail;
  }

  const hit = FRACTIONS.find((f) => f.match.test(text));
  return hit
    ? { ...hit, raw: text }
    : { ...FALLBACK, label: text ? titleCase(text) : FALLBACK.label, raw: text };
}

/**
 * Group waste events into collection days.
 *
 * @param {Array} events Normalised events from a waste source.
 * @param {Record<string, object>} registry Source registry, for the address prefix.
 * @returns {Array<{dayKey:string, fractions:Array, sourceLabel:string}>} Ascending by day.
 */
export function groupCollections(events, registry) {
  const byDay = new Map();

  for (const ev of events) {
    const source = registry[ev.entityId];
    const fraction = parseFraction(ev.summary, source && source.stripPrefix);
    const day = ev.startKey;

    if (!byDay.has(day)) {
      byDay.set(day, {
        dayKey: day,
        fractions: [],
        sourceLabel: (source && source.label) || 'Waste',
      });
    }

    const entry = byDay.get(day);
    if (!entry.fractions.some((f) => f.key === fraction.key)) {
      entry.fractions.push(fraction);
    }
  }

  for (const entry of byDay.values()) {
    entry.fractions.sort((a, b) => a.label.localeCompare(b.label));
  }

  return [...byDay.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}

/**
 * The next two collection days from today onward.
 * @returns {{today:object|null, next:object|null}}
 */
export function upcomingCollections(collections, todayKey) {
  const future = collections.filter((c) => c.dayKey >= todayKey);
  const today = future.find((c) => c.dayKey === todayKey) || null;
  const next = future.find((c) => c.dayKey > todayKey) || null;
  return { today, next };
}

/**
 * Work out what the household actually has to *do* today.
 *
 * The calendar records when the truck arrives, which is early morning — by then
 * it is too late to act. `remindDaysBefore` shifts the call to action back to
 * the evening the bins must go out, while every date shown stays the real
 * collection date.
 *
 * @param {Array} collections From `groupCollections`, ascending by day.
 * @param {string} todayKey
 * @param {number} [remindDaysBefore] 1 = put out the evening before.
 * @returns {{
 *   act: object|null,        Collection whose put-out day is today.
 *   collectedToday: object|null,
 *   next: object|null,       Next collection strictly after today.
 *   remindDaysBefore: number
 * }}
 */
export function wasteSchedule(collections, todayKey, remindDaysBefore = 1) {
  const offset = Number.isFinite(remindDaysBefore) ? Math.max(0, remindDaysBefore) : 1;

  const collectedToday = collections.find((c) => c.dayKey === todayKey) || null;
  const next = collections.find((c) => c.dayKey > todayKey) || null;

  // The collection to act on is the one whose put-out day lands on today.
  const act =
    collections.find((c) => c.dayKey >= todayKey && shiftKey(c.dayKey, -offset) === todayKey) || null;

  return { act, collectedToday, next, remindDaysBefore: offset };
}

/** The day the bins have to go out for a given collection. */
export function putOutDay(collectionDayKey, remindDaysBefore = 1) {
  return shiftKey(collectionDayKey, -Math.max(0, remindDaysBefore));
}

/** Local day arithmetic on `YYYY-MM-DD`, independent of timezone. */
function shiftKey(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function titleCase(text) {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}
