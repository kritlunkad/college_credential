/**
 * state.js — Reactive event layer using CustomEvent
 * 
 * UI components subscribe to events (credential:issued, credential:claimed, etc.)
 * and auto-update without manual refresh. Uses window as the event bus.
 */

const StateManager = (() => {
  const EVENT_PREFIX = 'cc:';

  function emit(eventName, detail = null) {
    window.dispatchEvent(new CustomEvent(EVENT_PREFIX + eventName, { detail }));
  }

  function on(eventName, callback) {
    window.addEventListener(EVENT_PREFIX + eventName, (e) => callback(e.detail));
  }

  function off(eventName, callback) {
    window.removeEventListener(EVENT_PREFIX + eventName, callback);
  }

  // Cross-tab sync via storage events
  function enableCrossTabSync() {
    window.addEventListener('storage', (e) => {
      if (e.key && e.key.startsWith('cc_')) {
        const domain = e.key.replace('cc_', '');
        emit('sync:' + domain, { key: e.key, newValue: e.newValue });
        // Generic refresh event
        emit('store:updated', { key: e.key });
      }
    });
  }

  return { emit, on, off, enableCrossTabSync };
})();
