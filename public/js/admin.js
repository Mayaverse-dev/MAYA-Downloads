(function () {
  'use strict';

  var pw = '';
  var STORAGE_KEY = 'maya_admin_pw';

  function getPw() {
    return pw || (typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null) || '';
  }

  function setPw(value) {
    pw = value;
    try { localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
  }

  function clearPw() {
    pw = '';
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  function api(method, path, body, usePw) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (usePw !== false) opts.headers['x-admin-password'] = getPw();
    if (body) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(function (r) {
      if (r.status === 401) throw new Error('Unauthorized');
      return r.json();
    });
  }

  var loginEl = document.getElementById('admin-login');
  var dashboardEl = document.getElementById('admin-dashboard');
  var listEl = document.getElementById('admin-list');
  var addForm = document.getElementById('add-form');
  var variantsContainer = document.getElementById('variants-container');

  function showLogin() {
    loginEl.hidden = false;
    dashboardEl.hidden = true;
  }

  function showDashboard() {
    loginEl.hidden = true;
    dashboardEl.hidden = false;
    loadList();
  }

  document.getElementById('admin-login-btn').addEventListener('click', function () {
    var input = document.getElementById('admin-pw');
    var value = (input && input.value) || '';
    if (!value) return alert('Enter password');
    setPw(value);
    api('GET', '/api/admin/downloads?pw=' + encodeURIComponent(value))
      .then(function () { showDashboard(); })
      .catch(function () {
        alert('Invalid password');
        clearPw();
      });
  });

  document.getElementById('logout-btn').addEventListener('click', function () {
    clearPw();
    showLogin();
    if (document.getElementById('admin-pw')) document.getElementById('admin-pw').value = '';
  });

  function loadList() {
    api('GET', '/api/admin/downloads')
      .then(function (data) {
        var list = Array.isArray(data) ? data : [];
        listEl.innerHTML = list.map(function (item) {
          var thumb = item.thumbnailUrl || '';
          if (thumb && thumb.startsWith('/')) thumb = window.location.origin + thumb;
          return (
            '<div class="admin-item" data-id="' + escapeHtml(item.id) + '">' +
              '<img class="admin-item-thumb" src="' + escapeHtml(thumb) + '" alt="">' +
              '<div class="admin-item-info">' +
                '<div class="admin-item-title">' + escapeHtml(item.title) + '</div>' +
                '<div class="admin-item-meta">' + escapeHtml(item.category) + '</div>' +
              '</div>' +
              '<div class="admin-item-actions">' +
                '<button type="button" class="btn delete-btn" data-id="' + escapeHtml(item.id) + '">Delete</button>' +
              '</div>' +
            '</div>'
          );
        }).join('');

        listEl.querySelectorAll('.delete-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = this.getAttribute('data-id');
            if (!id || !confirm('Delete this item?')) return;
            api('DELETE', '/api/admin/downloads', { id: id })
              .then(function () { loadList(); })
              .catch(function (e) { alert('Failed: ' + (e.message || 'Unknown')); });
          });
        });
      })
      .catch(function () {
        showLogin();
      });
  }

  function escapeHtml(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function addVariantRow(label, type, url, fileSize) {
    var row = document.createElement('div');
    row.className = 'variant-row';
    row.innerHTML =
      '<input type="text" placeholder="Label (e.g. Mobile HD)" value="' + escapeHtml(label || '') + '">' +
      '<input type="text" placeholder="Download URL" value="' + escapeHtml(url || '') + '">' +
      '<button type="button" class="btn remove-variant">Remove</button>' +
      '<select class="variant-type">' +
        '<option value="">—</option>' +
        '<option value="mobile"' + (type === 'mobile' ? ' selected' : '') + '>Mobile</option>' +
        '<option value="desktop"' + (type === 'desktop' ? ' selected' : '') + '>Desktop</option>' +
      '</select>' +
      '<input type="text" placeholder="File size (optional)" value="' + escapeHtml(fileSize || '') + '" class="variant-filesize">';
    row.querySelector('.remove-variant').addEventListener('click', function () { row.remove(); });
    variantsContainer.appendChild(row);
  }

  document.getElementById('add-variant-btn').addEventListener('click', function () {
    addVariantRow('', '', '', '');
  });

  addVariantRow('', '', '', '');

  addForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var rows = variantsContainer.querySelectorAll('.variant-row');
    var variants = [];
    rows.forEach(function (row) {
      var labelInp = row.querySelector('input[placeholder*="Label"]');
      var urlInp = row.querySelector('input[placeholder*="URL"]');
      var typeSel = row.querySelector('select.variant-type');
      var sizeInp = row.querySelector('input.variant-filesize');
      var label = (labelInp && labelInp.value) || '';
      var url = (urlInp && urlInp.value) || '';
      var type = (typeSel && typeSel.value) || undefined;
      var fileSize = (sizeInp && sizeInp.value) || undefined;
      if (label && url) variants.push({ label: label, url: url, type: type || undefined, fileSize: fileSize || undefined });
    });
    if (!variants.length) return alert('Add at least one variant with label and URL.');

    var category = document.getElementById('add-category').value;
    var payload = {
      title: document.getElementById('add-title').value,
      description: document.getElementById('add-desc').value,
      category: category,
      thumbnailUrl: document.getElementById('add-thumb').value,
      variants: variants,
      tags: [],
    };
    var ch = document.getElementById('add-chapter').value;
    if (category === 'ebook' && ch) payload.chapter = parseInt(ch, 10);

    api('POST', '/api/admin/downloads', payload)
      .then(function () {
        addForm.reset();
        variantsContainer.innerHTML = '';
        addVariantRow('', '', '', '');
        document.getElementById('add-chapter').value = '';
        loadList();
      })
      .catch(function (err) { alert('Failed: ' + (err.message || 'Unknown')); });
  });

  if (getPw()) {
    api('GET', '/api/admin/downloads').then(function () { showDashboard(); }).catch(showLogin);
  }
})();
