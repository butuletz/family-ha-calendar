/**
 * Settings, defaults, and the calendar source registry.
 *
 * A "source" is a calendar entity plus how this app should treat it. The three
 * kinds behave very differently, which is why classification lives here rather
 * than being inferred at each call site:
 *
 *   events — a normal calendar. Shown in the agenda, month grid and Today.
 *   waste  — a kerbside collection schedule. All-day events whose summary is
 *            the address followed by a fraction name. Rendered as a banner.
 *   park   — opening hours. One long event every single day, which would bury
 *            a family agenda, so hidden unless asked for.
 *
 * Which is which is chosen in Settings. It used to be guessed from the event
 * shape; that is gone, because a wrong guess is invisible to the person it
 * confuses and the choice takes seconds to make once.
 */

import { persisted } from './util/store.js';

/** Colours assigned to calendars that have no explicit setting yet. */
export const PALETTE = [
  '#2F5FD8', // blue
  '#0E8A6E', // teal
  '#7A3FBF', // violet
  '#C2571E', // rust
  '#0F7FA8', // cyan
  '#A32F6B', // magenta
];

/** Waste collections get one colour regardless of where they sort. */
export const WASTE_COLOR = '#A96A12';
/** Recyclagepark opening hours are background information; keep them grey. */
export const PARK_COLOR = '#6B7280';

/**
 * Defaults applied once a calendar has been given a type in Settings. Nothing
 * about a particular household is baked in, and nothing is guessed.
 */
const KIND_DEFAULTS = {
  events: { hidden: false, remindDaysBefore: 0 },
  // The calendar carries the collection date, but the truck comes early in the
  // morning, so the bins have to go out the evening before.
  waste: { hidden: false, remindDaysBefore: 1, color: WASTE_COLOR },
  // These publish an opening-hours event every single day, which would bury a
  // family agenda.
  park: { hidden: true, remindDaysBefore: 0, color: PARK_COLOR },
};

/** Home Assistant calendar entity feature bits. */
export const CAL_FEATURE = {
  CREATE_EVENT: 1,
  DELETE_EVENT: 2,
  UPDATE_EVENT: 4,
};

/** Home Assistant to-do entity feature bits. */
export const TODO_FEATURE = {
  CREATE_ITEM: 1,
  DELETE_ITEM: 2,
  UPDATE_ITEM: 4,
  MOVE_ITEM: 8,
  SET_DUE_DATE: 16,
  SET_DUE_DATETIME: 32,
  SET_DESCRIPTION: 64,
};

export const DEFAULT_SETTINGS = {
  /** Per-entity overrides: { [entityId]: { color, kind, hidden, label } } */
  sources: {},
  /** Per-list overrides: { [entityId]: { hidden } } */
  lists: {},
  /** Which screen the app opens on. */
  startScreen: 'today',
  /** 'auto' dims between nightStart and nightEnd; 'on'/'off' force it. */
  nightMode: 'auto',
  nightStart: 22,
  nightEnd: 7,
  /** Keep the display awake via the Screen Wake Lock API. */
  keepAwake: true,
  /** Calendar filter chips the user has switched off, by entity id. */
  mutedSources: [],
};

/** The key these settings live under in Home Assistant's per-user storage. */
export const SETTINGS_KEY = 'family_calendar';

/**
 * The last settings this browser saw, read synchronously so the panel can paint
 * immediately. Home Assistant holds the real copy; `fetchSettings` reconciles.
 */
export function cachedSettings() {
  return { ...DEFAULT_SETTINGS, ...persisted.read('settings', {}) };
}

/**
 * The user's settings from Home Assistant, which is what makes them the same on
 * every device that person signs in from.
 *
 * Falls back to the local cache when the connection is not ready — a panel that
 * opens with the wrong colours beats a panel that does not open.
 *
 * @param {import('./ha/bridge.js').HassBridge} conn
 */
export async function fetchSettings(conn) {
  try {
    const remote = await conn.getUserData(SETTINGS_KEY);
    if (!remote) return cachedSettings();

    const merged = { ...DEFAULT_SETTINGS, ...remote };
    persisted.write('settings', merged);
    return merged;
  } catch {
    return cachedSettings();
  }
}

/**
 * Save to Home Assistant, and to the local cache so the next launch paints
 * correctly before the round trip completes.
 */
export function saveSettings(conn, settings) {
  persisted.write('settings', settings);
  if (!conn) return Promise.resolve();
  return conn.setUserData(SETTINGS_KEY, settings).catch((err) => {
    console.error('Could not save settings to Home Assistant', err);
  });
}

/** What a calendar can be told to be, in Settings. */
export const KINDS = ['events', 'waste', 'park'];

/**
 * Build the registry the UI reads from Home Assistant's calendar list.
 *
 * Every calendar starts as an ordinary one and stays that way until someone
 * says otherwise in Settings. Guessing was tried and dropped: the signals that
 * separate a collection calendar from a holiday calendar are circumstantial,
 * a wrong guess is baffling to a user who cannot see why, and choosing the
 * right type once per calendar takes seconds. An ordinary calendar showing
 * collections as plain rows is untidy, never broken.
 *
 * @param {Array<{entity_id:string, name:string, supportedFeatures:number}>} entities
 * @param {object} settings
 * @returns {Record<string, object>} Registry keyed by entity id.
 */
export function buildSourceRegistry(entities, settings) {
  const registry = {};
  let paletteIndex = 0;

  for (const entity of entities) {
    const id = entity.entity_id;
    const override = (settings.sources && settings.sources[id]) || {};

    const kind = KINDS.includes(override.kind) ? override.kind : 'events';
    const defaults = KIND_DEFAULTS[kind] || KIND_DEFAULTS.events;

    // Ordinary calendars are the ones people tell apart at a glance, so they
    // get the palette; waste and park hours have a fixed colour each.
    const color =
      override.color || defaults.color || PALETTE[paletteIndex++ % PALETTE.length];

    registry[id] = {
      entityId: id,
      label: override.label || entity.name || id,
      color,
      kind,
      remindDaysBefore:
        override.remindDaysBefore !== undefined
          ? override.remindDaysBefore
          : defaults.remindDaysBefore,
      // Recycle! repeats the calendar's own name at the front of every event
      // summary, so the entity name is exactly the prefix to strip.
      stripPrefix: entity.name || null,
      hidden: override.hidden !== undefined ? override.hidden : defaults.hidden,
      writable: Boolean(entity.supportedFeatures & CAL_FEATURE.CREATE_EVENT),
      canUpdate: Boolean(entity.supportedFeatures & CAL_FEATURE.UPDATE_EVENT),
      canDelete: Boolean(entity.supportedFeatures & CAL_FEATURE.DELETE_EVENT),
      supportedFeatures: entity.supportedFeatures,
    };
  }

  // Recycle! names a collection calendar after the address it covers, which is
  // a poor chip label. With exactly one there is no ambiguity to preserve.
  const collections = Object.values(registry).filter((s) => s.kind === 'waste');
  if (collections.length === 1) {
    const only = collections[0];
    const override = (settings.sources && settings.sources[only.entityId]) || {};
    if (!override.label) only.label = 'Waste';
  }

  return registry;
}

/** Sources that draw as ordinary events, respecting hidden and muted state. */
export function visibleEventSources(registry, settings) {
  const muted = new Set(settings.mutedSources || []);
  return Object.values(registry).filter(
    (s) => s.kind === 'events' && !s.hidden && !muted.has(s.entityId)
  );
}

/**
 * Every source the filter chips should offer (ignores muted, respects hidden).
 * Sorted so the chips keep a stable position between renders — a chip that
 * moves under a finger is a chip that toggles the wrong calendar.
 */
export function filterableSources(registry) {
  const order = { events: 0, waste: 1, park: 2 };
  return Object.values(registry)
    .filter((s) => !s.hidden)
    .sort((a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label));
}

/** The waste sources, if any are configured and visible. */
export function wasteSources(registry) {
  return Object.values(registry).filter((s) => s.kind === 'waste' && !s.hidden);
}
