/**
 * Calendar reading and writing.
 *
 * Reads go over REST (`/api/calendars/...`), which is the only way to list
 * events. Creating goes through the `calendar.create_event` service, but
 * editing and deleting exist *only* as WebSocket commands — there are no
 * `calendar.update_event` / `calendar.delete_event` services — so those are
 * sent as raw frames.
 */

import { dayKey, startOfDay, addDays, haLocalDateTime, daysBetween } from '../util/dates.js';

/**
 * @typedef {object} CalEvent
 * @property {string} entityId
 * @property {string} uid
 * @property {string|null} recurrenceId
 * @property {string|null} rrule
 * @property {string} summary
 * @property {string} description
 * @property {string} location
 * @property {boolean} allDay
 * @property {Date} start
 * @property {Date} end
 * @property {string} startKey  First day the event occupies, `YYYY-MM-DD`.
 * @property {string} endKey    Last day the event occupies (inclusive).
 * @property {boolean} multiDay
 */

/** List every calendar entity Home Assistant exposes. */
export async function listCalendars(conn) {
  const [calendars, states] = await Promise.all([
    conn.rest('/api/calendars'),
    conn.getStates(),
  ]);

  const featuresById = new Map(
    states
      .filter((s) => s.entity_id.startsWith('calendar.'))
      .map((s) => [s.entity_id, (s.attributes && s.attributes.supported_features) || 0])
  );

  return calendars.map((c) => ({
    entity_id: c.entity_id,
    name: c.name || c.entity_id,
    supportedFeatures: featuresById.get(c.entity_id) || 0,
  }));
}

/**
 * Fetch events for a set of calendars over a day range.
 *
 * @param {import('../ha/bridge.js').HassBridge} conn
 * @param {string[]} entityIds
 * @param {string} fromKey Inclusive `YYYY-MM-DD`.
 * @param {string} toKey Exclusive `YYYY-MM-DD`.
 * @returns {Promise<CalEvent[]>} Sorted by start.
 */
export async function fetchEvents(conn, entityIds, fromKey, toKey) {
  if (!entityIds.length) return [];

  const start = startOfDay(fromKey).toISOString();
  const end = startOfDay(toKey).toISOString();

  const results = await Promise.allSettled(
    entityIds.map(async (id) => {
      const raw = await conn.rest(
        `/api/calendars/${encodeURIComponent(id)}?start=${encodeURIComponent(
          start
        )}&end=${encodeURIComponent(end)}`
      );
      return raw.map((ev) => normaliseEvent(ev, id));
    })
  );

  const events = [];
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      events.push(...result.value);
    } else {
      console.error(`Could not load events for ${entityIds[index]}`, result.reason);
    }
  }

  return events.sort(compareEvents);
}

/** Convert a Home Assistant calendar event into the app's shape. */
export function normaliseEvent(raw, entityId) {
  const allDay = Boolean(raw.start && raw.start.date);

  let start;
  let end;
  let startKey;
  let endKey;

  if (allDay) {
    startKey = raw.start.date;
    // All-day ends are exclusive in Home Assistant; step back to the last day
    // the event actually occupies so a one-day event doesn't span two.
    endKey = addDays(raw.end.date, -1);
    if (endKey < startKey) endKey = startKey;
    start = startOfDay(startKey);
    end = startOfDay(addDays(endKey, 1));
  } else {
    start = new Date(raw.start.dateTime);
    end = new Date(raw.end.dateTime);
    startKey = dayKey(start);
    endKey = dayKey(new Date(end.getTime() - 1)); // an event ending at midnight belongs to the day before
    if (endKey < startKey) endKey = startKey;
  }

  return {
    entityId,
    uid: raw.uid || null,
    recurrenceId: raw.recurrence_id || null,
    rrule: raw.rrule || null,
    summary: raw.summary || '(no title)',
    description: raw.description || '',
    location: raw.location || '',
    allDay,
    start,
    end,
    startKey,
    endKey,
    multiDay: endKey !== startKey,
    editable: Boolean(raw.uid),
  };
}

function compareEvents(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return a.start - b.start || a.summary.localeCompare(b.summary);
}

/**
 * Group events into day buckets, repeating multi-day events on each day they
 * cover so a week-long holiday shows up every day rather than only on its first.
 *
 * @param {CalEvent[]} events
 * @param {string} fromKey
 * @param {string} toKey Exclusive.
 * @returns {Map<string, CalEvent[]>}
 */
export function groupByDay(events, fromKey, toKey) {
  const days = new Map();
  const span = daysBetween(fromKey, toKey);

  for (let i = 0; i < span; i++) {
    days.set(addDays(fromKey, i), []);
  }

  for (const ev of events) {
    let key = ev.startKey < fromKey ? fromKey : ev.startKey;
    while (key <= ev.endKey && days.has(key)) {
      days.get(key).push({ ...ev, occursOn: key, continuation: key !== ev.startKey });
      key = addDays(key, 1);
    }
  }

  for (const list of days.values()) list.sort(compareEvents);
  return days;
}

/** Which calendars have something on each day — for the month grid dots. */
export function dayColorIndex(events, registry) {
  const index = new Map();

  for (const ev of events) {
    let key = ev.startKey;
    while (key <= ev.endKey) {
      if (!index.has(key)) index.set(key, new Set());
      index.get(key).add(ev.entityId);
      key = addDays(key, 1);
    }
  }

  const out = new Map();
  for (const [key, ids] of index) {
    out.set(
      key,
      [...ids]
        .map((id) => registry[id])
        .filter(Boolean)
        .map((s) => ({ color: s.color, kind: s.kind, label: s.label }))
    );
  }
  return out;
}

/* ── Writes ─────────────────────────────────────────────────────────────── */

/**
 * Create an event.
 * @param {object} form { entityId, summary, description, location, allDay, start: Date, end: Date }
 */
export function createEvent(conn, form) {
  const data = {
    summary: form.summary,
    ...(form.description ? { description: form.description } : {}),
    ...(form.location ? { location: form.location } : {}),
  };

  if (form.allDay) {
    data.start_date = dayKey(form.start);
    // Home Assistant expects an exclusive end date.
    data.end_date = addDays(dayKey(form.end), 1);
  } else {
    data.start_date_time = haLocalDateTime(form.start);
    data.end_date_time = haLocalDateTime(form.end);
  }

  return conn.callService('calendar', 'create_event', data, { entity_id: form.entityId });
}

/**
 * Update an event. WebSocket only — no service exists for this.
 * @param {"" | "thisandfuture"} recurrenceRange Empty string edits just this instance.
 */
export function updateEvent(conn, event, form, recurrenceRange = '') {
  return conn.sendMessage({
    type: 'calendar/event/update',
    entity_id: event.entityId,
    uid: event.uid,
    recurrence_id: event.recurrenceId || undefined,
    recurrence_range: recurrenceRange || undefined,
    event: buildEventBody(form),
  });
}

/** Delete an event. WebSocket only. */
export function deleteEvent(conn, event, recurrenceRange = '') {
  return conn.sendMessage({
    type: 'calendar/event/delete',
    entity_id: event.entityId,
    uid: event.uid,
    recurrence_id: event.recurrenceId || undefined,
    recurrence_range: recurrenceRange || undefined,
  });
}

function buildEventBody(form) {
  const body = {
    summary: form.summary,
    description: form.description || '',
    location: form.location || '',
  };

  if (form.allDay) {
    body.dtstart = dayKey(form.start);
    body.dtend = addDays(dayKey(form.end), 1);
  } else {
    body.dtstart = haLocalDateTime(form.start);
    body.dtend = haLocalDateTime(form.end);
  }
  return body;
}
