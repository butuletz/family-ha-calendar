/**
 * Today — the screen the tablet rests on.
 *
 * Ordered by what someone walking past needs: what goes out tonight, what is
 * happening today, and what is overdue. Anything further out belongs on Agenda.
 */

import { h, keepScroll } from '../../util/dom.js';
import { todayKey, fmtWeekday, fmtLongDate } from '../../util/dates.js';
import {
  eventRow,
  wasteBanner,
  todoRow,
  sectionHeading,
  emptyState,
  skeletonRows,
  filteredNotice,
} from '../components/rows.js';
import { wasteSchedule } from '../../data/waste.js';

export function createTodayScreen(ctx) {
  const element = h('div.screen-body');

  return {
    id: 'today',
    element,
    showFilters: false,
    smallClock: false,

    fab: () => ({
      label: 'New event',
      onTap: () => ctx.actions.newEvent(todayKey()),
    }),

    title: () => ({ main: fmtWeekday(new Date()), sub: fmtLongDate(new Date()) }),

    update() {
      keepScroll(element, () => build(ctx));
    },
  };
}

function build(ctx) {
  const state = ctx.state();
  const today = todayKey();
  const nodes = [];

  if (state.loadingEvents && !state.eventsLoaded) {
    return skeletonRows(4);
  }

  /* Waste collection ------------------------------------------------------ */
  // The offset belongs to the calendar, so a household with a different
  // collection routine only has to change the setting.
  const wasteSource = Object.values(ctx.registry()).find((s) => s.kind === 'waste' && !s.hidden);
  const banner = wasteBanner(
    wasteSchedule(state.collections || [], today, wasteSource ? wasteSource.remindDaysBefore : 1)
  );
  if (banner) nodes.push(banner);

  /* Today's events -------------------------------------------------------- */
  const events = (state.events || []).filter(
    (ev) => ev.startKey <= today && ev.endKey >= today && ctx.isVisibleEventSource(ev.entityId)
  );

  nodes.push(sectionHeading('Today'));

  if (!events.length) {
    const silenced = ctx.silencedEventSources();
    nodes.push(
      h(
        'div',
        { style: { padding: 'var(--s-5) 0', color: 'var(--ink-3)', fontSize: 'var(--t-md)' } },
        silenced.length ? 'Nothing in the calendars that are switched on.' : 'Nothing in the calendar today.'
      )
    );
    const notice = filteredNotice(silenced, () => ctx.actions.showAllCalendars());
    if (notice) nodes.push(notice);
  } else {
    for (const ev of events) {
      const source = ctx.registry()[ev.entityId];
      nodes.push(
        eventRow(
          { ...ev, continuation: ev.startKey < today },
          source,
          {
            showTag: true,
            onOpen: (e) => ctx.actions.openEvent(e),
            onEdit: (e) => ctx.actions.editEvent(e),
          }
        )
      );
    }
  }

  /* Tasks due today or overdue -------------------------------------------- */
  const due = [];
  for (const list of state.lists || []) {
    const items = (state.todoItems && state.todoItems[list.entityId]) || [];
    for (const item of items) {
      if (!item.done && item.dueKey && item.dueKey <= today) {
        due.push({ item, list });
      }
    }
  }

  due.sort((a, b) => a.item.dueKey.localeCompare(b.item.dueKey));

  if (due.length) {
    nodes.push(sectionHeading(due.length === 1 ? 'Due' : `Due · ${due.length}`));
    for (const { item, list } of due) {
      nodes.push(
        todoRow(item, list, {
          showList: true,
          onOpen: (i) => ctx.actions.openTodo(list, i),
          onToggle: (i, done) => ctx.actions.toggleTodo(list, i, done),
          onEdit: (i) => ctx.actions.editTodo(list, i),
        })
      );
    }
  }

  if (!nodes.length) {
    return emptyState('☀', 'A clear day', 'No events, no collections, nothing due.');
  }

  return nodes;
}
