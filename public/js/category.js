(function () {
  'use strict';

  var body = document.body;
  var category = body.getAttribute('data-category') || '';
  // For custom category pages served at /c/:slug, derive slug from URL
  if (!category) {
    var parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === 'c') category = parts[1];
  }
  var pageTitle = body.getAttribute('data-title') || category;
  var pageDesc = body.getAttribute('data-desc') || '';
  // If no title set (generic category-page.html), pull from /api/categories
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
  var itemsById = {};
  var wallpaperGroupsById = {};
  var wallpaperGroups = [];

  function escapeHtml(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function thumbUrl(itemOrUrl) {
    if (!itemOrUrl) return '';
    var item = itemOrUrl && itemOrUrl.id != null ? itemOrUrl : null;
    var url = item ? item.thumbnailUrl : itemOrUrl;
    if (!url || url === '#') return '';
    if (item && item.id) return '/api/thumbnail/' + encodeURIComponent(item.id);
    if (url.startsWith('/') && !url.startsWith('//')) return window.location.origin + url;
    return url;
  }

  function isPlaceholderUrl(url) {
    return !url || url === '#' || url.indexOf('example.com') !== -1;
  }

  function normalizeWallpaperTitle(title) {
    var t = (title || '').trim();
    // Group "Rakshasi (2)" with "Rakshasi"
    t = t.replace(/\s*\(\d+\)\s*$/, '').trim();
    return t;
  }

  function fileFormat(url) {
    try {
      var u = url.split('?')[0];
      var ext = (u.split('.').pop() || '').toUpperCase();
      if (!ext || ext.length > 6) return 'FILE';
      if (ext === 'JPEG') return 'JPG';
      return ext;
    } catch (e) {
      return 'FILE';
    }
  }

  function variantLabel(item) {
    // Prefer subtitle; otherwise fall back to type/resolution
    if (item.subtitle) return item.subtitle;
    if (item.type) return item.type.charAt(0).toUpperCase() + item.type.slice(1);
    if (item.resolution) return item.resolution;
    return 'Download';
  }

  function renderCard(item) {
    // Badge: show type for wallpapers, format for ebook, STL for 3D files
    var badge = '';
    if (item.category === 'wallpapers') {
      badge = (item.type || 'wallpaper').toUpperCase();
      if (item.resolution) badge += ' · ' + item.resolution;
    } else if (item.category === 'ebook') {
      badge = item.chapter ? 'CH. ' + item.chapter : 'EBOOK';
      if (item.format) badge += ' · ' + item.format;
    } else if (item.category === 'stl') {
      badge = 'STL';
    }

    var thumb = thumbUrl(item);
    itemsById[item.id] = item;

    // Single download button
    var isPh = isPlaceholderUrl(item.downloadUrl);
    var btnLabel = 'Download';
    if (item.fileSize) btnLabel += ' · ' + item.fileSize;
    
    var downloadHref = isPh ? '' : ('/api/download/' + encodeURIComponent(item.id));
    var actionsHtml = isPh
      ? '<span class="btn no-url">Coming Soon</span>'
      : '<a href="' + escapeHtml(downloadHref) + '" target="_blank" rel="noopener" class="btn btn-primary">' + escapeHtml(btnLabel) + '</a>';

    // Title with subtitle (e.g., "MAYA Crimson Horizon · Mobile")
    var displayTitle = item.title;
    if (item.subtitle) displayTitle += ' <span class="card-subtitle">· ' + escapeHtml(item.subtitle) + '</span>';

    return (
      '<article class="card card-preview" data-id="' + escapeHtml(item.id) + '">' +
        '<img class="card-thumb" src="' + escapeHtml(thumb) + '" alt="" loading="lazy" onerror="this.style.background=\'#1f1f1f\'; this.alt=\'Preview\'">' +
        '<div class="card-body">' +
          '<span class="card-badge">' + escapeHtml(badge) + '</span>' +
          '<h3 class="card-title">' + displayTitle + '</h3>' +
          '<p class="card-desc">' + escapeHtml(item.description || '') + '</p>' +
          '<div class="card-actions">' + actionsHtml + '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function buildWallpaperGroups(items) {
    var byKey = {};
    items.forEach(function (it) {
      var key = normalizeWallpaperTitle(it.title);
      if (!key) return;
      byKey[key] = byKey[key] || [];
      byKey[key].push(it);
    });

    var groups = Object.keys(byKey).map(function (k) {
      var variants = byKey[k].slice().filter(function (v) { return v && v.id; });
      // Prefer a desktop thumb if available
      variants.sort(function (a, b) {
        var ap = (a.type === 'desktop') ? 0 : 1;
        var bp = (b.type === 'desktop') ? 0 : 1;
        return ap - bp;
      });
      var primary = variants[0];
      var id = 'wp-set-' + k.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      return {
        id: id,
        title: k,
        description: (primary && primary.description) || '',
        primary: primary,
        variants: variants
      };
    });

    // Stable, nice order
    groups.sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });
    wallpaperGroupsById = {};
    groups.forEach(function (g) { wallpaperGroupsById[g.id] = g; });
    return groups;
  }

  function renderWallpaperCard(group) {
    var primary = group.primary || group.variants[0];
    var thumb = primary ? thumbUrl(primary) : '';
    var badge = 'WALLPAPER';
    var count = group.variants.length;
    var actionsHtml = '<button type="button" class="btn btn-primary wallpaper-open">Download' + (count > 1 ? ' (' + count + ')' : '') + '</button>';
    return (
      '<article class="card card-preview card-wallpaper-set" data-id="' + escapeHtml(group.id) + '">' +
        '<img class="card-thumb" src="' + escapeHtml(thumb) + '" alt="" loading="lazy" onerror="this.style.background=\'#1f1f1f\'; this.alt=\'Preview\'">' +
        '<div class="card-body">' +
          '<span class="card-badge">' + escapeHtml(badge) + '</span>' +
          '<h3 class="card-title">' + escapeHtml(group.title) + '</h3>' +
          '<p class="card-desc">' + escapeHtml(group.description || '') + '</p>' +
          '<div class="card-actions">' + actionsHtml + '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function render() {
    var filtered = list;
    var grid = document.getElementById('card-grid');
    var emptyMsg = document.getElementById('empty-msg');
    var downloadAllBtn = document.getElementById('download-all-btn');
    var filtersEl = document.getElementById('filters');

    if (filtered.length === 0) {
      grid.innerHTML = '';
      if (emptyMsg) emptyMsg.hidden = false;
      if (downloadAllBtn) downloadAllBtn.hidden = true;
      return;
    }

    if (emptyMsg) emptyMsg.hidden = true;
    if (downloadAllBtn) {
      downloadAllBtn.hidden = false;
      // For wallpapers we still download all underlying variants
      downloadAllBtn.textContent = 'Download All (' + filtered.length + ')';
    }

    if (filtersEl) filtersEl.hidden = true;

    if (category === 'wallpapers') {
      wallpaperGroups = buildWallpaperGroups(filtered);
      grid.innerHTML = wallpaperGroups.map(renderWallpaperCard).join('');
    } else {
      grid.innerHTML = filtered.map(renderCard).join('');
    }
  }

  function openModal(itemOrGroup) {
    var modal = document.getElementById('modal');
    var img = document.getElementById('modal-img');
    var titleEl = document.getElementById('modal-title');
    var descEl = document.getElementById('modal-desc');
    var downloadsEl = document.getElementById('modal-downloads');

    if (!modal || !img) return;

    if (category === 'wallpapers') {
      var group = itemOrGroup;
      var primary = group.primary || group.variants[0];
      img.src = primary ? thumbUrl(primary) : '';
      img.alt = group.title || 'Preview';
      titleEl.textContent = group.title || 'Wallpaper';
      descEl.textContent = group.description || '';

      var variants = (group.variants || []).filter(function (v) { return v && v.id && !isPlaceholderUrl(v.downloadUrl); });
      if (variants.length === 0) {
        downloadsEl.innerHTML = '<button type=\"button\" class=\"no-url\">Coming Soon</button>';
      } else {
        // Default to the first variant
        var first = variants[0];
        var href = '/api/download/' + encodeURIComponent(first.id);
        var btnText = 'Download';
        if (first.resolution) btnText += ' · ' + first.resolution;
        downloadsEl.innerHTML =
          '<div class=\"wp-download-wrap\">' +
            '<a id=\"wp-download-btn\" class=\"btn btn-primary\" href=\"' + escapeHtml(href) + '\" target=\"_blank\" rel=\"noopener\">' + escapeHtml(btnText) + '</a>' +
            '<div class=\"wp-variants\" role=\"radiogroup\" aria-label=\"Choose wallpaper size\">' +
              variants.map(function (v, idx) {
                var label = variantLabel(v);
                var fmt = fileFormat(v.downloadUrl);
                var size = v.fileSize || '';
                var reso = v.resolution || label;
                return (
                  '<label class="wp-variant" data-id="' + escapeHtml(v.id) + '">' +
                    '<input type="radio" name="wp-variant" ' + (idx === 0 ? 'checked' : '') + '>' +
                    '<span class="wp-variant-left"><span class="wp-variant-res">' + escapeHtml(reso) + '</span></span>' +
                    '<span class="wp-variant-mid">' + escapeHtml(fmt) + '</span>' +
                    '<span class="wp-variant-right">' + escapeHtml(size) + '</span>' +
                  '</label>'
                );
              }).join('') +
            '</div>' +
          '</div>';

        downloadsEl.querySelectorAll('.wp-variant').forEach(function (row) {
          row.addEventListener('click', function () {
            var vid = row.getAttribute('data-id');
            var v = variants.find(function (x) { return x.id === vid; });
            var btn = document.getElementById('wp-download-btn');
            if (!v || !btn) return;
            btn.href = '/api/download/' + encodeURIComponent(v.id);
            var t = 'Download';
            if (v.resolution) t += ' · ' + v.resolution;
            btn.textContent = t;
            var input = row.querySelector('input[type=\"radio\"]');
            if (input) input.checked = true;
            if (v.thumbnailUrl && v.thumbnailUrl !== '#' && img) {
              img.src = thumbUrl(v);
            }
          });
        });
      }
    } else {
      var item = itemOrGroup;
      img.src = thumbUrl(item);
      img.alt = item.title || 'Preview';

      var modalTitle = item.title;
      if (item.subtitle) modalTitle += ' · ' + item.subtitle;
      titleEl.textContent = modalTitle;
      descEl.textContent = item.description || '';

      // Single download button in modal
      var isPh = isPlaceholderUrl(item.downloadUrl);
      var btnLabel = 'Download';
      if (item.fileSize) btnLabel += ' · ' + item.fileSize;
      if (item.resolution) btnLabel += ' · ' + item.resolution;

      if (isPh) {
        downloadsEl.innerHTML = '<button type=\"button\" class=\"no-url\">Coming Soon</button>';
      } else {
        var modalHref = '/api/download/' + encodeURIComponent(item.id);
        downloadsEl.innerHTML = '<a href=\"' + escapeHtml(modalHref) + '\" target=\"_blank\" rel=\"noopener\">' + escapeHtml(btnLabel) + '</a>';
      }
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
    var filtered = list;
    var items = filtered.filter(function (item) { return !isPlaceholderUrl(item.downloadUrl); });
    if (items.length === 0) return;
    var btn = document.getElementById('download-all-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Preparing zip…';
    }
    fetch('/api/download-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: items.map(function (i) { return i.id; }) })
    })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status === 503 ? 'Downloads unavailable' : 'Failed to create zip');
        return r.blob();
      })
      .then(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'maya-' + (filtered[0] && filtered[0].category) + '.zip';
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(function (err) {
        alert(err.message || 'Download failed');
      })
      .finally(function () {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Download All (' + filtered.length + ')';
        }
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
      .catch(function () {
        list = [];
        render();
      });

    document.getElementById('card-grid').addEventListener('click', function (e) {
      var card = e.target.closest('.card-preview');
      if (!card) return;
      var id = card.getAttribute('data-id');
      if (category === 'wallpapers') {
        var group = id && wallpaperGroupsById[id];
        if (group) openModal(group);
      } else {
        if (e.target.matches('a[href], .btn') && !e.target.classList.contains('no-url')) return;
        if (e.target.closest('.card-actions')) return;
        var item = id && itemsById[id];
        if (item) openModal(item);
      }
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

    // Wallpaper filtering is handled via the download modal.
  }

  init();
})();
