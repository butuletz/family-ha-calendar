/**
 * Lists — the to-do screen.
 *
 * Items arrive over a live subscription, so anything ticked off on a phone
 * elsewhere in the house updates here without a refresh.
 */

import { h, tappable, keepScroll } from '../../util/dom.js';
import { todoRow, sectionHeading, emptyState, skeletonRows } from '../components/rows.js';
import { sortItems } from '../../data/todos.js';

export function createListsScreen(ctx) {
  const element = h('div.screen-body');
  let activeListId = null;

  function lists() {
    return (ctx.state().lists || []).filter((l) => !ctx.isHiddenList(l.entityId));
  }

  function activeList() {
    const all = lists();
    if (!all.length) return null;
    return all.find((l) => l.entityId === activeListId) || all[0];
  }

  const screen = {
    id: 'lists',
    element,
    showFilters: false,
    smallClock: true,

    fab: () => {
      const list = activeList();
      if (!list || !list.canAdd) return null;
      return {
        label: `Add to ${list.label}`,
        onTap: () => ctx.actions.newTodo(list),
      };
    },

    title: () => {
      const all = lists();
      const open = all.reduce((total, list) => {
        const items = (ctx.state().todoItems || {})[list.entityId] || [];
        return total + items.filter((i) => !i.done).length;
      }, 0);
      return {
        main: 'Lists',
        sub: open === 0 ? 'All clear' : `${open} open`,
      };
    },

    update() {
      keepScroll(element, () => build());
    },
  };

  function build() {
    const state = ctx.state();
    const all = lists();

    if (!all.length) {
      return emptyState(
        '✓',
        'No to-do lists',
        'Add a Local To-do or Shopping List integration in Home Assistant and it will appear here.'
      );
    }

    const list = activeList();
    const nodes = [];

    /* List switcher ------------------------------------------------------- */
    if (all.length > 1) {
      nodes.push(
        h(
          'div.segmented',
          { role: 'tablist' },
          ...all.map((entry) =>
            tappable(
              'button',
              {
                role: 'tab',
                'aria-selected': String(entry.entityId === list.entityId),
                onTap: () => {
                  activeListId = entry.entityId;
                  screen.update();
                  ctx.refreshChrome();
                },
              },
              entry.label
            )
          )
        )
      );
    }

    const items = (state.todoItems || {})[list.entityId];

    if (!items) {
      nodes.push(...skeletonRows(4));
      return nodes;
    }

    const { open, done } = sortItems(items);

    if (!open.length && !done.length) {
      nodes.push(
        emptyState('✓', `${list.label} is empty`, list.canAdd ? 'Tap + to add the first task.' : null)
      );
      return nodes;
    }

    for (const item of open) {
      nodes.push(
        todoRow(item, list, {
          onOpen: (i) => ctx.actions.openTodo(list, i),
          onToggle: (i, isDone) => ctx.actions.toggleTodo(list, i, isDone),
          onEdit: (i) => ctx.actions.editTodo(list, i),
        })
      );
    }

    if (!open.length) {
      nodes.push(
        h(
          'div',
          { style: { padding: 'var(--s-5) 0', color: 'var(--ink-3)', fontSize: 'var(--t-md)' } },
          'Everything here is done.'
        )
      );
    }

    /* Completed ----------------------------------------------------------- */
    if (done.length) {
      const heading = h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 'var(--s-3)' } },
        sectionHeading(`Completed · ${done.length}`)
      );

      if (list.canDelete) {
        heading.appendChild(
          tappable(
            'button',
            {
              style: {
                fontSize: 'var(--t-xs)',
                fontWeight: '700',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--ink-3)',
                padding: 'var(--s-2) var(--s-3)',
                flex: 'none',
              },
              onTap: () => ctx.actions.clearCompleted(list),
            },
            'Clear'
          )
        );
      }

      nodes.push(heading);

      for (const item of done) {
        nodes.push(
          todoRow(item, list, {
            onToggle: (i, isDone) => ctx.actions.toggleTodo(list, i, isDone),
            onEdit: (i) => ctx.actions.editTodo(list, i),
          })
        );
      }
    }

    return nodes;
  }

  return screen;
}
