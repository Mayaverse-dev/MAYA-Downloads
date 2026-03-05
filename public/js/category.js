(function () {
  'use strict';

  var body = document.body;
  var category = body.getAttribute('data-category') || '';
  if (!category) {
    var parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === 'c') category = parts[1];
  }
  var pageTitle = body.getAttribute('data-title') || category;
  var pageDesc = body.getAttribute('data-desc') || '';
  if (category && !body.getAttribute('data-title')) {
    fetch('/api/categories').then(function (r) { return r.json(); }).then(function (cats) {
      var cat = cats.find(function (c) { return c.slug === category; });
      if (cat) {
        pageTitle = cat.label;
        pageDesc = cat.desc || '';
        var titleEl = document.getElementById('page-title');
        var descEl = document.getElementById('page-desc');
        if (titleEl) titleEl.textContent = pageTitle;
        if (descEl) descEl.textContent = pageDesc;
        document.title = pageTitle + ' | MAYA Downloads';
        body.setAttribute('data-title', pageTitle);
        body.setAttribute('data-desc', pageDesc);
      }
    }).catch(function () {});
  }

  var list = [];
  var assetsById = {};

  function escapeHtml(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function thumbUrl(asset) {
    if (!asset || !asset.thumbnailUrl || asset.thumbnailUrl === '#') return '';
    if (asset.id) return '/api/thumbnail/' + encodeURIComponent(asset.id);
    return asset.thumbnailUrl;
  }

  function isPlaceholderUrl(url) {
    return !url || url === '#' || url.indexOf('example.com') !== -1;
  }

  function hasDownload(asset) {
    return (asset.variants || []).some(function (v) { return !isPlaceholderUrl(v.downloadUrl); });
  }

  function firstDownloadableVariant(asset) {
    return (asset.variants || []).find(function (v) { return !isPlaceholderUrl(v.downloadUrl); });
  }

  function renderCard(asset) {
    var badge = '';
    if (asset.category === 'wallpapers') badge = 'WALLPAPER';
    else if (asset.category === 'ebook') {
      badge = asset.chapter ? 'CH. ' + asset.chapter : 'EBOOK';
      if (asset.format) badge += ' \xb7 ' + asset.format;
    } else if (asset.category === 'stl') {
      badge = 'STL';
    } else {
      badge = (asset.category || '').toUpperCase();
    }

    var thumb = thumbUrl(asset);
    assetsById[asset.id] = asset;

    var variants = asset.variants || [];
    var downloadableVariants = variants.filter(function (v) { return !isPlaceholderUrl(v.downloadUrl); });
    var hasMulti = downloadableVariants.length > 1;
    var v1 = firstDownloadableVariant(asset);
    var actionsHtml;

    if (!hasDownload(asset)) {
      actionsHtml = '<span class="btn no-url">Coming Soon</span>';
    } else if (hasMulti) {
      actionsHtml = '<button type="button" class="btn btn-primary asset-open">Download (' + downloadableVariants.length + ')</button>';
    } else if (v1) {
      var href = '/api/download/' + encodeURIComponent(v1.id);
      var btnLabel = 'Download';
      if (v1.fileSize) btnLabel += ' \xb7 ' + v1.fileSize;
      actionsHtml = '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener" class="btn btn-primary">' + escapeHtml(btnLabel) + '</a>';
    } else {
      actionsHtml = '<span class="btn no-url">Coming Soon</span>';
    }

    return (
      '<article class="card card-preview" data-id="' + escapeHtml(asset.id) + '">' +
        '<img class="card-thumb" src="' + escapeHtml(thumb) + '" alt="" loading="lazy" onerror="this.style.background=\'#1f1f1f\';this.alt=\'Preview\'">' +
        '<div class="card-body">' +
          '<span class="card-badge">' + escapeHtml(badge) + '</span>' +
          '<h3 class="card-title">' + escapeHtml(asset.title) + '</h3>' +
          '<p class="card-desc">' + escapeHtml(asset.description || '') + '</p>' +
          '<div class="card-actions">' + actionsHtml + '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function render() {
    var grid = document.getElementById('card-grid');
    var emptyMsg = document.getElementById('empty-msg');
    var downloadAllBtn = document.getElementById('download-all-btn');
    var filtersEl = document.getElementById('filters');

    if (list.length === 0) {
      grid.innerHTML = '';
      if (emptyMsg) emptyMsg.hidden = false;
      if (downloadAllBtn) downloadAllBtn.hidden = true;
      return;
    }

    if (emptyMsg) emptyMsg.hidden = true;
    if (downloadAllBtn) {
      downloadAllBtn.hidden = false;
      downloadAllBtn.textContent = 'Download All (' + list.length + ')';
    }
    if (filtersEl) filtersEl.hidden = true;
    grid.innerHTML = list.map(renderCard).join('');
  }

  function openModal(asset) {
    var modal = document.getElementById('modal');
    var img = document.getElementById('modal-img');
    var titleEl = document.getElementById('modal-title');
    var descEl = document.getElementById('modal-desc');
    var downloadsEl = document.getElementById('modal-downloads');
    if (!modal || !img) return;

    img.src = thumbUrl(asset);
    img.alt = asset.title || 'Preview';
    titleEl.textContent = asset.title || '';
    descEl.textContent = asset.description || '';

    var variants = (asset.variants || []).filter(function (v) { return v && v.id && !isPlaceholderUrl(v.downloadUrl); });

    if (variants.length === 0) {
      downloadsEl.innerHTML = '<button type="button" class="no-url">Coming Soon</button>';
    } else if (variants.length === 1) {
      var v = variants[0];
      var href = '/api/download/' + encodeURIComponent(v.id);
      var lbl = 'Download';
      if (v.fileSize) lbl += ' \xb7 ' + v.fileSize;
      downloadsEl.innerHTML = '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener" class="btn btn-primary" style="width:100%;justify-content:center;">' + escapeHtml(lbl) + '</a>';
    } else {
      // Each variant gets its own download button (matches screenshot)
      downloadsEl.innerHTML =
        '<div class="wp-variants">' +
          variants.map(function (v) {
            var label = v.name || 'Download';
            if (v.resolution) label += ' (' + v.resolution.replace('x', ' \xd7 ') + ')';
            var href = '/api/download/' + encodeURIComponent(v.id);
            var size = v.fileSize || '';
            return (
              '<div class="wp-variant-row">' +
                '<div class="wp-variant-info">' +
                  '<span class="wp-variant-name">' + escapeHtml(label) + '</span>' +
                  (size ? '<span class="wp-variant-size">' + escapeHtml(size) + '</span>' : '') +
                '</div>' +
                '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener" class="btn btn-primary wp-variant-dl">Download free</a>' +
              '</div>'
            );
          }).join('') +
        '</div>';
    }

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    var modal = document.getElementById('modal');
    if (modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }
  }

  function handleDownloadAll() {
    var assets = list.filter(function (a) { return hasDownload(a); });
    if (assets.length === 0) return;
    var btn = document.getElementById('download-all-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing zip\u2026'; }
    fetch('/api/download-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: assets.map(function (a) { return a.id; }) })
    })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status === 503 ? 'Downloads unavailable' : 'Failed to create zip');
        return r.blob();
      })
      .then(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'maya-' + category + '.zip';
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(function (err) { alert(err.message || 'Download failed'); })
      .finally(function () {
        if (btn) { btn.disabled = false; btn.textContent = 'Download All (' + list.length + ')'; }
      });
  }

  function init() {
    var titleEl = document.getElementById('page-title');
    var descEl = document.getElementById('page-desc');
    if (titleEl) titleEl.textContent = pageTitle;
    if (descEl) descEl.textContent = pageDesc;

    fetch('/api/downloads')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        list = Array.isArray(data) ? data.filter(function (i) { return i.category === category; }) : [];
        if (category === 'ebook') list.sort(function (a, b) { return (a.chapter || 0) - (b.chapter || 0); });
        render();
      })
      .catch(function () { list = []; render(); });

    document.getElementById('card-grid').addEventListener('click', function (e) {
      var card = e.target.closest('.card-preview');
      if (!card) return;
      var isDirectLink = e.target.matches('a[href]') && !e.target.classList.contains('asset-open');
      if (isDirectLink) return; // let the browser handle direct download links
      var id = card.getAttribute('data-id');
      var asset = id && assetsById[id];
      if (!asset) return;
      openModal(asset);
    });

    var modalClose = document.getElementById('modal-close');
    if (modalClose) modalClose.addEventListener('click', closeModal);

    document.getElementById('modal').addEventListener('click', function (e) {
      if (e.target === this) closeModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });

    var downloadAllBtn = document.getElementById('download-all-btn');
    if (downloadAllBtn) downloadAllBtn.addEventListener('click', handleDownloadAll);
  }

  init();
})();
