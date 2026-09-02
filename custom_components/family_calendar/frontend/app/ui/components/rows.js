/**
 * The repeating list elements: event rows, to-do rows, the waste banner, day
 * headings and empty states. Kept together so the rows that sit next to each
 * other in a scroll stay consistent in height, padding and colour handling.
 */

import { h, tappable, onLongPress } from '../../util/dom.js';
import { fmtTime, fmtDayHeading, fmtDue, todayKey } from '../../util/dates.js';
import { putOutDay } from '../../data/waste.js';

/**
 * One calendar event.
 *
 * @param {object} event Normalised event.
 * @param {object} source Its entry in the source registry.
 * @param {object} [options]
 * @param {boolean} [options.showTag] Show the calendar name as a tag.
 * @param {(event:object) => void} [options.onOpen] Tap handler.
 * @param {(event:object) => void} [options.onEdit] Long-press handler.
 */
export function eventRow(event, source, options = {}) {
  const { showTag = false, onOpen, onEdit } = options;
  const color = (source && source.color) || 'var(--ink-3)';

  // A continuation says so rather than repeating a start time from a day that
  // has already gone by.
  const time = event.continuation
    ? 'Continues'
    : event.allDay
      ? 'All day'
      : `${fmtTime(event.start)} – ${fmtTime(event.end)}`;

  const row = tappable(
    'div.event',
    {
      style: { '--event-color': color },
      class: event.continuation ? 'is-continuation' : null,
      onTap: onOpen ? () => onOpen(event) : undefined,
      'aria-label': `${event.summary}, ${time}`,
    },
    h('span.event-bar'),
    h(
      'span.event-main',
      null,
      h('span.event-time', null, time),
      h('span.event-summary', null, event.summary),
      event.location ? h('span.event-meta', null, event.location) : null
    ),
    showTag && source ? h('span.event-tag', null, source.label) : null
  );

  // A tap opens the detail sheet, never a form. Long press and right-click are
  // shortcuts straight to the editor for anyone who knows what they want --
  // right-click because long press has no mouse equivalent.
  if (onEdit && event.editable && source && source.canUpdate) {
    onLongPress(row, () => onEdit(event));
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      onEdit(event);
    });
  }

  return row;
}

/**
 * The waste collection banner.
 *
 * @param {{today:object|null, next:object|null}} collections
 */
export function wasteBanner(schedule) {
  const { act, collectedToday, next, remindDaysBefore } = schedule;

  // Lead with whatever needs doing. `act` is the collection whose bins go out
  // today; only when there is nothing to do does the banner fall back to
  // reporting what already happened or what is coming.
  const showing = act || collectedToday || next;
  if (!showing) return null;

  let heading;
  let followUp = null;
  let done = false;

  if (act) {
    heading = remindDaysBefore > 0 ? 'Put out tonight' : 'Out this morning';
    followUp = `Collected ${lowerDay(fmtDayHeading(act.dayKey))}`;
  } else if (collectedToday) {
    heading = 'Collected this morning';
    done = true;
    followUp = next ? nextLine(next, remindDaysBefore) : null;
  } else {
    heading = `Next collection · ${fmtDayHeading(next.dayKey)}`;
    followUp = putOutLine(next, remindDaysBefore);
  }

  return h(
    'div.waste',
    { class: done ? 'is-done' : null },
    h('span.waste-icon', { 'aria-hidden': 'true' }, '♻'),
    h(
      'span.waste-main',
      null,
      h('span.waste-label', null, heading),
      h(
        'span.waste-fractions',
        null,
        ...showing.fractions.map((f) =>
          h(
            'span.fraction',
            { style: { '--fraction-color': f.color } },
            h('span.fraction-swatch'),
            f.label
          )
        )
      ),
      followUp ? h('span.waste-next', null, followUp) : null
    )
  );
}

function nextLine(collection, remindDaysBefore) {
  const fractions = collection.fractions.map((f) => f.label).join(' · ');
  return `Next: ${fractions} on ${fmtDayHeading(collection.dayKey)}. ${putOutLine(
    collection,
    remindDaysBefore
  )}`;
}

/** "Put them out tomorrow evening" — the day that actually needs acting on. */
function putOutLine(collection, remindDaysBefore) {
  if (!remindDaysBefore) return 'Out first thing that morning.';

  const when = fmtDayHeading(putOutDay(collection.dayKey, remindDaysBefore));
  if (when === 'Today') return 'Put them out tonight.';
  if (when === 'Tomorrow') return 'Put them out tomorrow evening.';
  return `Put them out ${when} evening.`;
}

function lowerDay(label) {
  return label === 'Today' || label === 'Tomorrow' ? label.toLowerCase() : label;
}

/**
 * One to-do item.
 *
 * @param {object} item
 * @param {object} list The list it belongs to, for capability checks.
 * @param {object} options
 * @param {(item:object, done:boolean) => void} options.onToggle
 * @param {(item:object) => void} [options.onEdit]
 * @param {boolean} [options.showList] Show which list it came from.
 */
export function todoRow(item, list, options = {}) {
  const { onToggle, onEdit, onOpen, showList = false } = options;

  const check = tappable('span.todo-check', {
    role: 'checkbox',
    'aria-checked': String(item.done),
    'aria-label': item.done ? `Mark "${item.summary}" not done` : `Mark "${item.summary}" done`,
    onTap: (ev) => {
      ev.stopPropagation();
      onToggle(item, !item.done);
    },
  }, '✓');

  // Pressing the checkbox is not pressing the row. Stopping the pointerdown as
  // well as the pointerup keeps the row from starting a press it will never see
  // the end of, which would otherwise leave a half-open gesture behind.
  check.addEventListener('pointerdown', (ev) => ev.stopPropagation());

  const note = showList
    ? list.label
    : item.description
      ? item.description.split('\n')[0]
      : null;

  const due = item.dueKey ? fmtDue(item.dueKey) : null;

  // Same contract as an event row: tap opens the detail sheet, the checkbox
  // stays a direct one-tap toggle, and editing sits behind an explicit action.
  const row = tappable(
    'div.todo',
    {
      class: item.done ? 'is-done' : null,
      onTap: onOpen ? () => onOpen(item) : undefined,
      'aria-label': item.summary,
    },
    check,
    h(
      'span.todo-main',
      null,
      h('span.todo-summary', null, item.summary),
      note ? h('span.todo-note', null, note) : null
    ),
    due && !item.done ? h('span.todo-due', { dataset: { tone: due.tone } }, due.text) : null
  );

  if (onEdit && list.canUpdate) {
    onLongPress(row, () => onEdit(item));
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      onEdit(item);
    });
  }

  return row;
}

/** A day separator in the agenda. */
export function dayHeading(key) {
  const isToday = key === todayKey();
  return h(
    'div.day-heading',
    { class: isToday ? 'is-today' : null },
    isToday ? 'Today' : fmtDayHeading(key)
  );
}

/** A labelled section heading inside a screen. */
export function sectionHeading(text) {
  return h('div.day-heading', null, text);
}

/**
 * An empty state that says what would appear here, not just "nothing".
 */
export function emptyState(glyph, title, detail) {
  return h(
    'div.empty',
    null,
    h('span.empty-glyph', { 'aria-hidden': 'true' }, glyph),
    h('b', null, title),
    detail ? h('span', null, detail) : null
  );
}

/** Placeholder rows shown while the first fetch is in flight. */
export function skeletonRows(count = 3) {
  return Array.from({ length: count }, () => h('div.skeleton'));
}

/**
 * Shown when a screen looks empty only because calendars are switched off.
 * "Nothing today" is a lie when the events exist and a filter is hiding them,
 * and Today has no filter chips of its own to reveal the cause.
 *
 * @param {object[]} silenced Sources that are hidden or muted.
 * @param {() => void} onShowAll
 */
export function filteredNotice(silenced, onShowAll) {
  if (!silenced.length) return null;

  const names = silenced.map((s) => s.label).join(', ');
  const label =
    silenced.length === 1
      ? `${names} is switched off`
      : `${silenced.length} calendars are switched off: ${names}`;

  return h(
    'div.filtered-notice',
    null,
    h('span', null, label),
    tappable('button.filtered-notice-action', { onTap: onShowAll }, 'Show all')
  );
}
