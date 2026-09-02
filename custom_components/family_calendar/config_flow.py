"""Config flow.

There is nothing to configure — the panel takes everything it needs from Home
Assistant, and per-household preferences (colours, which calendars show, the
waste reminder offset) live in the panel's own Settings sheet. So this is a
confirm-only flow whose job is simply to create the entry that adds the panel,
which is what lets the integration be added from the UI instead of YAML.
"""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN, PANEL_TITLE


class FamilyCalendarConfigFlow(ConfigFlow, domain=DOMAIN):
    """Add the Family Calendar panel."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Adding it from Settings → Devices & services."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is None:
            return self.async_show_form(step_id="user")

        return self.async_create_entry(title=PANEL_TITLE, data={})

    async def async_step_import(self, import_data: dict[str, Any]) -> ConfigFlowResult:
        """Carry a legacy `family_calendar:` YAML block over to an entry."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        return self.async_create_entry(title=PANEL_TITLE, data={})
