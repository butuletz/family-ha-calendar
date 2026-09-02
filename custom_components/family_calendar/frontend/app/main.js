/**
 * Application entry point: connection lifecycle, data loading, routing, and
 * the actions the screens call into.
 */

import { HassBridge } from './ha/bridge.js';
import {
  cachedSettings,
  fetchSettings,
  saveSettings,
  buildSourceRegistry,
  filterableSources,
  wasteSources,
  PALETTE,
  WASTE_COLOR,
  PARK_COLOR,
} from './config.js';
import { createStore } from './util/store.js';
import { h, render } from './util/dom.js';
import { setTimeZone, todayKey, addDays } from './util/dates.js';
import { listCalendars, fetchEvents, createEvent, updateEvent, deleteEvent } from './data/calendars.js';
import {
  listTodoLists,
  subscribeItems,
  addItem,
  updateItem,
  setDone,
  removeItem,
  removeCompleted,
} from './data/todos.js';
import { groupCollections } from './data/waste.js';

import { topbar, filterBar, bottomNav, offlineBanner, fab } from './ui/components/shell.js';
import { mountToasts, toast, toastError } from './ui/components/toast.js';
import {
  closeSheet,
  confirmSheet,
  recurrenceSheet,
  setSheetHost,
} from './ui/components/sheet.js';
import {
  eventSheet,
  todoSheet,
  eventDetailSheet,
  todoDetailSheet,
  colorSheet,
  renameSheet,
} from './ui/components/forms.js';
import { openSettings } from './ui/screens/settings.js';
import { createTodayScreen } from './ui/screens/today.js';
import { createAgendaScreen } from './ui/screens/agenda.js';
import { createMonthScreen } from './ui/screens/month.js';
import { createListsScreen } from './ui/screens/lists.js';

/** How far either side of today events are loaded on first paint. */
const WINDOW_BACK = 7;
const WINDOW_FORWARD = 75;
/** Floor for refreshing calendars, in case a state change is missed. */
const REFRESH_MS = 10 * 60 * 1000;

/** The element the app renders into; supplied by the panel that mounts us. */
let root = null;

const store = createStore({
  status: 'connecting',
  events: [],
  eventsLoaded: false,
  loadingEvents: false,
  collections: [],
  lists: [],
  todoItems: {},
  windowFrom: null,
  windowTo: null,
});

// Painted from the local cache immediately, then reconciled with Home
// Assistant's per-user copy once the panel mounts.
let settings = cachedSettings();
let registry = {};
/** The raw calendar list, kept so the registry can be rebuilt after classification. */
let calendarEntities = [];
let conn = null;
let screens = {};
let current = null;
let unsubscribers = [];
let refreshTimer = null;
let refreshDebounce = null;
let wakeLock = null;

let nightTimer = null;
let clockTimer = null;
let offStatus = null;

/* ── Mounting ────────────────────────────────────────────────────────────── */

/**
 * Start the app inside a host element.
 *
 * There is no boot sequence, no login and no connection to establish: Home
 * Assistant has already done all of that and hands us `hass`. This just wires
 * the shell up and starts loading data.
 *
 * @param {object} options
 * @param {object} options.hass Home Assistant's frontend object.
 * @param {HTMLElement} options.root Element to render into.
 * @returns {{setHass: (hass:object) => void, destroy: () => void}}
 */
export function createApp({ hass, root: container }) {
  root = container;

  setSheetHost(root);
  root.classList.add('kiosk');

  conn = new HassBridge(hass);
  setTimeZone(conn.timeZone);

  buildChrome();

  // Home Assistant holds the authoritative copy, so a person's colours, hidden
  // calendars and calendar types are the same on every device they sign in
  // from. Fetched after the first paint rather than before it: waiting on a
  // round trip to draw anything would be a worse trade.
  fetchSettings(conn).then((loaded) => {
    settings = loaded;
    applyNightMode();
    if (calendarEntities.length) registry = buildSourceRegistry(calendarEntities, settings);
    refreshEvents();
    updateAll();
  });

  applyNightMode();
  nightTimer = setInterval(applyNightMode, 60 * 1000);

  offStatus = conn.onStatus((status) => {
    store.set({ status });
    shell.top.setStatus(status);
    shell.offline.update(status);
    shell.body.classList.toggle('stale', status !== 'connected');
  });

  document.addEventListener('visibilitychange', onVisible);

  loadEverything();

  return {
    setHass(next) {
      if (conn) conn.update(next);
    },
    destroy: teardown,
  };
}

/**
 * Home Assistant keeps panels alive between visits, but it can also drop them.
 * Everything started in `createApp` is undone here so a re-mount does not leave
 * a second set of subscriptions and timers running.
 */
function teardown() {
  closeSheet();

  for (const off of unsubscribers) {
    try {
      off();
    } catch {}
  }
  unsubscribers = [];

  for (const timer of [refreshTimer, nightTimer, clockTimer]) {
    if (timer) clearInterval(timer);
  }
  refreshTimer = nightTimer = clockTimer = null;

  if (refreshDebounce) clearTimeout(refreshDebounce);
  refreshDebounce = null;

  if (offStatus) offStatus();
  offStatus = null;

  document.removeEventListener('visibilitychange', onVisible);
  releaseWakeLock();

  conn = null;
  current = null;
  screens = {};
  if (root) render(root);
}

function onVisible() {
  if (document.visibilityState !== 'visible') return;
  // A backgrounded panel drifts: catch the clock up and re-take the wake lock.
  if (shell.top) shell.top.tick();
  if (!wakeLock) requestWakeLock();
  if (conn && conn.status === 'connected') refreshEvents();
}

/* ── Chrome ──────────────────────────────────────────────────────────────── */

const shell = {};

function buildChrome() {
  shell.top = topbar({ onOpenSettings: () => openSettingsSheet() });
  shell.filters = filterBar({ onToggle: toggleSource, onRecolor: recolorSource });
  shell.offline = offlineBanner();
  shell.nav = bottomNav(navigate);
  shell.screenSlot = h('div.screen-slot');
  shell.fabHost = h('div');
  // The floating button and the toasts live inside the screen area rather than
  // beside the navigation, so they sit above it whatever height it takes --
  // which changes with a phone's gesture inset.
  shell.body = h('div.screen-host', null, shell.screenSlot, shell.fabHost);

  render(
    root,
    shell.top.element,
    shell.offline.element,
    shell.filters.element,
    shell.body,
    shell.nav.element
  );
  mountToasts(shell.body);

  screens = {
    today: createTodayScreen(ctx),
    agenda: createAgendaScreen(ctx),
    month: createMonthScreen(ctx),
    lists: createListsScreen(ctx),
  };

  shell.top.tick();
  clockTimer = setInterval(() => shell.top.tick(), 10 * 1000);

  navigate(settings.startScreen in screens ? settings.startScreen : 'today');
  requestWakeLock();
}

function navigate(id) {
  const screen = screens[id];
  if (!screen) return;

  current = screen;
  render(shell.screenSlot, screen.element);
  shell.nav.setActive(id);

  if (screen.onEnter) screen.onEnter();
  screen.update();
  refreshChrome();
}

/** Re-derive the header, filter bar and floating button for the active screen. */
function refreshChrome() {
  if (!current) return;

  const title = current.title();
  shell.top.setTitle(title.main, title.sub);
  shell.top.setClockSize(current.smallClock);

  // Month navigation lives beside the heading rather than in the scroll.
  const right = shell.top.element.querySelector('.topbar-right');
  const existing = right.querySelector('.month-nav');
  if (existing) existing.remove();
  if (title.controls) {
    right.appendChild(h('div.month-nav', null, ...title.controls));
  }

  if (current.showFilters) {
    shell.filters.element.hidden = false;
    shell.filters.update(filterableSources(registry), new Set(settings.mutedSources || []));
  } else {
    shell.filters.element.hidden = true;
  }

  const spec = current.fab ? current.fab() : null;
  render(shell.fabHost, spec ? fab(spec.onTap, spec.label) : null);
}

/* ── Data ────────────────────────────────────────────────────────────────── */

async function loadEverything() {
  try {
    calendarEntities = await listCalendars(conn);
    registry = buildSourceRegistry(calendarEntities, settings);

    const from = addDays(todayKey(), -WINDOW_BACK);
    const to = addDays(todayKey(), WINDOW_FORWARD);
    store.set({ windowFrom: from, windowTo: to });

    await Promise.all([refreshEvents(), loadLists()]);
    await watchCalendars();

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshEvents, REFRESH_MS);
  } catch (err) {
    toastError('Could not load your calendars', err);
  }
}

async function refreshEvents() {
  if (!conn || conn.status !== 'connected') return;

  const { windowFrom, windowTo } = store.get();
  if (!windowFrom) return;

  const ids = Object.values(registry)
    .filter((s) => !s.hidden || s.kind === 'waste')
    .map((s) => s.entityId);

  store.set({ loadingEvents: true });

  try {
    const events = await fetchEvents(conn, ids, windowFrom, windowTo);
    const waste = new Set(wasteSources(registry).map((s) => s.entityId));
    const collections = groupCollections(
      events.filter((ev) => waste.has(ev.entityId)),
      registry
    );

    store.set({ events, collections, eventsLoaded: true, loadingEvents: false });
    updateAll();
  } catch (err) {
    store.set({ loadingEvents: false });
    console.error('Failed to refresh events', err);
  }
}

/** Widen the loaded window when the month view walks outside it. */
function ensureRange(fromKey, toKey) {
  const { windowFrom, windowTo } = store.get();
  const nextFrom = !windowFrom || fromKey < windowFrom ? fromKey : windowFrom;
  const nextTo = !windowTo || toKey > windowTo ? toKey : windowTo;

  if (nextFrom !== windowFrom || nextTo !== windowTo) {
    store.set({ windowFrom: nextFrom, windowTo: nextTo });
    refreshEvents();
  }
}

/** Refetch calendars when Home Assistant reports one of them changed. */
async function watchCalendars() {
  const ids = Object.keys(registry);
  if (!ids.length) return;

  try {
    const off = await conn.subscribe(
      { type: 'subscribe_trigger', trigger: { platform: 'state', entity_id: ids } },
      () => {
        // A calendar entity flips state when an event starts or ends, which is
        // also the moment its event list may have changed. Debounce so a burst
        // of transitions costs one fetch.
        if (refreshDebounce) clearTimeout(refreshDebounce);
        refreshDebounce = setTimeout(refreshEvents, 1500);
      }
    );
    unsubscribers.push(off);
  } catch (err) {
    // Not fatal: the interval refresh still keeps things current.
    console.warn('Could not subscribe to calendar changes; falling back to polling.', err);
  }
}

async function loadLists() {
  try {
    const lists = await listTodoLists(conn);
    store.set({ lists });

    for (const list of lists) {
      const off = await subscribeItems(conn, list.entityId, (items) => {
        store.set((state) => ({
          todoItems: { ...state.todoItems, [list.entityId]: items },
        }));
        updateAll();
      });
      unsubscribers.push(off);
    }
  } catch (err) {
    toastError('Could not load your to-do lists', err);
  }
}

function updateAll() {
  if (current) {
    current.update();
    refreshChrome();
  }
}

/* ── Settings mutations ──────────────────────────────────────────────────── */

function persist(patch) {
  settings = { ...settings, ...patch };
  saveSettings(conn, settings);
}

function toggleSource(entityId) {
  const muted = new Set(settings.mutedSources || []);
  if (muted.has(entityId)) muted.delete(entityId);
  else muted.add(entityId);
  persist({ mutedSources: [...muted] });
  updateAll();
}

/** Long press on a filter chip: pick a new colour for that calendar. */
function recolorSource(entityId) {
  const source = registry[entityId];
  if (!source) return;

  // The palette first, then the colour this kind would have used by default, so
  // there is always a way back to the original without remembering the hex.
  const suggested = [...PALETTE];
  for (const extra of [WASTE_COLOR, PARK_COLOR]) {
    if (!suggested.includes(extra)) suggested.push(extra);
  }

  colorSheet({
    source,
    palette: suggested,
    onPick: (color) => {
      updateSource(entityId, { color });
      toast(`${source.label} recoloured`);
    },
  });
}

function updateSource(entityId, patch) {
  const sources = { ...(settings.sources || {}) };
  sources[entityId] = { ...(sources[entityId] || {}), ...patch };
  persist({ sources });

  registry = {
    ...registry,
    [entityId]: { ...registry[entityId], ...patch },
  };

  // Un-hiding a source, or changing what it is, needs events the last fetch
  // may have skipped -- and a new kind regroups them.
  if (patch.hidden === false || patch.kind) refreshEvents();
  else updateAll();
}

/**
 * Rename a to-do list. The list's name is its entity name, so this writes to
 * the entity registry -- which Home Assistant only lets administrators do.
 */
function renameList(list) {
  renameSheet({
    title: 'Rename list',
    label: 'List name',
    value: list.label,
    hint: 'This renames the entity in Home Assistant, so the new name shows everywhere, not just here.',
    onSave: async (name) => {
      try {
        await conn.renameEntity(list.entityId, name);
      } catch (err) {
        const message = (err && err.message) || '';
        throw new Error(
          /unauthorized|not authorized|admin/i.test(message)
            ? 'Renaming a list needs a Home Assistant administrator account.'
            : message || 'Home Assistant refused the rename.'
        );
      }

      // hass.states catches up on its own, but the tab should change now.
      store.set((state) => ({
        lists: (state.lists || []).map((l) =>
          l.entityId === list.entityId ? { ...l, label: name } : l
        ),
      }));
      toast(`Renamed to ${name}`);
      updateAll();
    },
  });
}

function updateList(entityId, patch) {
  const lists = { ...(settings.lists || {}) };
  lists[entityId] = { ...(lists[entityId] || {}), ...patch };
  persist({ lists });
  updateAll();
}

function openSettingsSheet() {
  openSettings(ctx);
}

/* ── Night mode and wake lock ────────────────────────────────────────────── */

function applyNightMode() {
  const mode = settings.nightMode || 'auto';
  let night;

  if (mode === 'on') {
    night = true;
  } else if (mode === 'off') {
    night = false;
  } else {
    const hour = new Date().getHours();
    const { nightStart = 22, nightEnd = 7 } = settings;
    night = nightStart > nightEnd ? hour >= nightStart || hour < nightEnd : hour >= nightStart && hour < nightEnd;
  }

  // Scoped to our own root: this runs inside Home Assistant's page, and
  // dimming their whole frontend would be rude.
  if (root) root.classList.toggle('night', night);
}

function releaseWakeLock() {
  if (!wakeLock) return;
  try {
    wakeLock.release();
  } catch {
    // Already gone; nothing to do.
  }
  wakeLock = null;
}

async function requestWakeLock() {
  if (!settings.keepAwake || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch {
    // Denied or unsupported; the tablet's own display timeout takes over.
  }
}

/* ── Actions the screens call ────────────────────────────────────────────── */

const actions = {
  ensureRange,

  newEvent(dayKey) {
    eventSheet({
      event: null,
      sources: Object.values(registry).filter((s) => s.writable),
      defaultDay: dayKey,
      onSave: async (form) => {
        await createEvent(conn, form);
        toast('Event added');
        await refreshEvents();
      },
    });
  },

  /**
   * One tap always opens the detail sheet, never a form — the same on both
   * screens, and the same with a finger or a mouse. Editing is an explicit
   * button inside it, so brushing a row on a wall display cannot open
   * something that rewrites the family calendar. Read-only sources get the
   * same sheet, without the Edit and Delete buttons.
   */
  openEvent(event) {
    const source = registry[event.entityId];
    if (!source) return;

    eventDetailSheet(event, source, {
      onEdit: (target) => actions.editEvent(target),
      onDelete: (target) => actions.deleteEvent(target),
    });
  },

  openTodo(list, item) {
    todoDetailSheet(item, list, {
      onEdit: (target) => actions.editTodo(list, target),
      onDelete: (target) => actions.deleteTodo(list, target),
      onToggle: (target, done) => actions.toggleTodo(list, target, done),
    });
  },

  editEvent(event) {
    const source = registry[event.entityId];
    if (!source || !source.canUpdate || !event.editable) return;

    eventSheet({
      event,
      sources: Object.values(registry).filter((s) => s.writable),
      onSave: async (form, original) => {
        const apply = async (range) => {
          await updateEvent(conn, original, form, range);
          toast('Event updated');
          await refreshEvents();
        };

        if (original.rrule || original.recurrenceId) {
          closeSheet();
          recurrenceSheet({
            title: 'Update repeating event',
            onPick: (range) => apply(range).catch((err) => toastError('Could not update the event', err)),
          });
          return;
        }
        await apply('');
      },
      onDelete: (target) => actions.deleteEvent(target),
    });
  },

  deleteEvent(event) {
    const remove = async (range) => {
      try {
        await deleteEvent(conn, event, range);
        toast('Event deleted');
        await refreshEvents();
      } catch (err) {
        toastError('Could not delete the event', err);
      }
    };

    if (event.rrule || event.recurrenceId) {
      recurrenceSheet({ title: 'Delete repeating event', onPick: remove });
      return;
    }

    confirmSheet({
      title: 'Delete this event?',
      message: `"${event.summary}" will be removed from ${registry[event.entityId].label}.`,
      onConfirm: () => remove(''),
    });
  },

  async toggleTodo(list, item, done) {
    // Optimistic: the row flips now, and the live subscription confirms it.
    patchItem(list.entityId, item.uid, { done, status: done ? 'completed' : 'needs_action' });
    updateAll();

    try {
      await setDone(conn, list, item, done);
      if (done) {
        toast(`Done: ${item.summary}`, {
          action: {
            label: 'Undo',
            onAction: () => actions.toggleTodo(list, item, false),
          },
        });
      }
    } catch (err) {
      patchItem(list.entityId, item.uid, { done: !done, status: !done ? 'completed' : 'needs_action' });
      updateAll();
      toastError('Could not update the task', err);
    }
  },

  newTodo(list) {
    todoSheet({
      item: null,
      list,
      onSave: async (form) => {
        await addItem(conn, list, form);
        toast('Task added');
      },
    });
  },

  editTodo(list, item) {
    todoSheet({
      item,
      list,
      onSave: async (form, original) => {
        await updateItem(conn, list, original, {
          rename: form.summary,
          description: form.description,
          dueKey: form.dueKey,
          dueDate: form.dueDate,
          clearDue: form.clearDue,
        });
        toast('Task updated');
      },
      onDelete: (target) => actions.deleteTodo(list, target),
    });
  },

  deleteTodo(list, item) {
    confirmSheet({
      title: 'Delete this task?',
      message: `"${item.summary}" will be removed from ${list.label}.`,
      onConfirm: async () => {
        try {
          await removeItem(conn, list, item);
          toast('Task deleted');
        } catch (err) {
          toastError('Could not delete the task', err);
        }
      },
    });
  },

  clearCompleted(list) {
    confirmSheet({
      title: 'Clear completed tasks?',
      message: `Every finished task in ${list.label} will be removed. This cannot be undone.`,
      confirmLabel: 'Clear',
      onConfirm: async () => {
        try {
          await removeCompleted(conn, list);
          toast('Completed tasks cleared');
        } catch (err) {
          toastError('Could not clear the list', err);
        }
      },
    });
  },

  /**
   * Turn every ordinary calendar back on. Reachable from the empty state,
   * because a filter switched off on one screen otherwise empties another
   * screen that has no control to explain it.
   */
  showAllCalendars() {
    const sources = { ...(settings.sources || {}) };

    for (const source of Object.values(registry)) {
      if (source.kind !== 'events') continue;
      sources[source.entityId] = { ...(sources[source.entityId] || {}), hidden: false };
      registry[source.entityId] = { ...source, hidden: false };
    }

    persist({ sources, mutedSources: [] });
    refreshEvents();
    updateAll();
  },

  updateSource,
  updateList,
  renameList,
  updateSettings(patch) {
    persist(patch);
    applyNightMode();
    if (patch.keepAwake) requestWakeLock();
    updateAll();
  },
};

/** Apply a local change to one to-do item, for optimistic updates. */
function patchItem(entityId, uid, patch) {
  store.set((state) => {
    const items = state.todoItems[entityId];
    if (!items) return {};
    return {
      todoItems: {
        ...state.todoItems,
        [entityId]: items.map((i) => (i.uid === uid ? { ...i, ...patch } : i)),
      },
    };
  });
}

/* ── The context every screen receives ───────────────────────────────────── */

const ctx = {
  state: () => store.get(),
  settings: () => settings,
  registry: () => registry,
  conn: () => conn,
  actions,
  refreshChrome,

  /** Is this calendar drawn as an ordinary event, given hidden and muted state? */
  isVisibleEventSource(entityId) {
    const source = registry[entityId];
    if (!source || source.kind !== 'events' || source.hidden) return false;
    return !(settings.mutedSources || []).includes(entityId);
  },

  /** Is this calendar drawn at all (events, waste and park alike)? */
  isVisibleSource(entityId) {
    const source = registry[entityId];
    if (!source || source.hidden) return false;
    return !(settings.mutedSources || []).includes(entityId);
  },

  isHiddenList(entityId) {
    const entry = (settings.lists || {})[entityId];
    return Boolean(entry && entry.hidden);
  },

  /** Ordinary calendars currently switched off, whether hidden or muted. */
  silencedEventSources() {
    const muted = new Set(settings.mutedSources || []);
    return Object.values(registry).filter(
      (s) => s.kind === 'events' && (s.hidden || muted.has(s.entityId))
    );
  },
};

