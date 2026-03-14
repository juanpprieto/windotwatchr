/**
 * Fake gtag-like SDK — Sync Inline + Array Augmentation.
 *
 * Pattern: Both globals exist synchronously. External script augments later.
 *
 * Exercises: immediate-value detection (already-exists path),
 * function-type assignment, queueMicrotask fast-path.
 */
(function () {
  'use strict';

  var AUGMENT_DELAY = 400;

  // Phase 1: Synchronous — globals exist immediately
  window.acmeDataLayer = [];
  window.acmeTag = function () {
    window.acmeDataLayer.push(Array.prototype.slice.call(arguments));
  };

  // Timestamp for E2E ordering assertions
  window.acmeDataLayer._createdAt = Date.now();

  // Phase 2: Augment push with tracking logic
  setTimeout(function () {
    var originalPush = window.acmeDataLayer.push.bind(window.acmeDataLayer);
    window.acmeDataLayer.push = function () {
      var args = Array.prototype.slice.call(arguments);
      // "Track" the event
      args.forEach(function (item) {
        if (Array.isArray(item)) {
          item._tracked = true;
          item._trackedAt = Date.now();
        }
      });
      return originalPush.apply(window.acmeDataLayer, args);
    };

    window.acmeDataLayer._augmentedAt = Date.now();
  }, AUGMENT_DELAY);
})();
