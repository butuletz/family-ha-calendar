/**
 * Month — a seven-column grid with a day drawer underneath.
 *
 * Seven columns fit portrait comfortably at 800px. Cells carry colour dots for
 * which calendars have something that day, never counts: at this cell size a
 * number is unreadable across a kitchen, but a colour is not.
 */

import { h, tappable, keepScroll, render } from '../../util/dom.js';
import {
  todayKey,
  monthGrid,
  WEEKDAY_LABELS,
  fmtMonthYear,
  fmtDayHeading,
  startOfDay,
  zonedParts,
  addDays,
} from '../../util/dates.js';
import { dayColorIndex } from '../../data/calendars.js';
import { eventRow, emptyState } from '../components/rows.js';
import { parseFraction } from '../../data/waste.js';

export function createMonthScreen(ctx) {
  const element = h('div.screen-body');

  const now = zonedParts(new Date());
  let year = now.year;
  let month = now.month;
  let selected = todayKey();

  function shiftMonth(delta) {
    month += delta;
    if (month > 12) {
      month = 1;
      year += 1;
    } else if (month < 1) {
      month = 12;
      year -= 1;
    }
    // Selecting the 1st keeps the drawer meaningful when jumping months.
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    selected = selected.startsWith(`${year}-${String(month).padStart(2, '0')}`) ? selected : first;

    ctx.actions.ensureRange(addDays(first, -7), addDays(first, 45));
    screen.update();
    ctx.refreshChrome();
  }

  const screen = {
    id: 'month',
    element,
    showFilters: true,
    smallClock: true,
    fab: () => ({
      label: 'New event',
      onTap: () => ctx.actions.newEvent(selected),
    }),

    title: () => ({
      main: fmtMonthYear(startOfDay(`${year}-${String(month).padStart(2, '0')}-01`)),
      // The heading already carries the month, so the subtitle names the day
      // whose events are showing in the drawer below the grid.
      sub: `Showing ${fmtDayHeading(selected)}`,
      controls: [
        tappable('button', { onTap: () => shiftMonth(-1), 'aria-label': 'Previous month' }, '‹'),
        tappable('button', { onTap: () => shiftMonth(1), 'aria-label': 'Next month' }, '›'),
      ],
    }),

    onEnter() {
      const first = `${year}-${String(month).padStart(2, '0')}-01`;
      ctx.actions.ensureRange(addDays(first, -7), addDays(first, 45));
    },

    update() {
      keepScroll(element, () => build());
    },
  };

  function build() {
    const state = ctx.state();
    const registry = ctx.registry();
    const events = (state.events || []).filter((ev) => ctx.isVisibleSource(ev.entityId));
    const colors = dayColorIndex(events, registry);
    const today = todayKey();

    const head = h(
      'div.month-head',
      null,
      ...WEEKDAY_LABELS.map((label) => h('span', null, label))
    );

    const grid = h(
      'div.month-grid',
      null,
      ...monthGrid(year, month).map((cell) => {
        const dots = (colors.get(cell.key) || []).slice(0, 4);
        const classes = [
          !cell.inMonth && 'is-outside',
          cell.key === today && 'is-today',
          cell.key === selected && 'is-selected',
        ]
          .filter(Boolean)
          .join(' ');

        return tappable(
          'div.month-cell',
          {
            class: classes || null,
            'aria-label': fmtDayHeading(cell.key),
            onTap: () => {
              selected = cell.key;
              screen.update();
              ctx.refreshChrome();
            },
          },
          h('span.month-num', null, Number(cell.key.slice(8))),
          dots.length
            ? h(
                'span.month-dots',
                null,
                ...dots.map((d) => h('i', { style: { '--dot-color': d.color } }))
              )
            : null
        );
      })
    );

    /* Day drawer ---------------------------------------------------------- */
    const dayEvents = events
      .filter((ev) => ev.startKey <= selected && ev.endKey >= selected)
      .sort((a, b) => (a.allDay === b.allDay ? a.start - b.start : a.allDay ? -1 : 1));

    const drawer = [h('div.day-heading', { class: selected === today ? 'is-today' : null }, fmtDayHeading(selected))];

    if (!dayEvents.length) {
      drawer.push(
        h(
          'div',
          { style: { padding: 'var(--s-4) 0', color: 'var(--ink-3)', fontSize: 'var(--t-md)' } },
          'Nothing on this day.'
        )
      );
    } else {
      for (const ev of dayEvents) {
        const source = registry[ev.entityId];
        const display =
          source && source.kind === 'waste'
            ? { ...ev, summary: parseFraction(ev.summary, source.stripPrefix).label }
            : ev;

        drawer.push(
          eventRow({ ...display, continuation: ev.startKey < selected }, source, {
            showTag: true,
            onOpen: (e) => ctx.actions.openEvent(e),
            onEdit: (e) => ctx.actions.editEvent(e),
          })
        );
      }
    }

    return [head, grid, ...drawer];
  }

  return screen;
}
