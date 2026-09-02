# Brand assets

These are for [home-assistant/brands](https://github.com/home-assistant/brands),
which is where Home Assistant and HACS fetch integration logos from. Until the
domain exists there, HACS shows a grey "icon not available" placeholder on the
repository card and in its notifications.

This is **cosmetic only**. The sidebar icon is set by the integration itself
(`PANEL_ICON` in `const.py`, currently `mdi:calendar-heart`) and works without
any of this.

## Submitting

1. Fork <https://github.com/home-assistant/brands>.
2. Create `custom_integrations/family_calendar/` — the `custom_integrations`
   directory, not `core_integrations`; that one is for integrations shipped with
   Home Assistant.
3. Copy `icon.png` (256×256) and `icon@2x.png` (512×512) into it.
4. Open a pull request. Merging takes a few days, and the icon appears
   everywhere once it does — no change or release needed here.

A `logo.png` is optional and only worth adding if a wordmark ever exists; for a
square mark like this one the icon is used for both.

## Regenerating

`icon.svg` is the source. The PNGs are rendered from it with headless Chrome,
which avoids a build dependency for two files that change almost never:

```powershell
.\serve.ps1                     # in another terminal, serving the repo
$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
& $chrome --headless=new --disable-gpu --hide-scrollbars `
    --default-background-color=00000000 --window-size=256,256 `
    --screenshot=brands\icon.png    http://localhost:8080/brands/render.html
& $chrome --headless=new --disable-gpu --hide-scrollbars `
    --default-background-color=00000000 --window-size=512,512 `
    --screenshot=brands\icon@2x.png http://localhost:8080/brands/render.html
```

`--default-background-color=00000000` is what keeps the corners transparent
rather than white. Check the result is still 256×256 / 512×512 RGBA afterwards;
the window size is the image size, so a stray browser chrome flag would change it.
