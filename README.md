# Family Calendar

A Home Assistant custom integration that adds a full-screen **Family Calendar**
panel to the sidebar: your calendars and to-do lists, in one place, editable.
Built for a wall-mounted tablet in portrait (800 × 1280), but the layout is
fluid and it works fine on a desktop.

Because it runs as a panel inside Home Assistant's own frontend, **there is no
login and no access token**. Home Assistant hands the panel an already
authenticated session, so everyone in the household who can open Home Assistant
can open this, as themselves.

There is **no build step and no dependencies** — plain ES modules and CSS.

> **Version 0.1.7 — early.** Everything here has been verified against a
> real Home Assistant except the write paths: creating, editing and deleting
> events, and adding or editing tasks. Those are exercised by the test suite
> against a stubbed connection, but have not yet been run against live data.
> 1.0.0 is reserved for once they have.

---

## Installing

### With HACS (recommended)

HACS → **Integrations** → ⋮ → **Custom repositories** → add
`https://github.com/butuletz/family-ha-calendar` with category **Integration**.
Then install it, restart Home Assistant, and add it from
**Settings → Devices & services → Add integration → Family Calendar**.

Updates then arrive like any other integration: HACS offers them in the UI when
a new release is tagged.

### By hand

```powershell
.\deploy.ps1 -Stage
```

That gathers the integration into `_deploy\family_calendar` and opens Explorer.
Open **Studio Code Server** in Home Assistant and drag that folder into
`/config/custom_components/`. Or, if the config folder is a reachable share:

```powershell
.\deploy.ps1 -Destination \\192.168.1.50\config\custom_components
```

Use the IP rather than `\\homeassistant\` — Windows resolves SMB names to
`.local` unreliably.

Then restart Home Assistant and add it from **Settings → Devices & services**.

### Updating

HACS handles it, or copy the folder again. Either way, restart Home Assistant
and everyone has the new version — the integration serves its frontend with
caching disabled, so there are no version numbers to bump and no browser caches
to clear.

### Releasing a new version

1. Add a `## <version>` section at the top of [CHANGELOG.md](CHANGELOG.md)
2. Bump `version` in `custom_components/family_calendar/manifest.json` to match
3. Commit, then tag and push:

```powershell
git tag v0.1.8
git push origin main --tags
```

The **Release** workflow publishes the GitHub release for you, using that
changelog section as the notes. HACS offers an update when a release exists —
not merely a tag — so this is the step that actually ships it. If the tag and
the manifest disagree on the version it refuses to publish, since HACS reads the
manifest and a mismatch would install something that misreports itself.

To write notes for a tag that predates this, run the workflow by hand: **Actions
→ Release → Run workflow**, and give it the tag.

The **Validate** workflow runs hassfest and the HACS action on every push,
catching manifest and structure mistakes before anyone installs them.

---

## Working on it

```powershell
.\serve.ps1        # http://localhost:8080
```

The app itself **cannot run outside Home Assistant** — it needs the `hass`
object the frontend gives a panel. What the dev server is for is the three
pages that stand in for a test runner, none of which connect to anything:

| Page | What it does |
|---|---|
| `selftest.html` | 109 assertions over the date, event, waste-parsing and interaction logic — DST boundaries, all-day exclusive ends, multi-day expansion, fraction parsing, calendar classification, and that ticking a task neither opens its editor nor its detail sheet. |
| `panelcheck.html` | Mounts the real `<family-calendar-panel>` against a stubbed `hass` object. The only way to exercise the panel, the shadow DOM and `HassBridge` without a running Home Assistant. |
| `preview.html` | Renders all four screens at true 800 × 1280 against stubbed data, for layout work. `?night=1`, `?muted=1`, `?waste=collected`. |

Run `selftest.html` after touching `app/util/dates.js`, `app/data/`,
`app/config.js` or `app/util/dom.js`; run `panelcheck.html` after touching
`panel.js`, `app/main.js` or `app/ha/bridge.js`.

If you automate a browser against these, do **not** use Chrome's
`--virtual-time-budget` for anything involving a live connection — it
fast-forwards timers without waiting on I/O and reports false failures.

---

## What it shows

Every calendar and to-do list in Home Assistant appears automatically. Each
calendar starts as an ordinary one; in **Settings** you say what it actually is:

| Shows as | Behaviour |
|---|---|
| **A calendar** | Normal event rows in Today, Agenda and Month. The default. |
| **Waste collections** | Pulled out of the lists and drawn as a banner on Today, with the calendar's own name stripped off the front of each summary so you see the fraction. Reminds a day early by default, because the truck comes before you would act on it. Fetched even when hidden, so the banner keeps working. |
| **Opening hours** | For calendars that publish the same event every single day. Hidden by default, since they would bury the agenda. |

Nothing is guessed. The signals that separate a collection schedule from a
holiday calendar are circumstantial, and a wrong guess is baffling to whoever
sees it — so the choice is yours, made once per calendar.

**Everyone sees the same calendars.** Home Assistant has no per-user entity
permissions in practice, so the panel shows every user the same entities. What
differs per person is identity: their edits are attributed to them.

**Your settings follow you.** Colours, calendar types, hidden calendars and
night mode are stored per Home Assistant user, so setting them up on one device
applies to every device you sign in from. They live in `/config/.storage/`,
which means a HACS update does not wipe them. Each person gets their own.

---

## Which API does what

Everything goes through the `hass` object, so none of this needs credentials.

| Operation | How | Call |
|---|---|---|
| List calendars | REST | `hass.callApi('GET', 'calendars')` |
| Fetch events | REST | `hass.callApi('GET', 'calendars/{entity}?start=&end=')` |
| Create event | Service | `calendar.create_event` |
| Edit event | WebSocket | `calendar/event/update` |
| Delete event | WebSocket | `calendar/event/delete` |
| Live task list | WebSocket | `todo/item/subscribe` |
| Add / edit / delete task | Service | `todo.add_item`, `todo.update_item`, `todo.remove_item` |
| Clear completed | Service | `todo.remove_completed_items` |
| Reorder task | WebSocket | `todo/item/move` |
| Notice a calendar changed | WebSocket | `subscribe_trigger` on the calendar entities |

Calendar editing and to-do reordering have **no Home Assistant service** and
exist only as WebSocket commands — that is why `HassBridge` exposes
`sendMessage` alongside `callService`.

To-do lists push updates, so the Lists screen is genuinely live. Calendars do
not push event bodies — the app refetches when a calendar entity changes state
and every 10 minutes regardless.

---

## Known constraints

**Recurring events.** Editing or deleting one prompts for whether the change
applies to that occurrence or to all future ones, because Home Assistant needs a
`recurrence_range` and guessing would rewrite a whole series.

**Waste is reminded a day early on purpose.** The Recycle! calendar records the
morning the truck arrives, which is too late to act on. Each calendar carries a
`remindDaysBefore` offset — 1 for waste, 0 for everything else — so the Today
banner says *"Put out tonight"* on the eve and *"Collected this morning"* on the
day itself. Change it per calendar in Settings; every date shown is still the
real collection date.

**Keeping the tablet's screen awake needs a secure context.** Over plain
`http://<ip>:8123` the Screen Wake Lock API does not exist and the app falls
back to the tablet's own display timeout. Home Assistant behind HTTPS (the
Tailscale add-on's `https://<host>.ts.net/` URL counts) makes it work. Otherwise
set the screen timeout to *Never*, or use a kiosk browser.

**Hiding Home Assistant's sidebar and toolbar** on the wall tablet is the
`kiosk-mode` component's job, not this integration's.

---

## The HACS icon

HACS shows a grey placeholder until the domain exists in
[home-assistant/brands](https://github.com/home-assistant/brands). `brands/` has
the icon ready and the submission steps; it is cosmetic, and the sidebar icon
works regardless.

---

## Layout

```
custom_components/family_calendar/
  __init__.py           Registers the panel, serves the frontend uncached
  manifest.json
  frontend/
    panel.js            The custom element Home Assistant loads
    app/main.js         createApp(): shell, routing, data loading, all actions
    app/ha/bridge.js    The only thing that talks to Home Assistant
    app/config.js       Settings, source registry, entity classification
    app/data/           Calendars, to-dos, waste parsing
    app/util/           Dates (timezone-aware), DOM, store
    app/ui/components/  Shell, rows, sheets, forms, toasts
    app/ui/screens/     Today, Agenda, Month, Lists, Settings
    styles/             Tokens and component CSS

brands/                 Icon for home-assistant/brands, and how to submit it
deploy.ps1              Copy the integration, or -Stage for drag-and-drop
serve.ps1               Static server for the development pages
selftest.html           Logic assertions
panelcheck.html         Mounts the panel against a stubbed hass
preview.html            All four screens at tablet size
```

---

## Interaction notes

- **Tap** any row — event or task — to open its detail sheet, which carries
  **Edit** and **Delete** where the calendar or list supports them. A tap never
  opens a form directly, so brushing a row on the wall cannot rewrite the
  calendar, and it behaves identically with a finger or a mouse.
- **Long-press** (touch) or **right-click** (mouse) jumps straight to the editor.
- **Long-press or right-click a calendar chip** on Agenda or Month to recolour
  that calendar. A tap still switches it off and on; holding never does both.
- **Long-press or right-click a list tab** on Lists to rename that list. This
  renames the entity in Home Assistant, so the new name shows everywhere — and
  Home Assistant only allows it for administrators.
- The **checkbox** on a task is a direct one-tap toggle and never opens anything.
- **The small gear** beside the Live indicator, top right, opens Settings. The
  indicator itself only reports connection state — it is not a button.
- Calendars can be switched off two ways: the **chips** on Agenda and Month, and
  the **switches in Settings**. If a screen looks empty because of either, it
  says so and offers **Show all**.
- Night mode dims the panel automatically between 22:00 and 07:00.
