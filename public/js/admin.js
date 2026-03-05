(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────
  var pw = '';
  var STORAGE_KEY = 'maya_admin_pw';
  var allCategories = [];
  var allAssets = [];
  var editingId = null;
  var drawerThumbUrl = '';
  var drawerVisible = true;
  var drawerVariants = []; // { id, name, resolution, fileSize, downloadUrl, _file }
  var thumbPendingFile = null;

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function getPw() {
    return pw || (typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : '') || '';
  }
  function setPw(v) { pw = v; try { localStorage.setItem(STORAGE_KEY, v); } catch (e) {} }
  function clearPw() { pw = ''; try { localStorage.removeItem(STORAGE_KEY); } catch (e) {} }

  function escapeHtml(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function formatBytes(bytes) {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
  }

  function createDT(file) {
    try { var dt = new DataTransfer(); dt.items.add(file); return dt.files; } catch (e) { return null; }
  }

  // ─── API ──────────────────────────────────────────────────────────────────
  function api(method, url, body) {
    var opts = { method: method, headers: { 'x-admin-password': getPw() } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (r) {
      if (r.status === 401) throw new Error('Unauthorized');
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || 'Error'); });
      return r.json();
    });
  }

  function apiUpload(file) {
    var fd = new FormData();
    fd.append('file', file);
    return fetch('/api/admin/upload', {
      method: 'POST',
      headers: { 'x-admin-password': getPw() },
      body: fd,
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || 'Upload failed'); });
      return r.json();
    });
  }

  // ─── Login ────────────────────────────────────────────────────────────────
  var loginEl = document.getElementById('admin-login');
  var dashboardEl = document.getElementById('admin-dashboard');

  function showLogin() { loginEl.hidden = false; dashboardEl.hidden = true; }
  function showDashboard() {
    loginEl.hidden = true;
    dashboardEl.hidden = false;
    loadCategories();
    loadAssets();
  }

  document.getElementById('admin-login-btn').addEventListener('click', doLogin);
  document.getElementById('admin-pw').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('logout-btn').addEventListener('click', function () {
    clearPw();
    showLogin();
    document.getElementById('admin-pw').value = '';
  });

  function doLogin() {
    var val = document.getElementById('admin-pw').value.trim();
    if (!val) return;
    setPw(val);
    api('GET', '/api/admin/downloads')
      .then(function () { showDashboard(); })
      .catch(function () { alert('Invalid password'); clearPw(); });
  }

  // Auto-login if password cached
  if (getPw()) {
    api('GET', '/api/admin/downloads')
      .then(function () { showDashboard(); })
      .catch(showLogin);
  }

  // ─── Categories ───────────────────────────────────────────────────────────
  var catListEl = document.getElementById('cat-list');
  var addCatFormWrap = document.getElementById('add-cat-form-wrap');
  var addCatForm = document.getElementById('add-cat-form');

  document.getElementById('add-cat-toggle-btn').addEventListener('click', function () {
    addCatFormWrap.hidden = !addCatFormWrap.hidden;
  });
  document.getElementById('add-cat-cancel').addEventListener('click', function () {
    addCatFormWrap.hidden = true;
    addCatForm.reset();
  });
  addCatForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var slug = document.getElementById('add-cat-slug').value.trim();
    var label = document.getElementById('add-cat-label').value.trim();
    var desc = document.getElementById('add-cat-desc').value.trim();
    api('POST', '/api/admin/categories', { slug: slug, label: label, desc: desc })
      .then(function () { addCatForm.reset(); addCatFormWrap.hidden = true; loadCategories(); })
      .catch(function (e) { alert('Failed: ' + e.message); });
  });

  function renderCatItem(cat) {
    var visible = cat.visible !== false;
    return (
      '<div class="adm-cat-item">' +
        '<div class="adm-cat-info">' +
          '<span class="adm-cat-label">' + escapeHtml(cat.label) + '</span>' +
          (cat.desc ? '<span class="adm-cat-desc">' + escapeHtml(cat.desc) + '</span>' : '') +
          (!cat.builtIn ? '<span class="adm-cat-badge">custom</span>' : '') +
        '</div>' +
        '<div class="adm-cat-actions">' +
          '<span class="adm-vis-label">' + (visible ? 'Visible' : 'Hidden') + '</span>' +
          '<div class="admin-toggle-switch ' + (visible ? 'on' : '') + ' cat-toggle" data-slug="' + escapeHtml(cat.slug) + '" data-visible="' + visible + '"></div>' +
          (!cat.builtIn ? '<button class="btn cat-delete-btn" data-slug="' + escapeHtml(cat.slug) + '">Delete</button>' : '') +
        '</div>' +
      '</div>'
    );
  }

  function loadCategories() {
    api('GET', '/api/admin/categories').then(function (cats) {
      allCategories = Array.isArray(cats) ? cats : [];
      catListEl.innerHTML = allCategories.length
        ? allCategories.map(renderCatItem).join('')
        : '<p class="adm-empty">No categories.</p>';

      catListEl.querySelectorAll('.cat-toggle').forEach(function (el) {
        el.addEventListener('click', function () {
          var slug = this.getAttribute('data-slug');
          var v = this.getAttribute('data-visible') === 'true';
          api('PATCH', '/api/admin/categories/' + encodeURIComponent(slug), { visible: !v })
            .then(function () { loadCategories(); })
            .catch(function (e) { alert('Failed: ' + e.message); });
        });
      });

      catListEl.querySelectorAll('.cat-delete-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var slug = this.getAttribute('data-slug');
          if (!confirm('Delete category "' + slug + '"?')) return;
          api('DELETE', '/api/admin/categories/' + encodeURIComponent(slug))
            .then(function () { loadCategories(); })
            .catch(function (e) { alert('Failed: ' + e.message); });
        });
      });

      // Update category filter dropdown
      var filterSel = document.getElementById('admin-filter-cat');
      var cur = filterSel.value;
      filterSel.innerHTML = '<option value="">All categories</option>' +
        allCategories.map(function (c) {
          return '<option value="' + escapeHtml(c.slug) + '"' + (cur === c.slug ? ' selected' : '') + '>' + escapeHtml(c.label) + '</option>';
        }).join('');

      // Update drawer category select
      populateCatSelect(document.getElementById('d-category'));
    }).catch(function () {});
  }

  function populateCatSelect(sel, currentVal) {
    if (!sel) return;
    var val = currentVal !== undefined ? currentVal : sel.value;
    sel.innerHTML = allCategories.map(function (c) {
      return '<option value="' + escapeHtml(c.slug) + '"' + (val === c.slug ? ' selected' : '') + '>' + escapeHtml(c.label) + '</option>';
    }).join('');
  }

  // ─── Asset grid ───────────────────────────────────────────────────────────
  var assetGridEl = document.getElementById('admin-asset-grid');
  var searchEl = document.getElementById('admin-search');
  var filterCatEl = document.getElementById('admin-filter-cat');

  searchEl.addEventListener('input', renderAssets);
  filterCatEl.addEventListener('change', renderAssets);
  document.getElementById('add-asset-btn').addEventListener('click', function () { openDrawer(null); });

  function applyFilters(assets) {
    var q = searchEl.value.trim().toLowerCase();
    var cat = filterCatEl.value;
    return assets.filter(function (a) {
      if (cat && a.category !== cat) return false;
      if (!q) return true;
      var hay = [a.title, a.description, a.category].filter(Boolean).join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function renderAssetCard(asset) {
    var visible = asset.visible !== false;
    var variants = asset.variants || [];
    var cat = allCategories.find(function (c) { return c.slug === asset.category; });
    var catLabel = cat ? cat.label : (asset.category || '').toUpperCase();
    var variantNames = variants.slice(0, 3).map(function (v) { return v.name || '?'; }).join(' \xb7 ');
    if (variants.length > 3) variantNames += ' +' + (variants.length - 3);
    var thumbSrc = asset.thumbnailUrl ? '/api/thumbnail/' + encodeURIComponent(asset.id) : '';
    return (
      '<div class="adm-asset-card' + (visible ? '' : ' adm-asset-hidden') + '" data-id="' + escapeHtml(asset.id) + '">' +
        '<div class="adm-asset-thumb-wrap">' +
          (thumbSrc
            ? '<img class="adm-asset-thumb" src="' + escapeHtml(thumbSrc) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
            : '<div class="adm-asset-thumb-ph"></div>') +
        '</div>' +
        '<div class="adm-asset-body">' +
          '<div class="adm-asset-meta">' +
            '<span class="adm-asset-cat">' + escapeHtml(catLabel) + '</span>' +
            (variants.length ? '<span class="adm-asset-vcount">' + variants.length + ' variant' + (variants.length !== 1 ? 's' : '') + '</span>' : '') +
          '</div>' +
          '<div class="adm-asset-title">' + escapeHtml(asset.title || '(no title)') + '</div>' +
          (variantNames ? '<div class="adm-asset-variants">' + escapeHtml(variantNames) + '</div>' : '') +
        '</div>' +
        '<div class="adm-asset-actions">' +
          '<div class="admin-toggle-switch ' + (visible ? 'on' : '') + ' asset-toggle" data-id="' + escapeHtml(asset.id) + '" data-visible="' + visible + '" title="' + (visible ? 'Hide' : 'Show') + '"></div>' +
          '<button class="btn adm-edit-btn" data-id="' + escapeHtml(asset.id) + '">Edit</button>' +
          '<button class="btn adm-del-btn" data-id="' + escapeHtml(asset.id) + '">Delete</button>' +
        '</div>' +
      '</div>'
    );
  }

  function loadAssets() {
    api('GET', '/api/admin/downloads').then(function (data) {
      allAssets = Array.isArray(data) ? data : [];
      renderAssets();
    }).catch(function (e) {
      if (e.message === 'Unauthorized') showLogin();
    });
  }

  function renderAssets() {
    var filtered = applyFilters(allAssets);
    assetGridEl.innerHTML = filtered.length
      ? filtered.map(renderAssetCard).join('')
      : '<p class="adm-empty">No assets found. Click \u201c+ New Asset\u201d to add one.</p>';

    assetGridEl.querySelectorAll('.asset-toggle').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = this.getAttribute('data-id');
        var v = this.getAttribute('data-visible') === 'true';
        api('PATCH', '/api/admin/downloads/' + encodeURIComponent(id), { visible: !v })
          .then(function () { loadAssets(); })
          .catch(function (e) { alert('Failed: ' + e.message); });
      });
    });

    assetGridEl.querySelectorAll('.adm-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = this.getAttribute('data-id');
        var asset = allAssets.find(function (a) { return a.id === id; });
        if (asset) openDrawer(asset);
      });
    });

    assetGridEl.querySelectorAll('.adm-del-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = this.getAttribute('data-id');
        var asset = allAssets.find(function (a) { return a.id === id; });
        if (!asset || !confirm('Delete "' + (asset.title || 'this asset') + '"?')) return;
        api('DELETE', '/api/admin/downloads', { id: id })
          .then(function () { loadAssets(); })
          .catch(function (e) { alert('Failed: ' + e.message); });
      });
    });
  }

  // ─── Drawer ───────────────────────────────────────────────────────────────
  var drawerEl = document.getElementById('asset-drawer');
  var variantsList = document.getElementById('d-variants-list');
  var thumbZone = document.getElementById('d-thumb-zone');
  var thumbZoneLabel = document.getElementById('d-thumb-zone-label');
  var thumbInput = document.getElementById('d-thumb-input');
  var thumbPreview = document.getElementById('d-thumb-preview');
  var thumbImg = document.getElementById('d-thumb-img');
  var catSelect = document.getElementById('d-category');
  var ebookFields = document.getElementById('d-ebook-fields');
  var visibleToggle = document.getElementById('d-visible');

  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.getElementById('drawer-cancel').addEventListener('click', closeDrawer);
  document.getElementById('drawer-backdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawerEl.classList.contains('open')) closeDrawer();
  });

  catSelect.addEventListener('change', function () {
    if (ebookFields) ebookFields.hidden = catSelect.value !== 'ebook';
  });

  // Thumbnail upload
  thumbZone.addEventListener('click', function () { thumbInput.click(); });
  thumbZone.addEventListener('dragover', function (e) { e.preventDefault(); thumbZone.classList.add('drag-over'); });
  thumbZone.addEventListener('dragleave', function () { thumbZone.classList.remove('drag-over'); });
  thumbZone.addEventListener('drop', function (e) {
    e.preventDefault();
    thumbZone.classList.remove('drag-over');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleThumbFile(f);
  });
  thumbInput.addEventListener('change', function () {
    if (this.files && this.files[0]) handleThumbFile(this.files[0]);
  });
  document.getElementById('d-thumb-clear').addEventListener('click', function () {
    drawerThumbUrl = '';
    thumbPendingFile = null;
    thumbInput.value = '';
    thumbPreview.hidden = true;
    thumbZoneLabel.textContent = 'Click or drop image';
    thumbZone.classList.remove('has-file');
  });

  function handleThumbFile(file) {
    thumbPendingFile = file;
    thumbZoneLabel.textContent = file.name;
    thumbZone.classList.add('has-file');
    var reader = new FileReader();
    reader.onload = function (ev) {
      thumbImg.src = ev.target.result;
      thumbPreview.hidden = false;
    };
    reader.readAsDataURL(file);
  }

  // Visibility toggle
  visibleToggle.addEventListener('click', function () {
    drawerVisible = !drawerVisible;
    this.classList.toggle('on', drawerVisible);
    this.setAttribute('aria-checked', String(drawerVisible));
  });
  visibleToggle.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this.click(); }
  });

  // Add variant button
  document.getElementById('add-variant-btn').addEventListener('click', function () {
    drawerVariants.push({ id: null, name: '', resolution: '', fileSize: '', downloadUrl: '#', _file: null });
    renderVariantRows();
    var last = variantsList.lastElementChild;
    if (last) last.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  function renderVariantRows() {
    variantsList.innerHTML = '';
    drawerVariants.forEach(function (v, idx) {
      var row = document.createElement('div');
      row.className = 'adm-variant-row';
      row.dataset.idx = idx;

      var hasFile = v.downloadUrl && v.downloadUrl !== '#';
      var fileLabel = hasFile
        ? ((v.name || 'File') + (v.fileSize ? ' \xb7 ' + v.fileSize : ' (uploaded)'))
        : 'Click or drop to upload';

      row.innerHTML =
        '<div class="adm-vr-fields">' +
          '<div class="adm-vr-field">' +
            '<label>Name</label>' +
            '<input class="adm-vr-name" type="text" placeholder="e.g. Small" value="' + escapeHtml(v.name) + '">' +
          '</div>' +
          '<div class="adm-vr-field">' +
            '<label>Resolution</label>' +
            '<input class="adm-vr-res" type="text" placeholder="e.g. 640x959" value="' + escapeHtml(v.resolution) + '">' +
          '</div>' +
          '<div class="adm-vr-field adm-vr-file-field">' +
            '<label>File</label>' +
            '<div class="adm-vr-zone' + (hasFile ? ' has-file' : '') + '">' +
              '<span class="adm-vr-filename">' + escapeHtml(fileLabel) + '</span>' +
            '</div>' +
            '<input class="adm-vr-file" type="file" hidden>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="adm-vr-del" title="Remove variant" aria-label="Remove variant">\xd7</button>';

      variantsList.appendChild(row);

      var nameInput = row.querySelector('.adm-vr-name');
      var resInput = row.querySelector('.adm-vr-res');
      var fileInput = row.querySelector('.adm-vr-file');
      var zone = row.querySelector('.adm-vr-zone');
      var filenameEl = row.querySelector('.adm-vr-filename');
      var delBtn = row.querySelector('.adm-vr-del');

      nameInput.addEventListener('input', function () { drawerVariants[idx].name = this.value; });
      resInput.addEventListener('input', function () { drawerVariants[idx].resolution = this.value; });

      zone.addEventListener('click', function () { fileInput.click(); });
      zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', function () { zone.classList.remove('drag-over'); });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        zone.classList.remove('drag-over');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) { var fl = createDT(f); if (fl) fileInput.files = fl; handleVariantFile(idx, f, filenameEl, zone, resInput); }
      });
      fileInput.addEventListener('change', function () {
        if (this.files && this.files[0]) handleVariantFile(idx, this.files[0], filenameEl, zone, resInput);
      });

      delBtn.addEventListener('click', function () {
        drawerVariants.splice(idx, 1);
        renderVariantRows();
      });
    });
  }

  function handleVariantFile(idx, file, filenameEl, zone, resInput) {
    drawerVariants[idx]._file = file;
    var size = formatBytes(file.size);
    drawerVariants[idx].fileSize = size;
    zone.classList.add('has-file');
    filenameEl.textContent = file.name + ' \xb7 ' + size;

    // Auto-detect resolution for images
    if (file.type && file.type.startsWith('image/')) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        var img = new Image();
        img.onload = function () {
          var res = img.naturalWidth + 'x' + img.naturalHeight;
          if (!drawerVariants[idx].resolution) {
            drawerVariants[idx].resolution = res;
            resInput.value = res;
          }
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    }
  }

  function openDrawer(asset) {
    editingId = asset ? asset.id : null;
    document.getElementById('drawer-title').textContent = asset ? 'Edit Asset' : 'Add Asset';
    document.getElementById('d-id').value = asset ? asset.id : '';
    document.getElementById('d-title').value = asset ? (asset.title || '') : '';
    document.getElementById('d-desc').value = asset ? (asset.description || '') : '';
    document.getElementById('d-chapter').value = (asset && asset.chapter) ? asset.chapter : '';

    populateCatSelect(catSelect, asset ? asset.category : (allCategories[0] ? allCategories[0].slug : ''));
    if (ebookFields) ebookFields.hidden = catSelect.value !== 'ebook';

    // Thumbnail
    thumbPendingFile = null;
    thumbInput.value = '';
    drawerThumbUrl = asset ? (asset.thumbnailUrl || '') : '';
    if (drawerThumbUrl && asset) {
      thumbImg.src = '/api/thumbnail/' + encodeURIComponent(asset.id);
      thumbPreview.hidden = false;
      thumbZoneLabel.textContent = 'Change thumbnail';
      thumbZone.classList.add('has-file');
    } else {
      thumbPreview.hidden = true;
      thumbZoneLabel.textContent = 'Click or drop image';
      thumbZone.classList.remove('has-file');
    }

    // Visibility
    drawerVisible = asset ? (asset.visible !== false) : true;
    visibleToggle.classList.toggle('on', drawerVisible);
    visibleToggle.setAttribute('aria-checked', String(drawerVisible));

    // Variants
    drawerVariants = asset
      ? (asset.variants || []).map(function (v) {
          return { id: v.id, name: v.name || '', resolution: v.resolution || '', fileSize: v.fileSize || '', downloadUrl: v.downloadUrl || '#', _file: null };
        })
      : [];
    renderVariantRows();

    drawerEl.classList.add('open');
    drawerEl.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.getElementById('d-title').focus();
  }

  function closeDrawer() {
    drawerEl.classList.remove('open');
    drawerEl.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    editingId = null;
    drawerVariants = [];
    drawerThumbUrl = '';
    thumbPendingFile = null;
  }

  // ─── Save asset ───────────────────────────────────────────────────────────
  document.getElementById('drawer-save').addEventListener('click', function () {
    var saveBtn = this;
    var title = document.getElementById('d-title').value.trim();
    if (!title) { alert('Please enter a title.'); return; }

    saveBtn.disabled = true;
    var origLabel = saveBtn.textContent;
    saveBtn.textContent = 'Saving\u2026';

    // 1. Upload thumbnail if needed
    var thumbPromise = Promise.resolve(drawerThumbUrl || '');
    if (thumbPendingFile) {
      thumbPromise = apiUpload(thumbPendingFile).then(function (res) {
        thumbPendingFile = null;
        return res.thumbnailUrl || res.url || '';
      });
    }

    thumbPromise.then(function (thumbnailUrl) {
      // 2. Upload any variant files that need uploading
      var variantPromises = drawerVariants.map(function (v) {
        if (!v._file) return Promise.resolve(v);
        return apiUpload(v._file).then(function (res) {
          return Object.assign({}, v, {
            downloadUrl: res.url,
            fileSize: res.fileSize || v.fileSize || '',
            resolution: v.resolution || res.resolution || '',
            _file: null,
          });
        });
      });

      return Promise.all(variantPromises).then(function (variants) {
        var payload = {
          title: title,
          description: document.getElementById('d-desc').value.trim() || '',
          category: catSelect.value,
          thumbnailUrl: thumbnailUrl,
          visible: drawerVisible,
          tags: [],
          variants: variants.map(function (v) {
            return {
              id: v.id || undefined,
              name: v.name || 'Download',
              resolution: v.resolution || '',
              fileSize: v.fileSize || '',
              downloadUrl: v.downloadUrl || '#',
            };
          }),
        };
        if (catSelect.value === 'ebook') {
          var ch = document.getElementById('d-chapter').value;
          if (ch) payload.chapter = parseInt(ch, 10);
        }

        var req = editingId
          ? api('PATCH', '/api/admin/downloads/' + encodeURIComponent(editingId), payload)
          : api('POST', '/api/admin/downloads', payload);

        return req.then(function () {
          closeDrawer();
          loadAssets();
        });
      });
    }).catch(function (e) {
      alert('Failed: ' + (e.message || 'Unknown error'));
    }).finally(function () {
      saveBtn.disabled = false;
      saveBtn.textContent = origLabel;
    });
  });

})();
