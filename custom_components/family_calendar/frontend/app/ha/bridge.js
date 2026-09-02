/**
 * The one place that talks to Home Assistant.
 *
 * Running as a panel, Home Assistant's frontend hands us a `hass` object that
 * is already authenticated as the logged-in user. So this replaces what used to
 * be a hand-rolled WebSocket client with a thin adapter over it: no tokens, no
 * login, no reconnect logic, no socket lifecycle. Home Assistant owns all of
 * that, and it is already doing it for its own UI.
 *
 * The surface deliberately matches what the data modules already called, so
 * `data/calendars.js` and `data/todos.js` did not have to change.
 */

export class HassBridge {
  /** @param {object} hass The frontend's hass object. */
  constructor(hass) {
    this.hass = hass;
  }

  /** Swapped in whenever Home Assistant pushes a new hass object. */
  update(hass) {
    this.hass = hass;
  }

  get baseUrl() {
    return window.location.origin;
  }

  get haVersion() {
    return (this.hass && this.hass.config && this.hass.config.version) || null;
  }

  /** The household timezone, straight from Home Assistant's config. */
  get timeZone() {
    return (this.hass && this.hass.config && this.hass.config.time_zone) || null;
  }

  /** Who is looking at the panel. */
  get user() {
    return (this.hass && this.hass.user) || null;
  }

  get status() {
    // The frontend keeps the socket alive; `connected` is false while it is
    // re-establishing, which is exactly when the app should look stale.
    if (!this.hass || !this.hass.connection) return 'connecting';
    return this.hass.connection.connected ? 'connected' : 'reconnecting';
  }

  /**
   * Watch the connection going down and coming back, so the header and the
   * offline banner stay honest.
   * @param {(status: string) => void} fn
   */
  onStatus(fn) {
    fn(this.status);

    const conn = this.hass && this.hass.connection;
    if (!conn || typeof conn.addEventListener !== 'function') return () => {};

    const onReady = () => fn('connected');
    const onDisconnected = () => fn('reconnecting');
    conn.addEventListener('ready', onReady);
    conn.addEventListener('disconnected', onDisconnected);

    return () => {
      conn.removeEventListener('ready', onReady);
      conn.removeEventListener('disconnected', onDisconnected);
    };
  }

  /** Send a raw WebSocket command (calendar edits and to-do moves need this). */
  sendMessage(message) {
    return this.hass.connection.sendMessagePromise(message);
  }

  /** Call a service. */
  callService(domain, service, data = {}, target = undefined) {
    return this.hass.callService(domain, service, data, target);
  }

  /**
   * Every entity state. Home Assistant already holds these, so this costs
   * nothing and is always current — no round trip like the old client needed.
   */
  getStates() {
    return Promise.resolve(Object.values((this.hass && this.hass.states) || {}));
  }

  /** Open a subscription; resolves to an unsubscribe function. */
  subscribe(message, callback) {
    return this.hass.connection.subscribeMessage(callback, message);
  }

  /**
   * GET against the REST API. Calendar event listing has no WebSocket
   * equivalent, so it still goes over HTTP — but authenticated by the frontend.
   *
   * @param {string} path e.g. "/api/calendars"
   */
  rest(path) {
    return this.hass.callApi('GET', path.replace(/^\/api\//, ''));
  }

  /**
   * Per-user storage, kept by Home Assistant in `/config/.storage/`.
   *
   * This is what makes settings follow a person from the tablet to their phone
   * instead of being stranded in one browser's localStorage — and, because it
   * lives outside any integration folder, it survives updates that replace this
   * component wholesale.
   */
  getUserData(key) {
    return this.sendMessage({ type: 'frontend/get_user_data', key }).then(
      (res) => (res && res.value) || null
    );
  }

  setUserData(key, value) {
    return this.sendMessage({ type: 'frontend/set_user_data', key, value });
  }

  /**
   * Rename an entity, which is how a to-do list gets a new name — the list's
   * name *is* its entity name. This is the registry, so it needs an admin
   * account; callers surface the refusal rather than failing silently.
   */
  renameEntity(entityId, name) {
    return this.sendMessage({
      type: 'config/entity_registry/update',
      entity_id: entityId,
      name,
    });
  }

  /** Nothing to tear down: the connection belongs to Home Assistant. */
  close() {}
}
