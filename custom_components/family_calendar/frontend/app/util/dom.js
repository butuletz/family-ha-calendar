/**
 * Minimal DOM construction helpers.
 *
 * The app has no build step and no framework. Screens build DOM trees with
 * `h()` and swap them into a container; at this scale (tens of rows) a full
 * rebuild is cheaper to reason about than a diffing layer, and `keepScroll`
 * covers the one thing a rebuild would otherwise lose.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'g', 'polyline', 'text']);

/**
 * Create an element.
 *
 * @param {string} tag Tag name, optionally with `.class` suffixes: `"div.row.wide"`.
 * @param {object|null} [props] Attributes. `class`, `style` (string or object),
 *   `dataset`, `on*` event handlers, and `html` (innerHTML) get special handling.
 * @param {...any} children Nodes, strings, numbers, arrays; `null`/`false`/`undefined` skipped.
 * @returns {HTMLElement|SVGElement}
 */
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = SVG_TAGS.has(name)
    ? document.createElementNS(SVG_NS, name)
    : document.createElement(name);

  if (classes.length) el.setAttribute('class', classes.join(' '));

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;

      if (key === 'class' || key === 'className') {
        const merged = [classes.join(' '), value].filter(Boolean).join(' ');
        el.setAttribute('class', merged);
      } else if (key === 'style' && typeof value === 'object') {
        for (const [prop, val] of Object.entries(value)) {
          if (val === null || val === undefined) continue;
          // Custom properties must go through setProperty — assigning them on
          // the style object just creates an ignored expando, which silently
          // drops every per-calendar colour.
          if (prop.startsWith('--')) el.style.setProperty(prop, val);
          else el.style[prop] = val;
        }
      } else if (key === 'dataset') {
        for (const [d, v] of Object.entries(value)) el.dataset[d] = v;
      } else if (key === 'html') {
        el.innerHTML = value;
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, value);
      }
    }
  }

  append(el, children);
  return el;
}

/** Append children of any supported shape to a parent. */
export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replace everything inside `container` with `nodes`. */
export function render(container, ...nodes) {
  container.textContent = '';
  append(container, nodes);
  return container;
}

/**
 * Re-render a scrollable container without losing the reader's place.
 * @param {HTMLElement} container
 * @param {() => (Node|Node[])} build
 */
export function keepScroll(container, build) {
  const top = container.scrollTop;
  render(container, build());
  container.scrollTop = top;
}

/** Remove every child of an element. */
export function clear(el) {
  el.textContent = '';
  return el;
}

/**
 * Attach a handler that fires on tap but not on scroll — a plain `click` on
 * Android fires after a 300ms settle and can survive a drag, which makes
 * list rows feel unresponsive and occasionally fire the wrong one.
 *
 * @param {HTMLElement} el
 * @param {(ev: Event) => void} handler
 */
export function onTap(el, handler) {
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let moved = false;

  el.addEventListener(
    'pointerdown',
    (ev) => {
      pointerId = ev.pointerId;
      startX = ev.clientX;
      startY = ev.clientY;
      moved = false;
      el.classList.add('is-pressed');
    },
    { passive: true }
  );

  el.addEventListener(
    'pointermove',
    (ev) => {
      if (ev.pointerId !== pointerId) return;
      if (Math.abs(ev.clientX - startX) > 10 || Math.abs(ev.clientY - startY) > 10) {
        moved = true;
        el.classList.remove('is-pressed');
      }
    },
    { passive: true }
  );

  el.addEventListener('pointerup', (ev) => {
    el.classList.remove('is-pressed');

    // A tap has to be the *end of a press that started here*. Dismissing a
    // sheet removes the scrim mid-gesture, and the pointerup then lands on
    // whatever was underneath -- which must not count as a tap on that thing,
    // or closing the editor over an event immediately reopens it.
    if (pointerId === null || ev.pointerId !== pointerId) return;
    pointerId = null;

    if (!moved) handler(ev);
  });

  el.addEventListener('pointercancel', () => {
    pointerId = null;
    moved = true;
    el.classList.remove('is-pressed');
  });

  return el;
}

/** `h()` plus a tap handler, for the many rows that are buttons in spirit. */
export function tappable(tag, props, ...children) {
  const { onTap: handler, ...rest } = props || {};
  const el = h(tag, { role: 'button', tabindex: '0', ...rest }, ...children);
  if (handler) {
    onTap(el, handler);
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        handler(ev);
      }
    });
  }
  return el;
}

/**
 * Attach a long-press handler (used to open the edit sheet on an event row).
 * @param {HTMLElement} el
 * @param {(ev: Event) => void} handler
 * @param {number} [ms]
 */
export function onLongPress(el, handler, ms = 500) {
  let timer = null;
  let pointerId = null;
  let startX = 0;
  let startY = 0;

  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pointerId = null;
    // Listening on the document in the capture phase is deliberate. A child
    // that calls stopPropagation on its own pointerup — the to-do checkbox
    // does, so a tick does not also count as a row tap — would otherwise keep
    // this timer alive and fire a long press the user never made.
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    document.removeEventListener('pointermove', onMove, true);
  };

  // Only the pointer that started the press can end it. Without this check a
  // mouse moving anywhere over the page — or a second finger resting on the
  // screen — cancels a hold the user is still making.
  const isSamePointer = (ev) => pointerId === null || ev.pointerId === pointerId;

  const onUp = (ev) => {
    if (isSamePointer(ev)) stop();
  };

  const onMove = (ev) => {
    if (!isSamePointer(ev)) return;
    // A finger never holds perfectly still; only a real drag should cancel.
    if (Math.abs(ev.clientX - startX) > 12 || Math.abs(ev.clientY - startY) > 12) stop();
  };

  el.addEventListener(
    'pointerdown',
    (ev) => {
      stop();
      pointerId = ev.pointerId;
      startX = ev.clientX;
      startY = ev.clientY;

      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onUp, true);
      document.addEventListener('pointermove', onMove, true);

      timer = setTimeout(() => {
        stop();
        if (navigator.vibrate) navigator.vibrate(12);
        handler(ev);
      }, ms);
    },
    { passive: true }
  );

  return el;
}
