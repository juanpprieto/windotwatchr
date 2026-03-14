/**
 * Fake Affirm-like SDK — Command Queue + Deep Nesting (3 levels).
 *
 * Pattern: IIFE creates window.acmePayments with stub methods immediately,
 * then after a delay "loads" the real SDK with nested ui.components.
 *
 * Exercises: PropertyTrap setter, ProxyWrapper nested set (3 levels deep),
 * hasDeepSubscribers path resolution.
 */
(function () {
  'use strict';

  var LOAD_DELAY = 800;
  var queue = [];

  // Phase 1: Synchronous stub — command queue pattern
  window.acmePayments = {
    checkout: {
      open: function () { queue.push(['open', arguments]); },
      set: function () { queue.push(['set', arguments]); },
      close: function () { queue.push(['close', arguments]); },
    },
    version: '0.0.1-stub',
  };

  // Phase 2: Async "SDK load" — replaces stubs with real implementation.
  // NOTE: Assignments are incremental (ui, then ui.components) so each
  // level triggers its own Proxy set trap — matching how the core engine
  // detects deep nested paths via lazy proxy chaining.
  setTimeout(function () {
    window.acmePayments.ui = {};
    window.acmePayments.ui.ready = function (cb) { cb(); };
    window.acmePayments.ui.components = {
      create: function (type, opts) {
        return {
          type: type,
          amount: opts && opts.amount,
          pageType: opts && opts.pageType,
          rendered: false,
          render: function (selector) {
            this.rendered = true;
            var el = document.querySelector(selector);
            if (el) {
              el.setAttribute('data-acme-type', type);
              el.setAttribute('data-acme-amount', String(this.amount || ''));
              el.setAttribute('data-acme-rendered', 'true');
              el.textContent = 'Acme ' + type + ' — $' + (this.amount || 0);
            }
            return this;
          },
          update: function (newOpts) {
            this.amount = newOpts && newOpts.amount;
            return this;
          },
          destroy: function () {
            this.rendered = false;
          },
        };
      },
      render: function (selector) {
        var el = document.querySelector(selector);
        if (el) el.setAttribute('data-acme-rendered', 'true');
      },
    };

    // Replace stub version
    window.acmePayments.version = '1.0.0';

    // Replay queued commands
    queue.forEach(function (entry) {
      var method = entry[0];
      if (window.acmePayments.checkout[method]) {
        window.acmePayments.checkout[method].apply(null, entry[1]);
      }
    });

    // Timestamp for E2E ordering assertions
    window.acmePayments._loadedAt = Date.now();
  }, LOAD_DELAY);
})();
