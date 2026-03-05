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
      '<div class="discord-popup" role="dialog" aria-modal="true" aria-label="Join Discord">' +
        '<div class="discord-popup-banner"></div>' +
        '<div class="discord-popup-avatar">M</div>' +
        '<button type="button" class="discord-popup-close" aria-label="Close">' +
          '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '</button>' +
        '<div class="discord-popup-body">' +
          '<div class="discord-popup-eyebrow">You\'ve been invited to join</div>' +
          '<div class="discord-popup-server">MAYA</div>' +
          '<div class="discord-popup-stats">' +
            '<div class="discord-popup-stat"><span class="discord-popup-stat-dot online"></span>Active now</div>' +
            '<div class="discord-popup-stat"><span class="discord-popup-stat-dot members"></span>Community server</div>' +
          '</div>' +
          '<a class="discord-popup-btn" href="' + DISCORD_URL + '" target="_blank" rel="noopener">' +
            '<svg width="22" height="16" viewBox="0 0 127.14 96.36" fill="#fff"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/></svg>' +
            'Join Server' +
          '</a>' +
        '</div>' +
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
    var isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocal) {
      try {
        if (sessionStorage.getItem(DISCORD_SHOWN_KEY) === '1') return;
        sessionStorage.setItem(DISCORD_SHOWN_KEY, '1');
      } catch (e) {}
    }
    ensureDiscordPopup();
    var el = document.getElementById('discord-popup');
    if (!el) return;
    el.style.display = 'flex';
    el.setAttribute('aria-hidden', 'false');
  }

  function hideDiscordPopup() {
    var el = document.getElementById('discord-popup');
    if (!el) return;
    el.style.display = 'none';
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
