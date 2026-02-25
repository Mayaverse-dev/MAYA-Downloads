(function () {
  'use strict';

  var pw = '';
  var STORAGE_KEY = 'maya_admin_pw';
  var CATEGORY_ORDER = ['wallpapers', 'ebook', 'stl'];

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
    var opts = { method: method, headers: {} };
    if (body && !(body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (body instanceof FormData) {
      opts.body = body;
    }
    if (usePw !== false) opts.headers['x-admin-password'] = getPw();
    return fetch(path, opts).then(function (r) {
      if (r.status === 401) throw new Error('Unauthorized');
      return r.json();
    });
  }

  function apiUpload(file, fieldName) {
    var fd = new FormData();
    fd.append(fieldName, file);
    fd.append('x-admin-password', getPw());
    return fetch('/api/admin/upload', {
      method: 'POST',
      headers: { 'x-admin-password': getPw() },
      body: (function () {
        var f = new FormData();
        f.append('file', file);
        return f;
      })()
    }).then(function (r) {
      if (r.status === 401) throw new Error('Unauthorized');
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || 'Upload failed'); });
      return r.json();
    });
  }

  var loginEl = document.getElementById('admin-login');
  var dashboardEl = document.getElementById('admin-dashboard');
  var listEl = document.getElementById('admin-list');
  var addForm = document.getElementById('add-form');
  var editModal = document.getElementById('edit-modal');
  var editForm = document.getElementById('edit-form');
  var searchEl = document.getElementById('admin-search');
  var filterCatEl = document.getElementById('admin-filter-cat');

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
    var value = (document.getElementById('admin-pw') || {}).value || '';
    if (!value) return alert('Enter password');
    setPw(value);
    api('GET', '/api/admin/downloads?pw=' + encodeURIComponent(value))
      .then(function () { showDashboard(); })
      .catch(function () { alert('Invalid password'); clearPw(); });
  });

  document.getElementById('logout-btn').addEventListener('click', function () {
    clearPw();
    showLogin();
    var inp = document.getElementById('admin-pw');
    if (inp) inp.value = '';
  });

  function escapeHtml(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function sortByHomepageOrder(list) {
    var order = {};
    CATEGORY_ORDER.forEach(function (c, i) { order[c] = i; });
    return list.slice().sort(function (a, b) {
      var ca = order[a.category] !== undefined ? order[a.category] : 99;
      var cb = order[b.category] !== undefined ? order[b.category] : 99;
      if (ca !== cb) return ca - cb;
      if (a.category === 'ebook' && b.category === 'ebook') return (a.chapter || 0) - (b.chapter || 0);
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
  }

  function groupedByCategory(list) {
    var sorted = sortByHomepageOrder(list);
    var groups = {};
    CATEGORY_ORDER.forEach(function (c) { groups[c] = []; });
    sorted.forEach(function (item) {
      if (groups[item.category]) groups[item.category].push(item);
      else { groups.other = groups.other || []; groups.other.push(item); }
    });
    if (groups.other && groups.other.length) sorted = CATEGORY_ORDER.concat(['other']);
    else sorted = CATEGORY_ORDER;
    return { order: sorted, groups: groups };
  }

  function renderItem(item) {
    var thumb = item.thumbnailUrl || '';
    if (thumb && thumb.startsWith('/')) thumb = window.location.origin + thumb;
    var meta = item.category;
    if (item.subtitle) meta += ' · ' + item.subtitle;
    if (item.type) meta += ' · ' + item.type;
    var size = item.fileSize ? ' · ' + item.fileSize : '';
    var visible = item.visible !== false;
    return (
      '<div class="admin-item" data-id="' + escapeHtml(item.id) + '">' +
        '<img class="admin-item-thumb" src="' + escapeHtml(thumb) + '" alt="" onerror="this.style.background=\'#262626\';this.src=\'\'">' +
        '<div class="admin-item-info">' +
          '<div class="admin-item-title">' + escapeHtml(item.title) + '</div>' +
          '<div class="admin-item-meta">' + escapeHtml(meta) + size + '</div>' +
        '</div>' +
        '<div class="admin-item-actions">' +
          '<span class="admin-item-visible">' + (visible ? 'Visible' : 'Hidden') + '</span>' +
          '<div class="admin-toggle-switch ' + (visible ? 'on' : '') + '" data-id="' + escapeHtml(item.id) + '" data-visible="' + visible + '" aria-label="Toggle visibility"></div>' +
          '<button type="button" class="btn edit-btn" data-id="' + escapeHtml(item.id) + '">Edit</button>' +
          '<button type="button" class="btn delete-btn" data-id="' + escapeHtml(item.id) + '">Delete</button>' +
        '</div>' +
      '</div>'
    );
  }

  var allAssetsList = [];
  function applyFilters(list) {
    var q = (searchEl && searchEl.value ? searchEl.value : '').trim().toLowerCase();
    var cat = (filterCatEl && filterCatEl.value ? filterCatEl.value : '').trim();
    return (list || []).filter(function (item) {
      if (cat && item.category !== cat) return false;
      if (!q) return true;
      var hay = [
        item.title, item.subtitle, item.description, item.category, item.type, item.resolution, item.format
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function loadList() {
    api('GET', '/api/admin/downloads')
      .then(function (data) {
        var list = Array.isArray(data) ? data : [];
        allAssetsList = list;
        var filtered = applyFilters(list);
        var g = groupedByCategory(filtered);
        var html = '';
        g.order.forEach(function (cat) {
          var items = (g.groups[cat] || []).map(renderItem).join('');
          if (!items) return;
          var label = cat === 'wallpapers' ? 'Wallpapers' : cat === 'ebook' ? 'E-Book' : cat === 'stl' ? '3D Printables (STL)' : cat;
          html += '<div class="admin-category-section">';
          html += '<h4 class="admin-category-title">' + escapeHtml(label) + '</h4>';
          html += '<div class="admin-list">' + items + '</div></div>';
        });
        listEl.innerHTML = html || '<p class="admin-item-meta">No assets yet.</p>';

        listEl.querySelectorAll('.admin-toggle-switch').forEach(function (el) {
          el.addEventListener('click', function () {
            var id = this.getAttribute('data-id');
            var visible = this.getAttribute('data-visible') === 'true';
            api('PATCH', '/api/admin/downloads/' + encodeURIComponent(id), { visible: !visible })
              .then(function (updated) {
                el.classList.toggle('on', updated.visible !== false);
                el.setAttribute('data-visible', updated.visible !== false ? 'true' : 'false');
                var meta = el.closest('.admin-item').querySelector('.admin-item-visible');
                if (meta) meta.textContent = (updated.visible !== false) ? 'Visible' : 'Hidden';
              })
              .catch(function (e) { alert('Failed: ' + (e.message || 'Unknown')); });
          });
        });
        listEl.querySelectorAll('.edit-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = this.getAttribute('data-id');
            var item = allAssetsList.find(function (i) { return i.id === id; });
            if (item) openEditModal(item);
          });
        });
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
      .catch(function () { showLogin(); });
  }

  if (searchEl) searchEl.addEventListener('input', function () { loadList(); });
  if (filterCatEl) filterCatEl.addEventListener('change', function () { loadList(); });

  var currentEditItem = null;
  function openEditModal(item) {
    currentEditItem = item;
    document.getElementById('edit-id').value = item.id;
    document.getElementById('edit-title').value = item.title || '';
    document.getElementById('edit-subtitle').value = item.subtitle || '';
    document.getElementById('edit-desc').value = item.description || '';
    document.getElementById('edit-category').value = item.category || 'wallpapers';
    document.getElementById('edit-type').value = item.type || 'desktop';
    document.getElementById('edit-resolution').value = item.resolution || '';
    document.getElementById('edit-chapter').value = item.chapter || '';
    document.getElementById('edit-format').value = item.format || 'PDF';
    document.getElementById('edit-filesize-display').textContent = item.fileSize || '—';
    document.getElementById('edit-visible-toggle').classList.toggle('on', item.visible !== false);
    document.getElementById('edit-file-input').value = '';
    document.getElementById('edit-thumb-input').value = '';
    document.getElementById('edit-upload-zone').textContent = 'Click or drop file to replace';
    document.getElementById('edit-upload-zone').classList.remove('has-file');
    document.getElementById('edit-thumb-zone').textContent = 'Click or drop image';
    document.getElementById('edit-thumb-zone').classList.remove('has-file');
    editModal.classList.add('open');
    editModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeEditModal() {
    editModal.classList.remove('open');
    editModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  document.getElementById('edit-modal-close').addEventListener('click', closeEditModal);
  editModal.addEventListener('click', function (e) {
    if (e.target === editModal) closeEditModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeEditModal();
  });

  editForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var id = document.getElementById('edit-id').value;
    var payload = {
      title: document.getElementById('edit-title').value,
      subtitle: document.getElementById('edit-subtitle').value || undefined,
      description: document.getElementById('edit-desc').value,
      category: document.getElementById('edit-category').value,
      type: document.getElementById('edit-type').value,
      resolution: document.getElementById('edit-resolution').value || undefined,
      chapter: document.getElementById('edit-chapter').value ? parseInt(document.getElementById('edit-chapter').value, 10) : undefined,
      format: document.getElementById('edit-format').value || undefined,
      visible: document.getElementById('edit-visible-toggle').classList.contains('on')
    };
    if (currentEditItem) {
      payload.downloadUrl = currentEditItem.downloadUrl;
      payload.fileSize = currentEditItem.fileSize;
      payload.thumbnailUrl = currentEditItem.thumbnailUrl;
    }
    var fileInput = document.getElementById('edit-file-input');
    var thumbInput = document.getElementById('edit-thumb-input');
    var saveBtn = editForm.querySelector('button[type="submit"]');
    var btnText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    var p = Promise.resolve();
    if (fileInput.files && fileInput.files[0]) {
      p = p.then(function () { return apiUpload(fileInput.files[0]); })
        .then(function (res) {
          payload.downloadUrl = res.url;
          payload.fileSize = res.fileSize;
          if (res.thumbnailUrl) payload.thumbnailUrl = res.thumbnailUrl;
          if (res.resolution && payload.category === 'wallpapers') payload.resolution = res.resolution;
        });
    }
    if (thumbInput.files && thumbInput.files[0]) {
      p = p.then(function () { return apiUpload(thumbInput.files[0]); })
        .then(function (res) {
          payload.thumbnailUrl = res.url;
        });
    }
    p.then(function () { return api('PATCH', '/api/admin/downloads/' + encodeURIComponent(id), payload); })
      .then(function () { closeEditModal(); currentEditItem = null; loadList(); })
      .catch(function (err) { alert('Failed: ' + (err.message || 'Unknown')); })
      .finally(function () {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = btnText; }
      });
  });

  // Add form: file upload zones
  var addFileInput = document.getElementById('add-file-input');
  var addThumbInput = document.getElementById('add-thumb-input');
  var addUploadZone = document.getElementById('add-upload-zone');
  var addThumbZone = document.getElementById('add-thumb-zone');
  addUploadZone.addEventListener('click', function () { addFileInput.click(); });
  addThumbZone.addEventListener('click', function () { addThumbInput.click(); });
  addFileInput.addEventListener('change', function () {
    if (this.files && this.files.length) {
      addUploadZone.textContent = (this.files.length === 1) ? this.files[0].name : (this.files.length + ' files selected');
    } else {
      addUploadZone.textContent = 'Click or drop file to upload';
    }
    addUploadZone.classList.toggle('has-file', !!(this.files && this.files.length));
  });
  addThumbInput.addEventListener('change', function () {
    if (this.files && this.files[0]) addThumbZone.textContent = this.files[0].name;
    addThumbZone.classList.toggle('has-file', !!(this.files && this.files[0]));
  });

  var editFileInput = document.getElementById('edit-file-input');
  var editThumbInput = document.getElementById('edit-thumb-input');
  var editUploadZone = document.getElementById('edit-upload-zone');
  var editThumbZone = document.getElementById('edit-thumb-zone');
  editUploadZone.addEventListener('click', function () { editFileInput.click(); });
  editThumbZone.addEventListener('click', function () { editThumbInput.click(); });
  editFileInput.addEventListener('change', function () {
    if (this.files && this.files[0]) editUploadZone.textContent = this.files[0].name;
    editUploadZone.classList.toggle('has-file', !!(this.files && this.files[0]));
  });
  editThumbInput.addEventListener('change', function () {
    if (this.files && this.files[0]) editThumbZone.textContent = this.files[0].name;
    editThumbZone.classList.toggle('has-file', !!(this.files && this.files[0]));
  });

  // Add form category visibility
  var categorySelect = document.getElementById('add-category');
  var wallpaperFields = document.getElementById('wallpaper-fields');
  var ebookFields = document.getElementById('ebook-fields');
  function updateAddVisibility() {
    var cat = categorySelect.value;
    if (wallpaperFields) wallpaperFields.hidden = (cat !== 'wallpapers');
    if (ebookFields) ebookFields.hidden = (cat !== 'ebook');
  }
  categorySelect.addEventListener('change', updateAddVisibility);
  updateAddVisibility();

  var editCategorySelect = document.getElementById('edit-category');
  var editWallpaperFields = document.getElementById('edit-wallpaper-fields');
  var editEbookFields = document.getElementById('edit-ebook-fields');
  function updateEditVisibility() {
    var cat = editCategorySelect.value;
    if (editWallpaperFields) editWallpaperFields.hidden = (cat !== 'wallpapers');
    if (editEbookFields) editEbookFields.hidden = (cat !== 'ebook');
  }
  editCategorySelect.addEventListener('change', updateEditVisibility);

  function setFileInputFiles(input, file) {
    if (!file || !input) return;
    try {
      var dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
    } catch (err) {}
  }
  function setupDropZone(zone, input, label) {
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', function () { zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('drag-over');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) {
        setFileInputFiles(input, f);
        zone.textContent = f.name;
        zone.classList.add('has-file');
      }
    });
  }
  setupDropZone(addUploadZone, addFileInput, 'Click or drop file to upload');
  setupDropZone(addThumbZone, addThumbInput, 'Click or drop image for thumbnail');
  setupDropZone(editUploadZone, editFileInput, 'Click or drop file to replace');
  setupDropZone(editThumbZone, editThumbInput, 'Click or drop image');

  addForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var title = (document.getElementById('add-title') || {}).value || '';
    var desc = (document.getElementById('add-desc') || {}).value || '';
    if (!title.trim()) { alert('Please enter a title.'); return; }
    if (!desc.trim()) { alert('Please enter a description.'); return; }
    if (!addFileInput.files || !addFileInput.files.length) {
      alert('Please choose a download file (click or drop on the upload area).');
      return;
    }
    var thumbFile = addThumbInput.files && addThumbInput.files[0] ? addThumbInput.files[0] : null;
    var category = document.getElementById('add-category').value;
    var basePayload = {
      title: document.getElementById('add-title').value,
      description: document.getElementById('add-desc').value,
      category: category,
      downloadUrl: '#',
      tags: []
    };
    if (category === 'ebook') {
      var ch = document.getElementById('add-chapter').value;
      if (ch) basePayload.chapter = parseInt(ch, 10);
      basePayload.format = document.getElementById('add-format').value || 'PDF';
    }
    var saveBtn = addForm.querySelector('button[type="submit"]');
    var btnText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    var files = Array.prototype.slice.call(addFileInput.files || []);

    function variantSubtitleFromFilename(filename) {
      var base = (filename || '').replace(/\.[^.]+$/, '').trim();
      var map = {
        'andriod': 'Android',
        'android': 'Android',
        'iphones': 'iPhone',
        'iphone': 'iPhone',
        'tablet': 'Tablet',
        'mackbook': 'Macbook',
        'macbook': 'Macbook',
        'ultrawide': 'Ultrawide',
        'standard hd': 'Standard HD',
        '4k ultra hd': '4K Ultra HD'
      };
      var key = base.toLowerCase().replace(/\s+/g, ' ').trim();
      return map[key] || base;
    }

    function wallpaperTypeFromSubtitle(subtitle) {
      var s = (subtitle || '').toLowerCase();
      if (s.indexOf('android') !== -1 || s.indexOf('iphone') !== -1 || s.indexOf('tablet') !== -1) return 'mobile';
      return 'desktop';
    }

    var overrideThumbPromise = thumbFile ? apiUpload(thumbFile).then(function (r) { return r.url; }) : Promise.resolve('');

    overrideThumbPromise
      .then(function (overrideThumbUrl) {
        // Wallpapers: batch upload variants (creates one item per file; public page groups by title)
        if (category === 'wallpapers' && files.length > 1) {
          var chain = Promise.resolve();
          files.forEach(function (file) {
            chain = chain
              .then(function () { return apiUpload(file); })
              .then(function (res) {
                var subtitle = variantSubtitleFromFilename(file.name);
                var payload = {
                  title: basePayload.title,
                  description: basePayload.description,
                  category: 'wallpapers',
                  tags: [],
                  subtitle: subtitle,
                  type: wallpaperTypeFromSubtitle(subtitle),
                  resolution: res.resolution || undefined,
                  downloadUrl: res.url,
                  fileSize: res.fileSize,
                  thumbnailUrl: overrideThumbUrl || res.thumbnailUrl || ''
                };
                return api('POST', '/api/admin/downloads', payload);
              });
          });
          return chain;
        }

        // Default: single upload
        return apiUpload(files[0]).then(function (res) {
          var payload = Object.assign({}, basePayload);
          payload.downloadUrl = res.url;
          payload.fileSize = res.fileSize;
          payload.thumbnailUrl = overrideThumbUrl || res.thumbnailUrl || '';
          if (category === 'wallpapers') {
            payload.type = document.getElementById('add-type').value;
            payload.subtitle = payload.type ? payload.type.charAt(0).toUpperCase() + payload.type.slice(1) : undefined;
            payload.resolution = res.resolution || document.getElementById('add-resolution').value || undefined;
          }
          return api('POST', '/api/admin/downloads', payload);
        });
      })
      .then(function () {
        addForm.reset();
        addUploadZone.textContent = 'Click or drop file to upload';
        addThumbZone.textContent = 'Click or drop image for thumbnail';
        addUploadZone.classList.remove('has-file');
        addThumbZone.classList.remove('has-file');
        updateAddVisibility();
        loadList();
      })
      .catch(function (err) { alert('Failed: ' + (err.message || 'Unknown')); })
      .finally(function () {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = btnText; }
      });
  });

  if (getPw()) {
    api('GET', '/api/admin/downloads').then(function () { showDashboard(); }).catch(showLogin);
  }
})();
