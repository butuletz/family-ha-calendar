/**
 * Settings, opened from the connection indicator in the header.
 *
 * Deliberately not on the bottom navigation: this is a shared household
 * display, and the four things people use daily should not sit beside a
 * control that can disconnect the tablet.
 */

import { h, tappable } from '../../util/dom.js';
import { openSheet, confirmSheet } from '../components/sheet.js';
import { getTimeZone } from '../../util/dates.js';

/**
 * There is nothing here about connecting or signing in: the panel runs inside
 * Home Assistant, which has already authenticated whoever is looking.
 *
 * @param {object} ctx
 */
export function openSettings(ctx) {
  const settings = ctx.settings();
  const registry = ctx.registry();
  const state = ctx.state();

  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' } });

  /* Calendars ------------------------------------------------------------- */
  body.appendChild(h('h3', null, 'Calendars'));

  const sources = Object.values(registry).sort((a, b) => {
    const order = { events: 0, waste: 1, park: 2 };
    return (order[a.kind] - order[b.kind]) || a.label.localeCompare(b.label);
  });

  for (const source of sources) {
    const swatch = h('input.color-swatch', {
      type: 'color',
      value: source.color,
      'aria-label': `Colour for ${source.label}`,
    });

    swatch.addEventListener('change', () => {
      ctx.actions.updateSource(source.entityId, { color: swatch.value });
    });

    const visible = tappable('button.switch', {
      role: 'switch',
      'aria-checked': String(!source.hidden),
      'aria-label': `Show ${source.label}`,
    });

    visible.addEventListener('click', () => {
      const next = visible.getAttribute('aria-checked') !== 'true';
      visible.setAttribute('aria-checked', String(next));
      ctx.actions.updateSource(source.entityId, { hidden: !next });
    });

    body.appendChild(
      h(
        'div.source-row',
        null,
        swatch,
        h(
          'span.source-name',
          null,
          h('b', null, source.label),
          h('span', null, source.entityId)
        ),
        visible
      )
    );

    // What a calendar *is* is a choice, not a guess. Everything starts as an
    // ordinary calendar; this is where a collection schedule or a set of
    // opening hours gets told apart.
    const kindSelect = h(
      'select',
      null,
      ...[
        ['events', 'A calendar'],
        ['waste', 'Waste collections'],
        ['park', 'Opening hours'],
      ].map(([value, label]) =>
        h('option', { value, selected: source.kind === value ? true : undefined }, label)
      )
    );

    kindSelect.addEventListener('change', () => {
      ctx.actions.updateSource(source.entityId, { kind: kindSelect.value });
      // The rest of this row depends on the kind, so redraw the whole sheet
      // rather than patch it in place.
      close();
      openSettings(ctx);
    });

    body.appendChild(
      h(
        'div.field',
        { style: { padding: '0 0 var(--s-2) var(--s-4)' } },
        h('label', null, 'Shows as'),
        kindSelect
      )
    );

    // Waste calendars record when the truck arrives, not when the bins go out.
    if (source.kind === 'waste') {
      const remind = h(
        'select',
        null,
        ...[
          [0, 'On the collection day'],
          [1, 'The evening before'],
          [2, 'Two days before'],
        ].map(([value, label]) =>
          h(
            'option',
            { value: String(value), selected: source.remindDaysBefore === value ? true : undefined },
            label
          )
        )
      );

      remind.addEventListener('change', () => {
        ctx.actions.updateSource(source.entityId, { remindDaysBefore: Number(remind.value) });
      });

      body.appendChild(
        h(
          'div.field',
          { style: { padding: '0 0 var(--s-2) var(--s-4)' } },
          h('label', null, `Remind me to put ${source.label.toLowerCase()} out`),
          remind
        )
      );
    }
  }

  body.appendChild(
    h(
      'p',
      { style: { margin: '0', fontSize: 'var(--t-sm)', color: 'var(--ink-3)', lineHeight: '1.5' } },
      'Waste collections appear as a banner on Today rather than as rows, with the collection date read a day early so the bins go out in time. Opening hours are calendars that publish the same event every day, which would bury the agenda, so they start hidden.'
    )
  );

  /* Lists ----------------------------------------------------------------- */
  if ((state.lists || []).length) {
    body.appendChild(h('h3', null, 'To-do lists'));

    for (const list of state.lists) {
      const hidden = ctx.isHiddenList(list.entityId);
      const toggle = tappable('button.switch', {
        role: 'switch',
        'aria-checked': String(!hidden),
        'aria-label': `Show ${list.label}`,
      });

      toggle.addEventListener('click', () => {
        const next = toggle.getAttribute('aria-checked') !== 'true';
        toggle.setAttribute('aria-checked', String(next));
        ctx.actions.updateList(list.entityId, { hidden: !next });
      });

      const caps = [
        list.canSetDue ? 'due dates' : null,
        list.canDescribe ? 'notes' : null,
      ].filter(Boolean);

      body.appendChild(
        h(
          'div.source-row',
          null,
          h(
            'span.source-name',
            null,
            h('b', null, list.label),
            h('span', null, caps.length ? `Supports ${caps.join(' and ')}` : 'Simple list')
          ),
          toggle
        )
      );
    }
  }

  /* Display --------------------------------------------------------------- */
  body.appendChild(h('h3', null, 'Display'));

  const nightSelect = h(
    'select',
    null,
    h('option', { value: 'auto', selected: settings.nightMode === 'auto' ? true : undefined }, `Automatic (${settings.nightStart}:00–${settings.nightEnd}:00)`),
    h('option', { value: 'on', selected: settings.nightMode === 'on' ? true : undefined }, 'Always dark'),
    h('option', { value: 'off', selected: settings.nightMode === 'off' ? true : undefined }, 'Always light')
  );
  nightSelect.addEventListener('change', () => {
    ctx.actions.updateSettings({ nightMode: nightSelect.value });
  });
  body.appendChild(h('div.field', null, h('label', null, 'Night mode'), nightSelect));

  const startSelect = h(
    'select',
    null,
    ...[
      ['today', 'Today'],
      ['agenda', 'Agenda'],
      ['month', 'Month'],
      ['lists', 'Lists'],
    ].map(([value, label]) =>
      h('option', { value, selected: settings.startScreen === value ? true : undefined }, label)
    )
  );
  startSelect.addEventListener('change', () => {
    ctx.actions.updateSettings({ startScreen: startSelect.value });
  });
  body.appendChild(h('div.field', null, h('label', null, 'Opens on'), startSelect));

  const awake = tappable('button.switch', {
    role: 'switch',
    'aria-checked': String(settings.keepAwake),
    'aria-label': 'Keep the screen awake',
  });
  awake.addEventListener('click', () => {
    const next = awake.getAttribute('aria-checked') !== 'true';
    awake.setAttribute('aria-checked', String(next));
    ctx.actions.updateSettings({ keepAwake: next });
  });

  body.appendChild(
    h(
      'div.switch-row',
      null,
      h(
        'span.switch-label',
        null,
        h('b', null, 'Keep the screen awake'),
        h('span', null, 'Stops the tablet sleeping while this page is open')
      ),
      awake
    )
  );

  /* Connection ------------------------------------------------------------ */
  body.appendChild(h('h3', null, 'Connection'));

  body.appendChild(
    h(
      'div.setup-note',
      null,
      h('div', null, h('b', null, 'Home Assistant: '), ctx.conn().haVersion || 'unknown'),
      h('div', null, h('b', null, 'Time zone: '), getTimeZone()),
      h('div', null, h('b', null, 'Connection: '), ctx.conn().status),
      h(
        'div',
        null,
        h('b', null, 'Signed in as: '),
        (ctx.conn().user && ctx.conn().user.name) || 'this Home Assistant user'
      )
    )
  );

  const { close } = openSheet({
    title: 'Settings',
    body,
    actions: [tappable('button.btn.btn-primary', { onTap: () => close() }, 'Done')],
  });
}
