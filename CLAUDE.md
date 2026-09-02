# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Home Assistant **custom integration** that registers a full-screen sidebar
panel showing the household's calendars and to-do lists. Built for a
wall-mounted tablet in portrait (800 × 1280 CSS px).

It runs *inside* Home Assistant's frontend, which hands the panel an
authenticated `hass` object. There is no login, no token, and no connection
management anywhere in this codebase — that was all removed when it stopped
being a standalone page.

## Commands

There is **no build, no bundler, no package manager, and no test runner**. Node
is not installed on this machine and the project is designed not to need it.

```powershell
.\deploy.ps1 -Stage                          # gather into _deploy\, open Explorer
.\deploy.ps1 -Destination \\192.168.1.50\config\custom_components
.\serve.ps1                                  # http://localhost:8080 for the dev pages
```

Deploying is: copy `custom_components/family_calendar` to the server, restart
Home Assistant, add it from Settings > Devices & services. No version bumping
for the frontend — see "caching" below.

The repo is installable through HACS as a custom repository. That means the
`custom_components/family_calendar/` layout, `manifest.json`, `hacs.json` and
`LICENSE` are load-bearing, and a **release is a git tag plus a bumped
`version` in manifest.json** — HACS compares tags, not commits. The `Validate`
workflow runs hassfest and the HACS action on every push; keep it green.

Three pages stand in for a test runner, none of which connect to anything:

- **`selftest.html`** — logic assertions over `util/dates.js`, `data/`,
  `config.js` and `util/dom.js`. Add cases here rather than reaching for a
  framework.
- **`panelcheck.html`** — mounts the real `<family-calendar-panel>` against a
  stubbed `hass`. **Run this after touching `panel.js`, `app/main.js` or
  `app/ha/bridge.js`** — it is the only way to exercise the panel, the shadow
  DOM and the bridge without a running Home Assistant.
- **`preview.html`** — all four screens at true 800 × 1280. `?night=1`,
  `?muted=1`, `?waste=collected`.

Check them headlessly, but note two traps:

- **`--virtual-time-budget` fast-forwards timers without waiting for I/O or
  settling CSS animations.** Fine for `preview.html`. It reports false failures
  for anything with a live connection (`readyState=0`, promises that never
  settle) *and* for `panelcheck.html`, which measures a sheet's position after
  it has animated in. Drive Chrome over the DevTools protocol in real time for
  both.
- **Never launch Firefox without `-profile <tempdir> --no-remote`** — plain
  `firefox --headless` seizes the user's default profile lock and blocks their
  running browser.
- **Do not pipe a native command's stderr to `$null` in PowerShell 5.1** — it
  wraps every line in an ErrorRecord and the call appears to fail when it did not.

## Architecture

`panel.js` is the custom element Home Assistant constructs. It creates a shadow
root, links the stylesheets into it, and calls `createApp({ hass, root })`.
Home Assistant then sets `.hass` on every state change, which is forwarded to
the bridge.

```
panel.js              custom element, shadow root, stylesheet links
  └ app/main.js       createApp(): shell, routing, data loading, all actions
      ├ ha/bridge.js  the ONLY thing that talks to Home Assistant
      ├ data/*.js     fetch + normalise + write, per domain
      ├ config.js     settings persistence and the source registry
      └ ui/screens/   one object per screen
```

Data flows one way: `main.js` owns all state and passes a `ctx` object down to
screens; screens never touch the bridge or the store directly, they call
`ctx.actions.*` and read `ctx.state()`.

**Screen contract.** Each screen factory returns `{ id, element, showFilters,
smallClock, title(), update(), fab?(), onEnter?() }`. `update()` rebuilds via
`keepScroll` — a full re-render, no vdom, which at this scale is fine.

**The source registry** (`config.js`) decides how each calendar entity behaves.
Every entity gets a `kind`:

- `events` — ordinary calendar, appears in Agenda/Month/Today
- `waste` — kerbside collection, rendered as a banner, never as event rows
- `park` — recyclagepark opening hours, hidden by default

Nothing is hard-coded and nothing is guessed: every calendar is `events` until
someone picks a type in Settings, which is stored as `settings.sources[id].kind`.
Guessing from the event shape was tried and removed -- a wrong guess is
invisible to the person it confuses. Changing a type re-fetches, because it
changes both which calendars are fetched and how their events group. Never
assume a calendar is writable — check `source.writable` / `source.canUpdate`, and check
`event.editable` (read-only integrations return events with no `uid`).

## Running inside Home Assistant

- **`ha/bridge.js` is the whole integration surface.** `sendMessage` →
  `hass.connection.sendMessagePromise`, `callService` → `hass.callService`,
  `subscribe` → `hass.connection.subscribeMessage`, `rest` → `hass.callApi`,
  `getStates` → `Object.values(hass.states)` (free, already in memory).
- **The app is in a shadow root**, so `document.getElementById` will not find
  anything of ours. Sheets attach via `setSheetHost()`; toasts via
  `mountToasts()`. Don't reach for the document.
- **CSS is scoped.** `tokens.css` declares its palette on `:root, :host,
  .app-root` so the same file works in the panel and in the plain-document dev
  pages. There is no `body` inside a shadow root — surface styles live on
  `.app-root`. Night mode toggles a class on our root, never on
  `document.documentElement`, which is Home Assistant's.
- **Caching is off by design.** `__init__.py` registers the static path with
  `cache_headers=False`. Home Assistant's default is
  `Cache-Control: public, max-age=2678400` (31 days), which made deployed
  changes invisible and cost real debugging time. Do not "optimise" it back.
- **`require_admin=False`** on the panel, so the whole household can use it.
- **Settings live in Home Assistant, per user**, under the `family_calendar`
  key via `frontend/get_user_data` / `frontend/set_user_data` — which puts them
  in `/config/.storage/`, outside this component's folder, so a HACS update that
  replaces the folder does not wipe them. `localStorage` is kept only as a cache
  so the panel can paint before the round trip, and as a fallback when Home
  Assistant is unreachable. Home Assistant's copy always wins.
- **Setup is a config entry**, created by a confirm-only flow. There is nothing
  to configure — household preferences live in the panel's own Settings sheet —
  but the flow is what lets HACS users add it from the UI instead of YAML.
  `async_setup` only forwards a legacy `family_calendar:` YAML block into an
  import flow.
- **The static route is registered once per Home Assistant run**, guarded by
  `hass.data[DOMAIN]["static_ready"]`; registering the same path twice raises.
  The panel itself is registered and removed per config entry.

## Home Assistant specifics that bit us

Verified against a live instance (HA 2026.8.3), not assumed:

- **There is no `calendar.update_event` or `calendar.delete_event` service.**
  Only `calendar.create_event` and `calendar.get_events` exist. Editing and
  deleting are WebSocket-only: `calendar/event/update`, `calendar/event/delete`.
- **There is no `todo.move_item` service either.** Reordering is
  `todo/item/move` over WebSocket.
- **To-do capabilities differ per list and errors are not silent.** Sending
  `due_date` or `description` to `todo.shopping_list` fails. Always gate on the
  `supported_features` bits resolved in `data/todos.js`.
- **Recycle! events carry the address in every summary** —
  `"12 Example Street, 1000 - Anytown Gft"` — and mix languages (`Gft`,
  `Huisvuil`, `PMD`, `Paper-cardboard`). `data/waste.js` strips the prefix and
  normalises to Dutch labels with EcoWerf bin colours.
- **All-day event ends are exclusive.** `normaliseEvent` steps `endKey` back a
  day; `createEvent` adds one back on. Getting this wrong makes every one-day
  event span two.
- **Recurring events need a `recurrence_range`.** Edits and deletes prompt via
  `recurrenceSheet` rather than guessing.
- **There are no per-user entity permissions in practice.** Every Home Assistant
  user sees every entity; only attribution differs. Any per-person filtering has
  to be built here.

## Conventions

- **Do not auto-focus a colour or date input.** `openSheet` focuses the first
  *typing* target only. Focusing `input[type=color]` or a date field makes the
  platform open its own picker, which is how opening Settings started throwing
  up a colour picker on its own.

- **Timezone**: never use raw `Date` methods for anything user-facing.
  Everything goes through `util/dates.js`, which resolves against an explicit
  IANA zone taken from `hass.config.time_zone`.
- **DOM**: build with `h()` from `util/dom.js`. Use `tappable()` rather than
  `onclick` — it suppresses taps that were actually scrolls, and requires a
  `pointerup` to match its own `pointerdown`.
- **Gestures match pointer identity.** `onTap` and `onLongPress` both track the
  `pointerId` that began the press. Three separate bugs came from not doing
  this: a checkbox tap opening the editor, a hold cancelled by a passing mouse,
  and a dismissed sheet reopening what was underneath it.
- **Hiding things**: `.hidden = true` only works because of the global
  `[hidden] { display: none !important }` rule — every component sets its own
  `display`, which would otherwise win.
- **Custom properties**: per-calendar colours pass as `style: { '--event-color':
  … }`. `h()` routes `--*` through `setProperty`; plain assignment silently does
  nothing.
- **Touch targets**: minimum 56px (`--touch`), list rows 72px (`--row`).
- **Writes are optimistic with undo** where a mistap is plausible (completing a
  task), and confirmed where they are irreversible (deleting, clearing).
- **Errors are user-facing sentences**, not exception strings. `toastError(what,
  err)` enforces the shape.
