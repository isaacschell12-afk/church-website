/* Vanilla JS for the church site: mobile hamburger nav + admin image uploads. */
(function () {
  'use strict';

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
