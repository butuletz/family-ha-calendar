/**
 * Toasts, including the undo affordance that makes optimistic writes safe to
 * offer. Completing a task on a wall tablet is a one-tap action that anyone
 * walking past can trigger by accident, so every destructive-feeling write
 * gets a window to take it back.
 */

import { h, tappable } from '../../util/dom.js';

let host = null;

export function mountToasts(parent) {
  host = h('div.toasts', { 'aria-live': 'polite' });
  parent.appendChild(host);
  return host;
}

/**
 * Show a toast.
 *
 * @param {string} message
 * @param {object} [options]
 * @param {"info"|"error"} [options.tone]
 * @param {number} [options.duration] ms; 0 keeps it until dismissed.
 * @param {{label:string, onAction:() => void}} [options.action]
 * @returns {() => void} Dismiss function.
 */
export function toast(message, options = {}) {
  if (!host) return () => {};

  const { tone = 'info', duration = tone === 'error' ? 6000 : 3500, action } = options;

  const node = h('div.toast', { dataset: { tone } }, h('span', null, message));

  let timer = null;
  const dismiss = () => {
    if (timer) clearTimeout(timer);
    if (node.parentNode) node.remove();
  };

  if (action) {
    node.appendChild(
      tappable('button.toast-action', {
        onTap: () => {
          dismiss();
          action.onAction();
        },
      }, action.label)
    );
  }

  host.appendChild(node);
  if (duration > 0) timer = setTimeout(dismiss, duration);
  return dismiss;
}

/**
 * Report a failed write in terms of what the user tried to do, then what went
 * wrong — never a bare exception string.
 */
export function toastError(what, error) {
  const detail = error && error.message ? error.message : 'Home Assistant did not respond.';
  return toast(`${what} — ${detail}`, { tone: 'error' });
}
