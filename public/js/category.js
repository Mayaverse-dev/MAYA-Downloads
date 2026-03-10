(function () {
  'use strict';

  var body = document.body;
  var category = body.getAttribute('data-category') || '';
  if (!category) {
    var parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === 'c') category = parts[1];
    else if (parts.length >= 1 && (parts[0] === 'wallpapers' || parts[0] === 'ebook' || parts[0] === 'stl')) category = parts[0];
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
  var unlockProgress = {
    totalDownloads: 0,
    hasActiveGoal: false,
    nextThreshold: null,
    downloadsToNext: 0,
    progressPct: 0,
    nextAsset: null
  };

  function escapeHtml(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function thumbUrl(asset) {
    if (!asset || !asset.thumbnailUrl || asset.thumbnailUrl === '#') return '';
    if (/^https?:\/\//i.test(asset.thumbnailUrl)) return asset.thumbnailUrl;
    if (asset.id) return '/api/thumbnail/' + encodeURIComponent(asset.id);
    return asset.thumbnailUrl || '';
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

  function onImageFallbackError(img) {
    if (!img || !img.dataset) return;
    if (img.dataset.fallback && img.src !== img.dataset.fallback) {
      img.src = img.dataset.fallback;
      return;
    }
    img.style.background = '#1f1f1f';
    img.alt = 'Preview';
  }

  function sortByUnlockOrder(items) {
    return (items || []).slice().sort(function (a, b) {
      var ta = Number(a.unlockThreshold || 0);
      var tb = Number(b.unlockThreshold || 0);
      if (ta !== tb) return ta - tb;
      var ca = String(a.createdAt || '');
      var cb = String(b.createdAt || '');
      if (ca !== cb) return ca < cb ? -1 : 1;
      return String(a.title || '').localeCompare(String(b.title || ''));
    });
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
    var isLocked = asset.isLocked === true;
    var unlockThreshold = Number(asset.unlockThreshold || 0);
    var downloadsRemaining = Number(asset.downloadsRemaining || 0);
    assetsById[asset.id] = asset;

    var variants = asset.variants || [];
    var downloadableVariants = variants.filter(function (v) { return !isPlaceholderUrl(v.downloadUrl); });
    var hasMulti = downloadableVariants.length > 1;
    var v1 = firstDownloadableVariant(asset);
    var actionsHtml;

    if (isLocked && unlockThreshold > 0) {
      actionsHtml = '<button type="button" class="btn asset-help-unlock">Help unlock</button>';
    } else if (!hasDownload(asset)) {
      actionsHtml = '<span class="btn no-url">Coming Soon</span>';
    } else if (hasMulti) {
      actionsHtml = '<button type="button" class="btn btn-primary asset-open">Download (' + downloadableVariants.length + ')</button>';
    } else if (v1) {
      var href = '/api/download/' + encodeURIComponent(v1.id);
      var btnLabel = 'Download';
      if (v1.fileSize) btnLabel += ' \xb7 ' + v1.fileSize;
      actionsHtml = '<a href="' + escapeHtml(href) + '" class="btn btn-primary">' + escapeHtml(btnLabel) + '</a>';
    } else {
      actionsHtml = '<span class="btn no-url">Coming Soon</span>';
    }

    return (
      '<article class="card card-preview' + (isLocked ? ' card-locked' : '') + '" data-id="' + escapeHtml(asset.id) + '">' +
        '<div class="card-thumb-wrap">' +
          '<img class="card-thumb" src="' + escapeHtml(thumb) + '" data-fallback="/api/thumbnail/' + escapeHtml(encodeURIComponent(asset.id)) + '" alt="" loading="lazy">' +
          (isLocked
            ? '<div class="card-lock-overlay"><span class="card-lock-badge">🔒 Locked giveaway</span></div>'
            : '') +
        '</div>' +
        '<div class="card-body">' +
          '<span class="card-badge">' + escapeHtml(isLocked && unlockThreshold > 0 ? ('Unlocks @ ' + unlockThreshold) : badge) + '</span>' +
          '<h3 class="card-title">' + escapeHtml(asset.title) + '</h3>' +
          '<p class="card-desc">' + (
            isLocked && unlockThreshold > 0
              ? ('<span class="card-lock-remaining">' + escapeHtml(String(downloadsRemaining)) + ' more to unlock</span>')
              : escapeHtml(asset.description || '')
          ) + '</p>' +
          '<div class="card-actions">' + actionsHtml + '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderUnlockProgress() {
    var strip = document.getElementById('unlock-progress');
    if (!strip) return;
    if (!unlockProgress || !unlockProgress.hasActiveGoal || !unlockProgress.nextAsset) {
      strip.hidden = true;
      return;
    }
    strip.hidden = false;
    var nextCardEl = document.getElementById('unlock-next-card');
    if (nextCardEl) {
      var next = unlockProgress.nextAsset;
      var nextThumb = thumbUrl(next);
      var nextTitle = next.title || 'next reward';
      var nextThreshold = Number(unlockProgress.nextThreshold || 0);
      var toGo = Number(unlockProgress.downloadsToNext || 0);
      var hiResPreview = next && next.id ? ('/api/preview-image/' + encodeURIComponent(next.id)) : nextThumb;
      nextCardEl.hidden = false;
      nextCardEl.innerHTML =
        '<div class="gm-shell">' +
          '<div class="gm-card">' +
            '<div class="gm-head">' +
              '<div>' +
                '<div class="gm-label">Community Mission</div>' +
                '<div class="gm-status">Live Progress</div>' +
              '</div>' +
              '<div class="gm-head-copy">' +
                '<div class="gm-head-copy-title">Unlock <span class="accent">' + escapeHtml(nextTitle) + '</span> at <span class="accent">' + escapeHtml(String(nextThreshold)) + '</span> downloads. <span class="accent">' + escapeHtml(String(toGo)) + '</span> more to go.</div>' +
                '<div class="gm-head-copy-sub">Each download pushes the community closer to the next unlock. </div>' +
              '</div>' +
            '</div>' +
            '<div class="gm-main">' +
              '<section class="gm-content">' +
                '<div class="gm-media">' +
                  '<img class="gm-thumb" src="' + escapeHtml(hiResPreview) + '" data-fallback="' + escapeHtml(nextThumb || ('/api/thumbnail/' + encodeURIComponent(next.id || ''))) + '" alt="" loading="lazy">' +
                '</div>' +
                '<div class="gm-progress-panel">' +
                  '<div class="gm-progress-head">' +
                    '<span class="gm-progress-label">Mission Progress</span>' +
                    '<span class="gm-progress-value">' + escapeHtml(String(unlockProgress.totalDownloads || 0)) + ' / ' + escapeHtml(String(unlockProgress.nextThreshold || 0)) + '</span>' +
                  '</div>' +
                  '<div class="gm-meter">' +
                    '<div class="gm-fill" style="width:' + String(unlockProgress.progressPct || 0) + '%"></div>' +
                  '</div>' +
                  '<div class="gm-progress-foot">' +
                    '<span>Target: ' + escapeHtml(String(unlockProgress.nextThreshold || 0)) + ' downloads</span>' +
                    '<span class="gm-pct">' + escapeHtml(String(Math.round(unlockProgress.progressPct || 0))) + '%</span>' +
                  '</div>' +
                '</div>' +
              '</section>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '';
    }
  }

  function render() {
    var grid = document.getElementById('card-grid');
    var emptyMsg = document.getElementById('empty-msg');

    if (list.length === 0) {
      grid.innerHTML = '';
      if (emptyMsg) emptyMsg.hidden = false;
      return;
    }

    if (emptyMsg) emptyMsg.hidden = true;
    grid.innerHTML = list.map(renderCard).join('');
  }

  function openModal(asset) {
    if (asset && asset.isLocked) {
      openUnlockModal(asset);
      return;
    }
    var modal = document.getElementById('modal');
    var img = document.getElementById('modal-img');
    var titleEl = document.getElementById('modal-title');
    var descEl = document.getElementById('modal-desc');
    var downloadsEl = document.getElementById('modal-downloads');
    if (!modal || !img) return;

    img.src = thumbUrl(asset);
    img.dataset.fallback = '/api/thumbnail/' + encodeURIComponent(asset.id || '');
    img.onerror = function () { onImageFallbackError(this); };
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
      downloadsEl.innerHTML = '<a href="' + escapeHtml(href) + '" class="btn btn-primary" style="width:100%;justify-content:center;">' + escapeHtml(lbl) + '</a>';
    } else {
      // Each variant gets its own download button (matches screenshot)
      downloadsEl.innerHTML =
        '<div class="wp-variants">' +
          variants.map(function (v) {
            var href = '/api/download/' + encodeURIComponent(v.id);
            var name = v.name || 'Download';
            var res = v.resolution ? v.resolution.replace('x', '\u00d7') : '';
            var size = v.fileSize || '';
            return (
              '<div class="wp-variant-row">' +
                '<div class="wp-variant-info">' +
                  '<span class="wp-variant-name">' + escapeHtml(name) + '</span>' +
                  (res || size
                    ? '<span class="wp-variant-meta">' +
                        (res ? '<span class="wp-variant-res">' + escapeHtml(res) + '</span>' : '') +
                        (res && size ? '<span class="wp-variant-dot">\xb7</span>' : '') +
                        (size ? '<span class="wp-variant-size">' + escapeHtml(size) + '</span>' : '') +
                      '</span>'
                    : '') +
                '</div>' +
                '<a href="' + escapeHtml(href) + '" class="wp-variant-dl">↓ Download</a>' +
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

  function openUnlockModal(asset) {
    var modal = document.getElementById('unlock-modal');
    if (!modal) return;
    var titleEl = document.getElementById('unlock-modal-title');
    var descEl = document.getElementById('unlock-modal-desc');
    var copyEl = document.getElementById('unlock-modal-copy');
    var fillEl = document.getElementById('unlock-modal-fill');
    var threshold = Number(asset.unlockThreshold || 0);
    var remaining = Number(asset.downloadsRemaining || 0);
    if (titleEl) titleEl.textContent = asset.title || 'Locked giveaway';
    if (descEl) descEl.textContent = asset.description || 'A new giveaway will unlock soon.';
    if (copyEl) {
      copyEl.textContent =
        'Unlocks at ' + threshold + ' total downloads. ' + remaining + ' more downloads needed.';
    }
    if (fillEl && threshold > 0) {
      var pct = Math.max(0, Math.min(100, Math.round(((threshold - remaining) / threshold) * 100)));
      fillEl.style.width = pct + '%';
    }
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeUnlockModal() {
    var modal = document.getElementById('unlock-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function handleCopyUnlockLink() {
    var btn = document.getElementById('unlock-share-btn');
    if (!btn) return;
    var original = btn.textContent;
    var link = window.location.origin + window.location.pathname;
    var done = function () {
      btn.textContent = 'Link copied ✓';
      btn.disabled = true;
      setTimeout(function () {
        btn.textContent = original;
        btn.disabled = false;
      }, 1400);
    };
    // Optimistic immediate UI feedback on user click.
    done();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).catch(function () {});
      return;
    }
    // Fallback for older browsers
    var ta = document.createElement('textarea');
    ta.value = link;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (e) {}
    document.body.removeChild(ta);
  }

  function init() {
    var titleEl = document.getElementById('page-title');
    var descEl = document.getElementById('page-desc');
    if (titleEl) titleEl.textContent = pageTitle;
    if (descEl) descEl.textContent = pageDesc;

    Promise.all([
      fetch('/api/downloads').then(function (r) { return r.json(); }).catch(function () { return []; }),
      fetch('/api/unlocks/progress').then(function (r) { return r.json(); }).catch(function () { return null; })
    ])
      .then(function (result) {
        var data = result[0];
        var progress = result[1];
        list = Array.isArray(data) ? data.filter(function (i) { return i.category === category; }) : [];
        list = sortByUnlockOrder(list);
        unlockProgress = progress || unlockProgress;
        renderUnlockProgress();
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
      if (e.key === 'Escape') { closeModal(); closeUnlockModal(); }
    });

    var modalDownloads = document.getElementById('modal-downloads');
    if (modalDownloads) {
      modalDownloads.addEventListener('click', function (e) {
        var link = e.target.closest('a[href*="/api/download/"]');
        if (!link) return;
        closeModal();
      });
    }

    var unlockClose = document.getElementById('unlock-modal-close');
    if (unlockClose) unlockClose.addEventListener('click', closeUnlockModal);
    var unlockModal = document.getElementById('unlock-modal');
    if (unlockModal) {
      unlockModal.addEventListener('click', function (e) {
        if (e.target === this) closeUnlockModal();
      });
    }
    var unlockShareBtn = document.getElementById('unlock-share-btn');
    if (unlockShareBtn) unlockShareBtn.addEventListener('click', handleCopyUnlockLink);

    document.addEventListener('error', function (e) {
      var t = e.target;
      if (!(t instanceof HTMLImageElement)) return;
      if (!t.classList.contains('card-thumb') && !t.classList.contains('gm-thumb')) return;
      onImageFallbackError(t);
    }, true);

  }

  init();
})();
