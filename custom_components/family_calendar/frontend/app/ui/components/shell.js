/**
 * The persistent frame: header with clock and connection state, calendar
 * filter chips, and the bottom navigation.
 */

import { h, tappable, render } from '../../util/dom.js';
import { fmtClock, fmtWeekday, fmtLongDate } from '../../util/dates.js';

const STATUS_TEXT = {
  idle: 'Offline',
  connecting: 'Connecting',
  connected: 'Live',
  reconnecting: 'Reconnecting',
  'auth-failed': 'Token rejected',
  error: 'No connection',
};

/**
 * Build the top bar.
 *
 * @param {object} options
 * @param {() => void} options.onOpenSettings Fired by tapping the status indicator.
 * @returns {{element: HTMLElement, setTitle: Function, setStatus: Function, tick: Function}}
 */
export function topbar({ onOpenSettings }) {
  const title = h('div.topbar-title');
  const sub = h('div.topbar-sub');
  const clock = h('div.clock');
  const statusDot = h('span.conn-dot');
  const statusText = h('span');

  const status = tappable(
    'div.conn',
    {
      dataset: { status: 'connecting' },
      'aria-label': 'Connection status. Opens settings.',
      onTap: onOpenSettings,
    },
    statusDot,
    statusText
  );

  const element = h(
    'header.topbar',
    null,
    h('div.topbar-date', null, title, sub),
    h('div.topbar-right', null, clock, status)
  );

  return {
    element,

    /** Large heading and its subtitle. Pass nulls to show the live date. */
    setTitle(main, secondary) {
      const now = new Date();
      title.textContent = main !== null && main !== undefined ? main : fmtWeekday(now);
      sub.textContent = secondary !== null && secondary !== undefined ? secondary : fmtLongDate(now);
    },

    /** Shrink the clock on screens where the heading carries the weight. */
    setClockSize(small) {
      clock.classList.toggle('small', Boolean(small));
    },

    setStatus(value) {
      status.dataset.status = value;
      statusText.textContent = STATUS_TEXT[value] || value;
    },

    tick() {
      clock.textContent = fmtClock();
    },
  };
}

/**
 * Calendar filter chips.
 *
 * @param {object} options
 * @param {(entityId:string) => void} options.onToggle
 * @returns {{element: HTMLElement, update: Function}}
 */
export function filterBar({ onToggle }) {
  const element = h('div.filters', { role: 'group', 'aria-label': 'Calendars' });

  return {
    element,

    /**
     * @param {object[]} sources Filterable sources.
     * @param {Set<string>} muted Entity ids currently switched off.
     */
    update(sources, muted) {
      element.hidden = sources.length < 2;
      render(
        element,
        sources.map((source) =>
          tappable(
            'button.chip',
            {
              style: { '--chip-color': source.color },
              'aria-pressed': String(!muted.has(source.entityId)),
              onTap: () => onToggle(source.entityId),
            },
            h('span.chip-dot'),
            source.label
          )
        )
      );
    },
  };
}

const NAV_ITEMS = [
  { id: 'today', glyph: '◉', label: 'Today' },
  { id: 'agenda', glyph: '☰', label: 'Agenda' },
  { id: 'month', glyph: '▦', label: 'Month' },
  { id: 'lists', glyph: '✓', label: 'Lists' },
];

/**
 * Bottom navigation.
 *
 * @param {(id:string) => void} onNavigate
 * @returns {{element: HTMLElement, setActive: Function}}
 */
export function bottomNav(onNavigate) {
  const buttons = new Map();

  const element = h(
    'nav.nav',
    { 'aria-label': 'Main' },
    ...NAV_ITEMS.map((item) => {
      const button = tappable(
        'button',
        { onTap: () => onNavigate(item.id) },
        h('span.nav-glyph', { 'aria-hidden': 'true' }, item.glyph),
        item.label
      );
      buttons.set(item.id, button);
      return button;
    })
  );

  return {
    element,
    setActive(id) {
      for (const [key, button] of buttons) {
        if (key === id) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      }
    },
  };
}

/** The banner shown while Home Assistant is unreachable. */
export function offlineBanner() {
  const text = h('span');
  const element = h('div.offline-banner', { role: 'status', hidden: true }, h('span', null, '⚠'), text);

  return {
    element,
    update(status) {
      const offline = status !== 'connected';
      element.hidden = !offline;
      if (status === 'auth-failed') {
        text.textContent = 'Home Assistant rejected the access token. Open settings to enter a new one.';
      } else if (status === 'reconnecting') {
        text.textContent = 'Lost contact with Home Assistant. Retrying — what you see may be out of date.';
      } else if (status === 'error') {
        text.textContent = 'Cannot reach Home Assistant. Check that it is running and on this network.';
      } else if (status === 'connecting') {
        text.textContent = 'Connecting to Home Assistant…';
      }
    },
  };
}

/** The floating add button. */
export function fab(onTap, label = 'Add') {
  return tappable('button.fab', { onTap, 'aria-label': label }, '+');
}
