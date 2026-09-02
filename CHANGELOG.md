# Changelog

Notable changes, newest first. Versions follow [semantic versioning](https://semver.org),
and the `version` in `manifest.json` always matches the release tag — the
release workflow refuses to publish if they disagree.

While this is 0.x, the write paths (creating, editing and deleting events;
adding and editing tasks) have not been exercised against live data through the
panel's own UI. 1.0.0 is reserved for when they have.

## 0.1.7

### Added
- This changelog, and a release workflow. Pushing a `v*` tag now publishes the
  GitHub release automatically, with the notes taken from the matching
  `## <version>` section here. HACS offers an update when a *release* exists,
  not merely a tag, and doing that by hand was easy to forget.
- The release refuses to publish if the tag and `manifest.json` disagree on the
  version. HACS reads the manifest, so a mismatch would install a version that
  misreports itself.

## 0.1.6

### Added
- Rename a to-do list by long-pressing (or right-clicking) its tab. A list's
  name is its entity name, so this renames the entity in Home Assistant and the
  new name shows everywhere. Home Assistant only permits this for
  administrators, and a refusal now says so rather than surfacing a raw error.

### Fixed
- The floating add button overlapped the bottom navigation. It was positioned
  from the app's bottom edge with the navigation's height assumed constant,
  which stopped being true once the navigation began padding for a phone's
  gesture inset. It and the toasts now sit inside the screen area, which ends
  where the navigation begins.

## 0.1.5

### Added
- A small settings button beside the connection indicator. Reporting the
  connection and opening settings used to be the same element, so glancing at
  "Live" opened a sheet.

### Fixed
- Opening Settings threw up the platform's colour picker unasked. Sheets focus
  their first field so a keyboard can drive them, and Settings' first field is a
  colour swatch — focusing `input[type=color]` makes the platform open its
  picker. Only typing targets are focused now, which also spares the date fields
  in the event form.

## 0.1.4

### Fixed
- On a phone the header was cut off and a strip of dead space sat under the
  navigation. `100dvh` assumes the panel starts at the top of the screen, but
  Home Assistant pads its container for the status bar, so the panel overflowed
  by that padding. The panel now measures where it actually starts and subtracts
  it.
- The navigation pads for `env(safe-area-inset-bottom)`, clearing a phone's
  gesture bar.

## 0.1.3

### Added
- Recolour a calendar by long-pressing (or right-clicking) its filter chip. The
  picker offers the palette, the per-kind defaults, and the device's own colour
  input.

### Fixed
- A long press also fired the element's tap handler on release, so holding a
  chip would have recoloured the calendar *and* switched it off. This previously
  went unnoticed only because the sheet a long press opens covers the element
  and swallows the release.

## 0.1.2

### Fixed
- The panel grew to fit its content instead of the viewport, because
  `height: 100%` resolves to `auto` inside Home Assistant's panel container.
  The bottom navigation ended up below sixty days of agenda, nothing scrolled
  under the pointer, and sheets opened far below the fold.
- Sheets centre on anything wider than 600px. The bottom sheet was for thumb
  reach on a hand-held device; a wall-mounted tablet and a desktop are neither.

## 0.1.1

### Fixed
- `manifest.json` keys were not in the order hassfest requires (domain, name,
  then alphabetical), so the repository's own validation failed. Home Assistant
  loads the integration either way — this was a lint failure, not a runtime one.
- Declared `CONFIG_SCHEMA`, which Home Assistant expects of any integration
  defining `async_setup`.

### Added
- Brand icon assets and the steps to submit them to `home-assistant/brands`,
  which is what replaces the grey placeholder HACS shows.

## 0.1.0

First release. A Home Assistant custom integration that adds a full-screen
**Family Calendar** panel: the household's calendars and to-do lists in one
place, editable, built for a wall-mounted tablet in portrait.

- No login and no access token — the panel runs inside Home Assistant's own
  frontend, which hands it an authenticated session.
- Four screens: Today, Agenda, Month and Lists, plus Settings.
- Waste collection calendars render as a banner and remind a day early, because
  the calendar records when the truck arrives rather than when the bins go out.
- Settings are stored per Home Assistant user, so they follow a person across
  devices and survive updates.
- The frontend is served with caching disabled, so an update reaches every
  browser on reload.
