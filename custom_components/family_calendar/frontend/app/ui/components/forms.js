/**
 * Event and to-do editing sheets.
 *
 * Both forms adapt to what the target entity actually supports rather than
 * showing controls that will fail: the calendar picker lists only writable
 * calendars, and the to-do form drops due dates and notes for lists like
 * `todo.shopping_list` that do not implement them.
 */

import { h, tappable } from '../../util/dom.js';
import { openSheet } from './sheet.js';
import {
  dayKey,
  zonedDate,
  zonedParts,
  todayKey,
  fmtTime,
  fmtShortDate,
  startOfDay,
} from '../../util/dates.js';

/** A labelled form field. */
function field(label, control) {
  return h('div.field', null, h('label', null, label), control);
}

function input(type, value, attrs = {}) {
  return h('input', { type, value: value ?? '', ...attrs });
}

/** `HH:MM` in the app's timezone, for a time input. */
function timeValue(date) {
  const p = zonedParts(date);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Combine a `YYYY-MM-DD` and `HH:MM` into a Date in the app's timezone. */
function combine(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  return zonedDate(y, m, d, hh, mm, 0);
}

/**
 * Open the event editor.
 *
 * @param {object} options
 * @param {object|null} options.event Existing event, or null to create.
 * @param {object[]} options.sources Writable calendar sources.
 * @param {string} [options.defaultDay] Day to prefill when creating.
 * @param {(form:object, event:object|null) => Promise<void>} options.onSave
 * @param {(event:object) => void} [options.onDelete]
 */
export function eventSheet({ event, sources, defaultDay, onSave, onDelete }) {
  const editing = Boolean(event);

  if (!sources.length) {
    openSheet({
      title: 'No editable calendar',
      body: h(
        'p',
        { style: { margin: 0, color: 'var(--ink-2)' } },
        'None of the calendars connected to Home Assistant accept new events. ' +
          'Local Calendar entities do; the Recycle! collection calendars are read-only.'
      ),
      actions: [],
    });
    return;
  }

  const startDay = editing ? event.startKey : defaultDay || todayKey();
  const endDay = editing ? event.endKey : startDay;

  const calendarSelect = h(
    'select',
    { disabled: editing || undefined },
    ...sources.map((s) =>
      h(
        'option',
        { value: s.entityId, selected: editing && s.entityId === event.entityId ? true : undefined },
        s.label
      )
    )
  );

  const summary = input('text', editing ? event.summary : '', {
    placeholder: 'What is happening?',
    autocomplete: 'off',
  });

  const allDayToggle = tappable('button.switch', {
    role: 'switch',
    'aria-checked': String(editing ? event.allDay : false),
    'aria-label': 'All day',
  });

  const startDate = input('date', startDay);
  const startTime = input('time', editing && !event.allDay ? timeValue(event.start) : '09:00');
  const endDate = input('date', endDay);
  const endTime = input('time', editing && !event.allDay ? timeValue(event.end) : '10:00');

  const location = input('text', editing ? event.location : '', { placeholder: 'Optional' });
  const description = h('textarea', { placeholder: 'Optional' }, editing ? event.description : '');

  const timeRow = h('div.field-row', null, field('Start time', startTime), field('End time', endTime));

  function syncAllDay() {
    timeRow.hidden = allDayToggle.getAttribute('aria-checked') === 'true';
  }
  syncAllDay();

  allDayToggle.addEventListener('click', () => {
    const next = allDayToggle.getAttribute('aria-checked') !== 'true';
    allDayToggle.setAttribute('aria-checked', String(next));
    syncAllDay();
  });

  // Keep the end from drifting behind the start as the user edits.
  startDate.addEventListener('change', () => {
    if (endDate.value < startDate.value) endDate.value = startDate.value;
  });

  const error = h('div.setup-error', { hidden: true });

  const body = h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' } },
    error,
    field('Calendar', calendarSelect),
    field('Title', summary),
    h(
      'div.switch-row',
      null,
      h('span.switch-label', null, h('b', null, 'All day'), h('span', null, 'Hide the times')),
      allDayToggle
    ),
    h('div.field-row', null, field('Start date', startDate), field('End date', endDate)),
    timeRow,
    field('Location', location),
    field('Notes', description)
  );

  const save = tappable('button.btn.btn-primary', {}, editing ? 'Save' : 'Add event');

  const actions = [tappable('button.btn.btn-secondary', { onTap: () => close() }, 'Cancel'), save];

  if (editing && onDelete) {
    actions.unshift(
      tappable('button.btn.btn-danger', {
        onTap: () => {
          close();
          onDelete(event);
        },
      }, 'Delete')
    );
  }

  const { close } = openSheet({
    title: editing ? 'Edit event' : 'New event',
    body,
    actions,
  });

  save.addEventListener('click', async () => {
    const allDay = allDayToggle.getAttribute('aria-checked') === 'true';

    if (!summary.value.trim()) {
      error.hidden = false;
      error.textContent = 'Give the event a title.';
      return;
    }

    const start = allDay ? combine(startDate.value, '00:00') : combine(startDate.value, startTime.value);
    const end = allDay ? combine(endDate.value, '00:00') : combine(endDate.value, endTime.value);

    if (!allDay && end <= start) {
      error.hidden = false;
      error.textContent = 'The end time has to be after the start time.';
      return;
    }
    if (allDay && endDate.value < startDate.value) {
      error.hidden = false;
      error.textContent = 'The end date has to be on or after the start date.';
      return;
    }

    save.disabled = true;
    save.textContent = 'Saving…';

    try {
      await onSave(
        {
          entityId: editing ? event.entityId : calendarSelect.value,
          summary: summary.value.trim(),
          description: description.value.trim(),
          location: location.value.trim(),
          allDay,
          start,
          end,
        },
        event || null
      );
      close();
    } catch (err) {
      save.disabled = false;
      save.textContent = editing ? 'Save' : 'Add event';
      error.hidden = false;
      error.textContent = err && err.message ? err.message : 'Home Assistant refused the change.';
    }
  });
}

/**
 * Open the to-do editor.
 *
 * @param {object} options
 * @param {object|null} options.item Existing item, or null to create.
 * @param {object} options.list The list, for capability checks.
 * @param {(form:object, item:object|null) => Promise<void>} options.onSave
 * @param {(item:object) => void} [options.onDelete]
 */
export function todoSheet({ item, list, onSave, onDelete }) {
  const editing = Boolean(item);

  const summary = input('text', editing ? item.summary : '', {
    placeholder: 'What needs doing?',
    autocomplete: 'off',
  });

  const dueDate = input('date', editing && item.dueKey ? item.dueKey : '');
  const dueTime = input(
    'time',
    editing && item.dueHasTime && item.dueDate ? timeValue(item.dueDate) : ''
  );
  const description = h('textarea', { placeholder: 'Optional' }, editing ? item.description : '');

  const error = h('div.setup-error', { hidden: true });

  const fields = [error, field('Task', summary)];

  if (list.canSetDue) {
    fields.push(
      list.canSetDueTime
        ? h('div.field-row', null, field('Due date', dueDate), field('Due time', dueTime))
        : field('Due date', dueDate)
    );
  }

  if (list.canDescribe) {
    fields.push(field('Notes', description));
  }

  if (!list.canSetDue && !list.canDescribe) {
    fields.push(
      h(
        'p',
        { style: { margin: 0, color: 'var(--ink-3)', fontSize: 'var(--t-sm)' } },
        `${list.label} does not support due dates or notes.`
      )
    );
  }

  const save = tappable('button.btn.btn-primary', {}, editing ? 'Save' : 'Add task');
  const actions = [tappable('button.btn.btn-secondary', { onTap: () => close() }, 'Cancel'), save];

  if (editing && onDelete && list.canDelete) {
    actions.unshift(
      tappable('button.btn.btn-danger', {
        onTap: () => {
          close();
          onDelete(item);
        },
      }, 'Delete')
    );
  }

  const { close } = openSheet({
    title: editing ? 'Edit task' : `Add to ${list.label}`,
    body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' } }, ...fields),
    actions,
  });

  save.addEventListener('click', async () => {
    if (!summary.value.trim()) {
      error.hidden = false;
      error.textContent = 'Give the task a name.';
      return;
    }

    save.disabled = true;
    save.textContent = 'Saving…';

    const form = {
      summary: summary.value.trim(),
      description: description.value.trim(),
      dueKey: dueDate.value || null,
      dueDate: dueDate.value && dueTime.value ? combine(dueDate.value, dueTime.value) : null,
      clearDue: editing && item.dueKey && !dueDate.value,
    };

    try {
      await onSave(form, item || null);
      close();
    } catch (err) {
      save.disabled = false;
      save.textContent = editing ? 'Save' : 'Add task';
      error.hidden = false;
      error.textContent = err && err.message ? err.message : 'Home Assistant refused the change.';
    }
  });
}

/** A read-only label/value pair inside a detail sheet. */
function detail(label, value, options = {}) {
  if (!value) return null;
  return h(
    'div.field',
    null,
    h('label', null, label),
    h(
      'div',
      {
        style: {
          fontSize: options.small ? 'var(--t-sm)' : 'var(--t-md)',
          color: options.muted ? 'var(--ink-2)' : 'var(--ink)',
          lineHeight: '1.5',
          whiteSpace: options.wrap ? 'pre-wrap' : 'normal',
        },
      },
      value
    )
  );
}

/** "Wed 2 Sept 2026, 15:45 – 16:30", or the right shape for all-day and multi-day. */
function describeWhen(event) {
  const startDay = fmtShortDate(event.start);

  if (event.allDay) {
    if (event.startKey === event.endKey) return `${startDay}, all day`;
    return `${startDay} – ${fmtShortDate(startOfDay(event.endKey))}, all day`;
  }

  if (event.startKey === event.endKey) {
    return `${startDay}, ${fmtTime(event.start)} – ${fmtTime(event.end)}`;
  }
  return `${startDay} ${fmtTime(event.start)} → ${fmtShortDate(event.end)} ${fmtTime(event.end)}`;
}

/**
 * What one tap on an event opens: the whole thing, read-only, with Edit and
 * Delete offered only where the calendar actually supports them.
 *
 * A tap never opens a form directly. On a wall display anyone walking past can
 * brush a row, and this is also the only interaction that works identically
 * with a finger and a mouse.
 */
export function eventDetailSheet(event, source, { onEdit, onDelete } = {}) {
  const canEdit = Boolean(onEdit && event.editable && source.canUpdate);
  const canDelete = Boolean(onDelete && event.editable && source.canDelete);

  const body = h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' } },
    detail('When', describeWhen(event)),
    detail('Where', event.location),
    detail('Notes', event.description, { small: true, muted: true, wrap: true }),
    detail('Calendar', `${source.label}${source.writable ? '' : ' · read-only'}`),
    event.rrule || event.recurrenceId
      ? detail('Repeats', 'This event is part of a series.', { small: true, muted: true })
      : null
  );

  const actions = [];
  if (canDelete) {
    actions.push(
      tappable('button.btn.btn-danger', { onTap: () => { close(); onDelete(event); } }, 'Delete')
    );
  }
  actions.push(tappable('button.btn.btn-secondary', { onTap: () => close() }, 'Close'));
  if (canEdit) {
    actions.push(
      tappable('button.btn.btn-primary', { onTap: () => { close(); onEdit(event); } }, 'Edit')
    );
  }

  const { close } = openSheet({ title: event.summary, body, actions });
}

/** The same treatment for a to-do item. */
export function todoDetailSheet(item, list, { onEdit, onDelete, onToggle } = {}) {
  const due = item.dueKey
    ? item.dueHasTime && item.dueDate
      ? `${fmtShortDate(item.dueDate)}, ${fmtTime(item.dueDate)}`
      : fmtShortDate(startOfDay(item.dueKey))
    : null;

  const body = h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' } },
    detail('Status', item.done ? 'Done' : 'Not done yet'),
    detail('Due', due),
    detail('Notes', item.description, { small: true, muted: true, wrap: true }),
    detail('List', list.label),
    !list.canSetDue && !list.canDescribe
      ? detail('', `${list.label} does not support due dates or notes.`, { small: true, muted: true })
      : null
  );

  const actions = [];
  if (onDelete && list.canDelete) {
    actions.push(
      tappable('button.btn.btn-danger', { onTap: () => { close(); onDelete(item); } }, 'Delete')
    );
  }

  if (onToggle && list.canUpdate) {
    actions.push(
      tappable(
        'button.btn.btn-secondary',
        { onTap: () => { close(); onToggle(item, !item.done); } },
        item.done ? 'Reopen' : 'Done'
      )
    );
  }

  actions.push(tappable('button.btn.btn-secondary', { onTap: () => close() }, 'Close'));

  if (onEdit && list.canUpdate) {
    actions.push(
      tappable('button.btn.btn-primary', { onTap: () => { close(); onEdit(item); } }, 'Edit')
    );
  }

  const { close } = openSheet({ title: item.summary, body, actions });
}
