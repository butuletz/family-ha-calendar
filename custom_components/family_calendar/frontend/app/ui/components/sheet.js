/**
 * Bottom sheets.
 *
 * Everything modal slides up from the bottom edge rather than appearing
 * centred: on a 1280px-tall portrait tablet the top half is out of thumb reach,
 * and a wall-mounted device is often operated one-handed from below.
 */

import { h, tappable, append } from '../../util/dom.js';

let openSheetEl = null;

/**
 * Where sheets attach. Inside a Home Assistant panel there is no page-level
 * `#app` to reach for — the app lives in a shadow root — so the host is handed
 * in at mount time instead of being looked up globally.
 */
let sheetHost = null;

export function setSheetHost(element) {
  sheetHost = element;
}

/**
 * Open a bottom sheet.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {Node|Node[]} options.body
 * @param {Node[]} [options.actions] Buttons for the footer row.
 * @param {() => void} [options.onClose]
 * @returns {{close: () => void, element: HTMLElement}}
 */
export function openSheet({ title, body, actions = [], onClose }) {
  closeSheet();

  const sheet = h(
    'div.sheet',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.sheet-grip'),
    h('div.sheet-title', null, title),
    h('div.sheet-body')
  );

  append(sheet.querySelector('.sheet-body'), [body]);

  if (actions.length) {
    sheet.appendChild(h('div.sheet-actions', null, ...actions));
  }

  const scrim = h('div.sheet-scrim', {}, sheet);

  // Tapping the scrim closes. The whole gesture has to begin and end on the
  // scrim: closing on pointerdown alone would tear the scrim away mid-press and
  // hand the pointerup to whatever sits underneath.
  let pressedScrim = false;

  scrim.addEventListener('pointerdown', (ev) => {
    pressedScrim = ev.target === scrim;
  });

  scrim.addEventListener('pointerup', (ev) => {
    const dismiss = pressedScrim && ev.target === scrim;
    pressedScrim = false;
    if (dismiss) close();
  });

  const onKey = (ev) => {
    if (ev.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  function close() {
    document.removeEventListener('keydown', onKey);
    if (scrim.parentNode) scrim.remove();
    if (openSheetEl === scrim) openSheetEl = null;
    if (onClose) onClose();
  }

  (sheetHost || document.body).appendChild(scrim);
  openSheetEl = scrim;

  // Focus the first field so a physical keyboard can drive the sheet too.
  const firstInput = sheet.querySelector('input, textarea, select');
  if (firstInput) firstInput.focus();

  return { close, element: sheet };
}

/** Close whichever sheet is open, if any. */
export function closeSheet() {
  if (openSheetEl) {
    openSheetEl.remove();
    openSheetEl = null;
  }
}

/** A confirmation sheet, for deletes and other one-way actions. */
export function confirmSheet({ title, message, confirmLabel = 'Delete', onConfirm }) {
  const { close } = openSheet({
    title,
    body: h('p', { style: { margin: '0', color: 'var(--ink-2)', fontSize: 'var(--t-md)' } }, message),
    actions: [
      tappable('button.btn.btn-secondary', { onTap: () => close() }, 'Cancel'),
      tappable(
        'button.btn.btn-primary',
        {
          style: { background: 'var(--danger)', color: '#fff' },
          onTap: () => {
            close();
            onConfirm();
          },
        },
        confirmLabel
      ),
    ],
  });
}

/**
 * Ask how a change to a repeating event should apply. Home Assistant needs a
 * `recurrence_range` for these, and guessing on the user's behalf would quietly
 * rewrite a whole series.
 *
 * @param {(range: ""|"thisandfuture") => void} onPick
 */
export function recurrenceSheet({ title, onPick }) {
  const { close } = openSheet({
    title,
    body: h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' } },
      h(
        'p',
        { style: { margin: '0', color: 'var(--ink-2)', fontSize: 'var(--t-md)' } },
        'This event repeats. Which occurrences should change?'
      ),
      tappable(
        'button.btn.btn-secondary',
        { onTap: () => { close(); onPick(''); } },
        'Only this one'
      ),
      tappable(
        'button.btn.btn-secondary',
        { onTap: () => { close(); onPick('thisandfuture'); } },
        'This and all future'
      )
    ),
    actions: [tappable('button.btn.btn-secondary', { onTap: () => close() }, 'Cancel')],
  });
}
