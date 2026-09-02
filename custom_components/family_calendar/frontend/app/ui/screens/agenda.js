/**
 * Agenda — a day-grouped scroll forward from today.
 *
 * The portrait workhorse. Days with nothing in them are skipped entirely
 * rather than drawn as empty rows, so a quiet fortnight does not push next
 * month off the bottom of the screen.
 */

import { h, keepScroll } from '../../util/dom.js';
import { todayKey, addDays } from '../../util/dates.js';
import { groupByDay } from '../../data/calendars.js';
import { eventRow, dayHeading, emptyState, skeletonRows, filteredNotice } from '../components/rows.js';
import { parseFraction } from '../../data/waste.js';

const HORIZON_DAYS = 60;

export function createAgendaScreen(ctx) {
  const element = h('div.screen-body');

  return {
    id: 'agenda',
    element,
    showFilters: true,
    smallClock: true,

    fab: () => ({
      label: 'New event',
      onTap: () => ctx.actions.newEvent(todayKey()),
    }),

    title: () => ({ main: 'Agenda', sub: `Next ${HORIZON_DAYS} days` }),

    update() {
      keepScroll(element, () => build(ctx));
    },
  };
}

function build(ctx) {
  const state = ctx.state();

  if (state.loadingEvents && !state.eventsLoaded) {
    return skeletonRows(6);
  }

  const from = todayKey();
  const to = addDays(from, HORIZON_DAYS);

  const registry = ctx.registry();
  const events = (state.events || []).filter((ev) => ctx.isVisibleSource(ev.entityId));

  if (!events.length) {
    const silenced = ctx.silencedEventSources();
    return [
      emptyState(
        '☰',
        silenced.length ? 'Every calendar is switched off' : 'Nothing scheduled',
        silenced.length
          ? 'Turn one back on to see what is coming up.'
          : 'Events from your Home Assistant calendars will appear here. Tap + to add one.'
      ),
      filteredNotice(silenced, () => ctx.actions.showAllCalendars()),
    ].filter(Boolean);
  }

  const days = groupByDay(events, from, to);
  const nodes = [];

  for (const [key, list] of days) {
    if (!list.length) continue;

    nodes.push(dayHeading(key));

    for (const ev of list) {
      const source = registry[ev.entityId];

      // Waste events carry the address in every summary; show just the fraction.
      const display =
        source && source.kind === 'waste'
          ? { ...ev, summary: parseFraction(ev.summary, source.stripPrefix).label }
          : ev;

      nodes.push(
        eventRow(display, source, {
          showTag: true,
          onOpen: (e) => ctx.actions.openEvent(e),
          onEdit: (e) => ctx.actions.editEvent(e),
        })
      );
    }
  }

  if (!nodes.length) {
    const silenced = ctx.silencedEventSources();
    return [
      emptyState('☰', 'Nothing in the next two months', 'Tap + to add an event.'),
      filteredNotice(silenced, () => ctx.actions.showAllCalendars()),
    ].filter(Boolean);
  }

  return nodes;
}
