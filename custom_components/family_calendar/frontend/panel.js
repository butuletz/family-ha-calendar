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
    this._fit = this._fit.bind(this);
  }

  /**
   * Size the panel to the space actually below it, not to the whole viewport.
   *
   * `100dvh` alone assumes the panel starts at the top of the screen. In the
   * companion app it does not: Home Assistant pads its container for the status
   * bar, so the panel's own height plus that padding overflows the screen. The
   * page then scrolls by exactly the offset, which cuts the header off the top
   * and leaves a strip of dead space under the navigation.
   *
   * Measuring adapts to whatever Home Assistant puts above us on any device,
   * which guessing at insets would not.
   */
  _fit() {
    const scroller = document.scrollingElement || document.documentElement;
    const top = this.getBoundingClientRect().top + (scroller ? scroller.scrollTop : 0);
    this.style.setProperty('--panel-offset', `${Math.max(0, Math.round(top))}px`);
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

    // After a frame, so Home Assistant has finished laying the panel out.
    requestAnimationFrame(this._fit);
    window.addEventListener('resize', this._fit);
    window.addEventListener('orientationchange', this._fit);
  }

  disconnectedCallback() {
    window.removeEventListener('resize', this._fit);
    window.removeEventListener('orientationchange', this._fit);

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
