/* Vanilla JS for the church site:
   mobile hamburger nav + admin image uploads + sticky-header condense + scroll reveal.
   No external dependencies. All motion honors prefers-reduced-motion. */
(function () {
  'use strict';

  // ── Image fallbacks (CSP-safe replacement for inline onerror) ───────────
  // Registered at top level (not DOMContentLoaded) because image errors can
  // fire before the DOM is ready. Error events don't bubble, so use capture.
  function applyFallback(img) {
    if (img.tagName === 'IMG' && img.dataset.fallback && img.src !== location.origin + img.dataset.fallback) {
      img.src = img.dataset.fallback;
    }
  }
  document.addEventListener('error', function (e) {
    applyFallback(e.target);
  }, true);
  // Sweep images that already failed before this script executed.
  document.querySelectorAll('img[data-fallback]').forEach(function (img) {
    if (img.complete && img.naturalWidth === 0) applyFallback(img);
  });

  document.addEventListener('DOMContentLoaded', function () {
    // ── Hamburger navigation ──────────────────────────────────────────────
    document.querySelectorAll('[data-nav-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var nav = document.querySelector('[data-nav]');
        if (!nav) return;
        var open = nav.classList.toggle('is-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });

    // ── Mark the current page in the nav (presentation only) ──────────────
    document.querySelectorAll('.main-nav > a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      // Roots ('/', '/admin') match exactly only, so they don't shadow subpages.
      var isRoot = href === '/' || href === '/admin';
      if (href === location.pathname || (!isRoot && location.pathname.indexOf(href + '/') === 0)) {
        a.setAttribute('aria-current', 'page');
      }
    });

    // ── Sticky header condense on scroll ──────────────────────────────────
    var header = document.querySelector('[data-site-header]');
    if (header) {
      var onScroll = function () {
        if (window.scrollY > 8) header.classList.add('is-condensed');
        else header.classList.remove('is-condensed');
      };
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
    }

    // ── Scroll reveal (no flash: only arm elements not already in view) ────
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var targets = document.querySelectorAll('.reveal, .reveal-group');
    if (!reduce && 'IntersectionObserver' in window && targets.length) {
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) {
              en.target.classList.add('is-visible');
              io.unobserve(en.target);
            }
          });
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
      );
      var vh = window.innerHeight || document.documentElement.clientHeight;
      targets.forEach(function (el) {
        var r = el.getBoundingClientRect();
        var inView = r.top < vh && r.bottom > 0;
        if (inView) {
          // Already visible at load — show immediately, never hide (no flash).
          el.classList.add('is-visible');
        } else {
          el.classList.add('reveal-armed');
          io.observe(el);
        }
      });
    }

    // ── Admin image uploads ───────────────────────────────────────────────
    var meta = document.querySelector('meta[name="csrf-token"]');
    var csrf = meta ? meta.getAttribute('content') : '';

    document.querySelectorAll('[data-upload-button]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var container = btn.closest('[data-upload-for]');
        if (!container) return;

        var targetId = container.getAttribute('data-upload-for');
        var target = document.getElementById(targetId);
        var fileInput = container.querySelector('[data-upload-input]');
        var status = container.querySelector('[data-upload-status]');

        if (!fileInput || !fileInput.files || !fileInput.files[0]) {
          if (status) status.textContent = 'Choose a file first.';
          return;
        }

        var formData = new FormData();
        formData.append('file', fileInput.files[0]);

        if (status) status.textContent = 'Uploading…';
        btn.disabled = true;

        fetch('/admin/upload', {
          method: 'POST',
          headers: { 'x-csrf-token': csrf },
          body: formData,
          credentials: 'same-origin'
        })
          .then(function (res) {
            return res.json().then(function (body) {
              return { ok: res.ok, body: body };
            });
          })
          .then(function (result) {
            if (result.ok && result.body && result.body.url) {
              if (target) target.value = result.body.url;
              if (status) status.textContent = 'Uploaded.';
            } else {
              if (status) {
                status.textContent =
                  result.body && result.body.error ? result.body.error : 'Upload failed.';
              }
            }
          })
          .catch(function () {
            if (status) status.textContent = 'Upload failed — please try again.';
          })
          .then(function () {
            btn.disabled = false;
          });
      });
    });
  });
})();
