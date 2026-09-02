/**
 * To-do list reading and writing.
 *
 * Lists push live updates over `todo/item/subscribe`, so the Lists screen is
 * genuinely real-time and never needs polling. Mutations go through the `todo.*`
 * services, except reordering, which only exists as a WebSocket command.
 *
 * Capabilities differ per list and must be respected: `todo.shopping_list`
 * supports add/update/delete/move but *not* due dates or descriptions, and
 * sending them errors rather than being ignored.
 */

import { TODO_FEATURE } from '../config.js';
import { dayKey, haLocalDateTime } from '../util/dates.js';

/** List every to-do entity with its capabilities. */
export async function listTodoLists(conn) {
  const states = await conn.getStates();
  return states
    .filter((s) => s.entity_id.startsWith('todo.'))
    .map((s) => {
      const features = (s.attributes && s.attributes.supported_features) || 0;
      return {
        entityId: s.entity_id,
        label: (s.attributes && s.attributes.friendly_name) || s.entity_id,
        openCount: Number(s.state) || 0,
        features,
        canAdd: Boolean(features & TODO_FEATURE.CREATE_ITEM),
        canDelete: Boolean(features & TODO_FEATURE.DELETE_ITEM),
        canUpdate: Boolean(features & TODO_FEATURE.UPDATE_ITEM),
        canMove: Boolean(features & TODO_FEATURE.MOVE_ITEM),
        canSetDue: Boolean(features & (TODO_FEATURE.SET_DUE_DATE | TODO_FEATURE.SET_DUE_DATETIME)),
        canSetDueTime: Boolean(features & TODO_FEATURE.SET_DUE_DATETIME),
        canDescribe: Boolean(features & TODO_FEATURE.SET_DESCRIPTION),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Subscribe to a list's items. The callback fires immediately with the current
 * contents and again on every change made anywhere in Home Assistant.
 *
 * @returns {Promise<() => Promise<void>>} Unsubscribe function.
 */
export function subscribeItems(conn, entityId, callback) {
  return conn.subscribe({ type: 'todo/item/subscribe', entity_id: entityId }, (event) => {
    callback((event.items || []).map(normaliseItem));
  });
}

/** Convert a Home Assistant to-do item into the app's shape. */
export function normaliseItem(raw) {
  const due = raw.due || null;
  const hasTime = Boolean(due && due.includes('T'));

  return {
    uid: raw.uid,
    summary: raw.summary || '',
    description: raw.description || '',
    status: raw.status || 'needs_action',
    done: raw.status === 'completed',
    due,
    dueKey: due ? (hasTime ? dayKey(new Date(due)) : due) : null,
    dueHasTime: hasTime,
    dueDate: due ? (hasTime ? new Date(due) : null) : null,
  };
}

/**
 * Sort open items by due date (soonest first, undated last), keeping the
 * list's own order as the tiebreak so manual reordering still means something.
 */
export function sortItems(items) {
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  open.sort((a, b) => {
    if (a.dueKey && b.dueKey) return a.dueKey.localeCompare(b.dueKey);
    if (a.dueKey) return -1;
    if (b.dueKey) return 1;
    return 0;
  });

  return { open, done };
}

/* ── Writes ─────────────────────────────────────────────────────────────── */

/**
 * Add an item. Due date and description are only sent when the list supports
 * them; passing them to a list that doesn't is an error, not a no-op.
 *
 * @param {object} list A list from `listTodoLists`.
 * @param {{summary:string, dueKey?:string, dueDate?:Date, description?:string}} form
 */
export function addItem(conn, list, form) {
  const data = { item: form.summary };

  if (form.description && list.canDescribe) data.description = form.description;

  if (list.canSetDue) {
    if (form.dueDate && list.canSetDueTime) {
      data.due_datetime = haLocalDateTime(form.dueDate);
    } else if (form.dueKey) {
      data.due_date = form.dueKey;
    }
  }

  return conn.callService('todo', 'add_item', data, { entity_id: list.entityId });
}

/**
 * Update an item. Home Assistant matches on `item` by uid first, then summary.
 * @param {object} patch { rename?, status?, dueKey?, dueDate?, clearDue?, description? }
 */
export function updateItem(conn, list, item, patch) {
  const data = { item: item.uid };

  if (patch.rename !== undefined) data.rename = patch.rename;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.description !== undefined && list.canDescribe) data.description = patch.description;

  if (list.canSetDue) {
    if (patch.clearDue) {
      data.due_date = null;
    } else if (patch.dueDate && list.canSetDueTime) {
      data.due_datetime = haLocalDateTime(patch.dueDate);
    } else if (patch.dueKey) {
      data.due_date = patch.dueKey;
    }
  }

  return conn.callService('todo', 'update_item', data, { entity_id: list.entityId });
}

/** Mark an item done or not done. */
export function setDone(conn, list, item, done) {
  return updateItem(conn, list, item, { status: done ? 'completed' : 'needs_action' });
}

export function removeItem(conn, list, item) {
  return conn.callService('todo', 'remove_item', { item: item.uid }, { entity_id: list.entityId });
}

export function removeCompleted(conn, list) {
  return conn.callService('todo', 'remove_completed_items', {}, { entity_id: list.entityId });
}

/**
 * Reorder an item. WebSocket only — there is no `todo.move_item` service.
 * @param {string|null} previousUid The item to place it after; null moves to the top.
 */
export function moveItem(conn, list, item, previousUid) {
  return conn.sendMessage({
    type: 'todo/item/move',
    entity_id: list.entityId,
    uid: item.uid,
    ...(previousUid ? { previous_uid: previousUid } : {}),
  });
}
