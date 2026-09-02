"""Family Calendar — a full-screen calendar and to-do panel for Home Assistant.

The panel runs inside Home Assistant's own frontend, which hands it an
authenticated `hass` object. That is the whole reason this is an integration
rather than a page in `www/`: nobody has to log in or paste a token, and every
Home Assistant user sees it as themselves.

Two details here matter more than they look:

* The frontend files are served with **caching disabled**
  (``cache_headers=False``). Home Assistant's default static handler sends
  ``Cache-Control: public, max-age=2678400`` — 31 days — which means an updated
  app is invisible until every browser's cache expires. Turning that off makes
  "install the update, restart" actually deliver the new version, with no
  version numbers to remember anywhere.

* The panel is registered with ``require_admin=False`` so the whole household
  can use it, not only the owner account.
"""

from __future__ import annotations

import logging
import os

from homeassistant.components.frontend import (
    async_register_built_in_panel,
    async_remove_panel,
)
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import SOURCE_IMPORT, ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN, PANEL_ICON, PANEL_NAME, PANEL_TITLE, PANEL_URL, URL_BASE

_LOGGER = logging.getLogger(__name__)

#: Set once the static route exists. Registering the same path twice raises.
_STATIC_READY = "static_ready"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Handle a legacy `family_calendar:` block in configuration.yaml.

    Setup happens through the config entry now; this only forwards an existing
    YAML entry so upgrading does not silently lose the panel.
    """
    if DOMAIN in config:
        hass.async_create_task(
            hass.config_entries.flow.async_init(
                DOMAIN, context={"source": SOURCE_IMPORT}, data={}
            )
        )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Serve the frontend and put the panel in the sidebar."""
    frontend_dir = os.path.join(os.path.dirname(__file__), "frontend")

    if not os.path.isdir(frontend_dir):
        _LOGGER.error(
            "Frontend files are missing from %s — the panel cannot be served",
            frontend_dir,
        )
        return False

    # The route survives a config entry being unloaded and reloaded, so it is
    # registered at most once per Home Assistant run.
    if not hass.data.get(DOMAIN, {}).get(_STATIC_READY):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    url_path=URL_BASE,
                    path=frontend_dir,
                    # Deliberately off: see the module docstring.
                    cache_headers=False,
                )
            ]
        )
        hass.data.setdefault(DOMAIN, {})[_STATIC_READY] = True

    async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        frontend_url_path=DOMAIN,
        require_admin=False,
        config={
            "_panel_custom": {
                "name": PANEL_NAME,
                "module_url": PANEL_URL,
                "embed_iframe": False,
                "trust_external": False,
            }
        },
    )

    _LOGGER.debug("Family Calendar panel registered at /%s", DOMAIN)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Take the panel back out of the sidebar."""
    async_remove_panel(hass, DOMAIN)
    return True
