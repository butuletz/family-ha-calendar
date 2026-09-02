/**
 * The custom element Home Assistant loads into its sidebar.
 *
 * Home Assistant constructs this, sets `hass` on it (repeatedly, on every state
 * change), and gives it the full content area. Everything the app needs comes
 * through that object, which is why there is no login anywhere in this codebase.
 *
 * The app is mounted in a shadow root. That is not ceremony: the panel renders
 * inside Home Assistant's own document, and without the boundary our CSS reset
 * and theirs would fight over every element on the page.
 */

import { createApp } from './app/main.js';

const STYLESHEETS = ['./styles/tokens.css', './styles/app.css'];

class FamilyCalendarPanel extends HTMLElement {
  constructor() {
    super();
    this._app = null;
    this._hass = null;
    this._root = null;
  }

  /** Home Assistant sets this before the element is connected, and on every update. */
  set hass(hass) {
    this._hass = hass;
    if (this._app) this._app.setHass(hass);
    else this._mount();
  }

  get hass() {
    return this._hass;
  }

  /** Set by Home Assistant; unused, but assigning them must not throw. */
  set narrow(value) {
    this._narrow = value;
  }

  set route(value) {
    this._route = value;
  }

  set panel(value) {
    this._panel = value;
  }

  connectedCallback() {
    this._mount();
  }

  disconnectedCallback() {
    if (this._app) {
      this._app.destroy();
      this._app = null;
    }
  }

  _mount() {
    if (this._app || !this._hass || !this.isConnected) return;

    if (!this._root) {
      this._root = this.attachShadow({ mode: 'open' });

      // Linked rather than inlined so the stylesheets stay ordinary files the
      // integration serves; the shadow boundary keeps them off the rest of the
      // Home Assistant page.
      for (const href of STYLESHEETS) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = new URL(href, import.meta.url).href;
        this._root.appendChild(link);
      }

      this._container = document.createElement('div');
      this._container.className = 'app-root';
      this._root.appendChild(this._container);
    }

    this._app = createApp({
      hass: this._hass,
      root: this._container,
      shadowRoot: this._root,
    });
  }
}

if (!customElements.get('family-calendar-panel')) {
  customElements.define('family-calendar-panel', FamilyCalendarPanel);
}
