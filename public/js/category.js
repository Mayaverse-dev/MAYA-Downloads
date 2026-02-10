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
    return items.filter(function (i) {
      return (i.variants || []).some(function (v) { return v.type === currentFilter; });
    });
  }

  function getVariants(item) {
    var v = item.variants || [];
    if (category === 'wallpapers' && currentFilter !== 'all') {
      v = v.filter(function (x) { return x.type === currentFilter; });
    }
    return v;
  }

  function renderCard(item) {
    var variants = getVariants(item);
    if (variants.length === 0) return '';

    var badge = item.category === 'ebook' && item.chapter
      ? 'Ch. ' + item.chapter
      : item.category === 'stl'
        ? 'STL'
        : (variants[0].type || 'Image').toUpperCase();

    var thumb = thumbUrl(item.thumbnailUrl);
    itemsById[item.id] = item;

    var actionsHtml = '';
    if (variants.length === 1) {
      var u = variants[0].url;
      var isPh = isPlaceholderUrl(u);
      actionsHtml = isPh
        ? '<span class="btn no-url">Set URL in Admin</span>'
        : '<a href="' + escapeHtml(u) + '" target="_blank" rel="noopener" class="btn btn-primary">Download</a>';
    } else {
      actionsHtml = variants.map(function (v) {
        var isPh = isPlaceholderUrl(v.url);
        var label = v.label + (v.fileSize ? ' (' + v.fileSize + ')' : '');
        if (isPh) return '<button type="button" class="btn no-url">' + escapeHtml(label) + '</button>';
        return '<a href="' + escapeHtml(v.url) + '" target="_blank" rel="noopener" class="btn">' + escapeHtml(label) + '</a>';
      }).join('');
    }

    return (
      '<article class="card card-preview" data-id="' + escapeHtml(item.id) + '">' +
        '<img class="card-thumb" src="' + escapeHtml(thumb) + '" alt="" loading="lazy" onerror="this.style.background=\'#262626\'; this.alt=\'Preview\'">' +
        '<div class="card-body">' +
          '<span class="card-badge">' + escapeHtml(badge) + '</span>' +
          '<h3 class="card-title">' + escapeHtml(item.title) + '</h3>' +
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
      downloadAllBtn.textContent = 'Download all (' + filtered.length + ')';
    }

    if (category === 'wallpapers' && filtersEl) filtersEl.hidden = false;

    grid.innerHTML = filtered.map(renderCard).join('');
  }

  function openModal(item) {
    var variants = getVariants(item);
    var modal = document.getElementById('modal');
    var img = document.getElementById('modal-img');
    var titleEl = document.getElementById('modal-title');
    var descEl = document.getElementById('modal-desc');
    var downloadsEl = document.getElementById('modal-downloads');

    if (!modal || !img) return;

    img.src = thumbUrl(item.thumbnailUrl);
    img.alt = item.title || 'Preview';
    titleEl.textContent = item.title || '';
    descEl.textContent = item.description || '';

    downloadsEl.innerHTML = variants.map(function (v) {
      var isPh = isPlaceholderUrl(v.url);
      var label = v.label + (v.fileSize ? ' · ' + v.fileSize : '');
      if (isPh) {
        return '<button type="button" class="no-url">' + escapeHtml(label) + ' (set in Admin)</button>';
      }
      return '<a href="' + escapeHtml(v.url) + '" target="_blank" rel="noopener">' + escapeHtml(label) + '</a>';
    }).join('');

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
      var variants = getVariants(item);
      var v = variants[0];
      if (v && !isPlaceholderUrl(v.url)) window.open(v.url, '_blank');
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
