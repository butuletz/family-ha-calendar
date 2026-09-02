/**
 * A very small observable store. Screens subscribe to the slices they draw and
 * re-render on change; there is no dependency tracking, just explicit notify.
 */
export function createStore(initial = {}) {
  let state = { ...initial };
  const listeners = new Set();

  return {
    get() {
      return state;
    },

    /** Merge a patch and notify. Pass a function to derive from current state. */
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      for (const fn of listeners) fn(state);
      return state;
    },

    /** Subscribe to every change. Returns an unsubscribe function. */
    subscribe(fn, { immediate = false } = {}) {
      listeners.add(fn);
      if (immediate) fn(state);
      return () => listeners.delete(fn);
    },
  };
}

/**
 * localStorage with a namespace and JSON handling. Every read is guarded —
 * a browser with site data blocked should degrade to defaults, not white-screen.
 */
export const persisted = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(`wallcal.${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },

  write(key, value) {
    try {
      localStorage.setItem(`wallcal.${key}`, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(`wallcal.${key}`);
    } catch {}
  },
};
