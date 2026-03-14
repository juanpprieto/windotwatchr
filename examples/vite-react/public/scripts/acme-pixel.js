/**
 * Fake Meta Pixel-like SDK — Two-Phase Init + Property Mutation.
 *
 * Pattern: IIFE creates object stub with queue and track method.
 * Later sets loaded = true (property mutation on existing proxied object).
 *
 * Exercises: Proxy set trap on property mutation (loaded: false -> true),
 * ready predicate distinction between stub (loaded=false) and real SDK (loaded=true).
 *
 * NOTE: Uses an object (not a function) because the core engine's PropertyTrap
 * only Proxy-wraps values where typeof === 'object'. Function-type globals
 * fall through to the primitive path with no Proxy and no polling fallback.
 */
(function () {
  'use strict';

  var LOAD_DELAY = 500;

  // Phase 1: Synchronous stub — object with queue and track method
  var acmePx = {
    queue: [],
    loaded: false,
    version: '2.0',
    _createdAt: Date.now(),
    track: function () {
      acmePx.queue.push(Array.prototype.slice.call(arguments));
    },
  };

  window.acmePx = acmePx;

  // Phase 2: "Load" — set loaded = true
  setTimeout(function () {
    window.acmePx.loaded = true;
    window.acmePx._loadedAt = Date.now();

    // Process queued calls
    window.acmePx.queue.forEach(function (args) {
      if (typeof args[0] === 'string') {
        var el = document.createElement('div');
        el.setAttribute('data-acme-pixel-event', args[0]);
        el.style.display = 'none';
        document.body.appendChild(el);
      }
    });
  }, LOAD_DELAY);
})();
