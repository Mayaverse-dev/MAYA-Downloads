(function () {
  'use strict';

  var body = document.body;
  var category = body.getAttribute('data-category');
  var pageTitle = body.getAttribute('data-title') || category;
  var pageDesc = body.getAttribute('data-desc') || '';
  var currentFilter = 'all';
  var list = [];
  var itemsById = {};

  function escapeHtml(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function thumbUrl(url) {
    if (!url) return '';
    if (url.startsWith('/') && !url.startsWith('//')) return window.location.origin + url;
    return url;
  }

  function isPlaceholderUrl(url) {
    return !url || url === '#' || url.indexOf('example.com') !== -1;
  }

  function filterList(items) {
    if (category !== 'wallpapers' || currentFilter === 'all') return items;
    return items.filter(function (i) { return i.type === currentFilter; });
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

    var thumb = thumbUrl(item.thumbnailUrl);
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

  function render() {
    var filtered = filterList(list);
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
      downloadAllBtn.textContent = 'Download All (' + filtered.length + ')';
    }

    if (category === 'wallpapers' && filtersEl) filtersEl.hidden = false;

    grid.innerHTML = filtered.map(renderCard).join('');
  }

  function openModal(item) {
    var modal = document.getElementById('modal');
    var img = document.getElementById('modal-img');
    var titleEl = document.getElementById('modal-title');
    var descEl = document.getElementById('modal-desc');
    var downloadsEl = document.getElementById('modal-downloads');

    if (!modal || !img) return;

    img.src = thumbUrl(item.thumbnailUrl);
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
      downloadsEl.innerHTML = '<button type="button" class="no-url">Coming Soon</button>';
    } else {
      var modalHref = '/api/download/' + encodeURIComponent(item.id);
      downloadsEl.innerHTML = '<a href="' + escapeHtml(modalHref) + '" target="_blank" rel="noopener">' + escapeHtml(btnLabel) + '</a>';
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
    var filtered = filterList(list);
    filtered.forEach(function (item) {
      if (!isPlaceholderUrl(item.downloadUrl)) {
        window.open('/api/download/' + encodeURIComponent(item.id), '_blank');
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
      if (e.target.matches('a[href], .btn') && !e.target.classList.contains('no-url')) return;
      if (e.target.closest('.card-actions')) return;
      var id = card.getAttribute('data-id');
      var item = id && itemsById[id];
      if (item) openModal(item);
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

    if (category === 'wallpapers') {
      document.getElementById('filters').addEventListener('click', function (e) {
        var btn = e.target.closest('.filter-btn');
        if (!btn) return;
        currentFilter = btn.getAttribute('data-filter');
        document.querySelectorAll('#filters .filter-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        render();
      });
    }
  }

  init();
})();
