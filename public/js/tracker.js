(function () {
  'use strict';

  var SESSION_KEY = 'maya_sid';
  var UTM_KEY = 'maya_utm';
  var DISCORD_SHOWN_KEY = 'maya_discord_shown';
  var DISCORD_URL = 'https://discord.gg/7HwhQaN6';

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function sessionId() {
    var sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) { sid = uuid(); sessionStorage.setItem(SESSION_KEY, sid); }
    return sid;
  }

  // Read UTMs from URL; if none, fall back to session storage so attribution
  // persists when navigating from /wallpapers -> clicking download etc.
  function utms() {
    var p = new URLSearchParams(window.location.search);
    var keys = ['source', 'medium', 'campaign', 'content', 'term'];
    var obj = {}, found = false;
    keys.forEach(function (k) {
      var v = p.get('utm_' + k);
      if (v) { obj[k] = v; found = true; }
    });
    if (found) { sessionStorage.setItem(UTM_KEY, JSON.stringify(obj)); return obj; }
    try { return JSON.parse(sessionStorage.getItem(UTM_KEY) || '{}'); } catch (e) { return {}; }
  }

  function tz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; }
  }

  function beacon(payload) {
    var data = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/track', new Blob([data], { type: 'application/json' }));
      } else {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/track', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(data);
      }
    } catch (e) {}
  }

  function base(type) {
    return {
      type: type,
      sid: sessionId(),
      page: window.location.pathname,
      referrer: document.referrer,
      utm: utms(),
      screen: { w: screen.width, h: screen.height },
      lang: navigator.language || '',
      tz: tz(),
    };
  }

  function ensureDiscordPopup() {
    if (document.getElementById('discord-popup')) return;
    var wrap = document.createElement('div');
    wrap.id = 'discord-popup';
    wrap.className = 'discord-popup-overlay';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML =
      '<div class=\"discord-popup\" role=\"dialog\" aria-modal=\"true\" aria-label=\"Join Discord\">' +
        '<button type=\"button\" class=\"discord-popup-close\" aria-label=\"Close\">×</button>' +
        '<div class=\"discord-popup-title\">MAYA is also on Discord.</div>' +
        '<a class=\"discord-popup-btn\" href=\"' + DISCORD_URL + '\" target=\"_blank\" rel=\"noopener\">Join Discord</a>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) hideDiscordPopup();
    });
    var close = wrap.querySelector('.discord-popup-close');
    if (close) close.addEventListener('click', hideDiscordPopup);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hideDiscordPopup();
    });
  }

  function showDiscordPopupOnce() {
    try {
      if (sessionStorage.getItem(DISCORD_SHOWN_KEY) === '1') return;
      sessionStorage.setItem(DISCORD_SHOWN_KEY, '1');
    } catch (e) {}
    ensureDiscordPopup();
    var el = document.getElementById('discord-popup');
    if (!el) return;
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
  }

  function hideDiscordPopup() {
    var el = document.getElementById('discord-popup');
    if (!el) return;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  }

  // Pageview
  beacon(base('pageview'));

  // Individual download click (fires before the new tab opens)
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href*="/api/download/"]');
    if (!a) return;
    var m = (a.getAttribute('href') || '').match(/\/api\/download\/([^?#/]+)/);
    if (!m) return;
    var card = a.closest('[data-id]');
    var titleEl = card && card.querySelector('.card-title');
    var payload = base('download');
    payload.asset_id = decodeURIComponent(m[1]);
    payload.asset_title = titleEl ? titleEl.textContent.trim() : '';
    payload.asset_category = document.body.getAttribute('data-category') || '';
    beacon(payload);
    setTimeout(showDiscordPopupOnce, 0);
  }, true);

  // Modal download button (inside #modal-downloads)
  document.addEventListener('click', function (e) {
    var a = e.target.closest('#modal-downloads a[href*="/api/download/"]');
    if (!a) return;
    var m = (a.getAttribute('href') || '').match(/\/api\/download\/([^?#/]+)/);
    if (!m) return;
    var titleEl = document.getElementById('modal-title');
    var payload = base('download');
    payload.asset_id = decodeURIComponent(m[1]);
    payload.asset_title = titleEl ? titleEl.textContent.trim() : '';
    payload.asset_category = document.body.getAttribute('data-category') || '';
    beacon(payload);
    setTimeout(showDiscordPopupOnce, 0);
  }, true);

  // Download-all button
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('#download-all-btn');
    if (!btn || btn.disabled) return;
    var payload = base('download_all');
    payload.asset_category = document.body.getAttribute('data-category') || '';
    beacon(payload);
    setTimeout(showDiscordPopupOnce, 0);
  }, true);

  // Modal preview open (card click)
  document.addEventListener('click', function (e) {
    var card = e.target.closest('.card-preview');
    if (!card) return;
    if (e.target.matches('a[href], .btn') && !e.target.classList.contains('no-url')) return;
    if (e.target.closest('.card-actions')) return;
    var titleEl = card.querySelector('.card-title');
    var payload = base('modal_open');
    payload.asset_id = card.getAttribute('data-id') || '';
    payload.asset_title = titleEl ? titleEl.textContent.trim() : '';
    payload.asset_category = document.body.getAttribute('data-category') || '';
    beacon(payload);
  }, true);

})();
