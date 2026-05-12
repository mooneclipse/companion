/* app.js — データ配線。時計は index.html のインライン script 側（隔離・最優先）。
 * ここが throw しても時計は刻み続ける。各機能は独立して try/catch で囲い、相互に倒さない。
 *
 * - 天気: Open-Meteo に直接 fetch（無料・APIキー不要・ACAO:*）。毎時 + ロード時。失敗時は直近成功値（localStorage 永続）を表示。
 * - ゴミ: dashboard-config.js のルールから次回収集日を計算。日付ロールオーバーで再計算（index.html が __refreshGarbage を呼ぶ）。
 * - now-playing: localhost helper を 2.5s ポーリング。失敗/曲なしは静かに隠す（レイアウトは揺らさない）。
 */
(function () {
  'use strict';

  var CFG = window.DASHBOARD_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var p2 = function (n) { return n < 10 ? '0' + n : '' + n; };

  // ─────────────────────────────────────────────────────────────
  // 天気（WMO weather_code → 日本語ラベル + アイコン種別）
  // ─────────────────────────────────────────────────────────────
  function wxKind(code) {
    if (code === 0) return { k: 'sun', label: '快晴' };
    if (code === 1) return { k: 'sun', label: '晴れ' };
    if (code === 2) return { k: 'suncloud', label: 'くもり時々晴れ' };
    if (code === 3) return { k: 'cloud', label: 'くもり' };
    if (code === 45 || code === 48) return { k: 'fog', label: '霧' };
    if (code >= 51 && code <= 57) return { k: 'rain', label: '霧雨' };
    if (code >= 61 && code <= 67) return { k: 'rain', label: '雨' };
    if (code >= 71 && code <= 77) return { k: 'snow', label: '雪' };
    if (code >= 80 && code <= 82) return { k: 'rain', label: 'にわか雨' };
    if (code === 85 || code === 86) return { k: 'snow', label: 'にわか雪' };
    if (code === 95) return { k: 'thunder', label: '雷雨' };
    if (code === 96 || code === 99) return { k: 'thunder', label: '雷雨（雹）' };
    return { k: 'cloud', label: '—' };
  }

  // インライン SVG（太め・hairline 無し＝1080i でも潰れない）
  var WX_SVG = {
    sun: '<circle cx="32" cy="32" r="13" fill="none"/><g><line x1="32" y1="4" x2="32" y2="13"/><line x1="32" y1="51" x2="32" y2="60"/><line x1="4" y1="32" x2="13" y2="32"/><line x1="51" y1="32" x2="60" y2="32"/><line x1="12" y1="12" x2="18" y2="18"/><line x1="46" y1="46" x2="52" y2="52"/><line x1="52" y1="12" x2="46" y2="18"/><line x1="18" y1="46" x2="12" y2="52"/></g>',
    suncloud: '<circle cx="22" cy="20" r="10" fill="none"/><g><line x1="22" y1="3" x2="22" y2="9"/><line x1="5" y1="20" x2="11" y2="20"/><line x1="9.5" y1="7.5" x2="13.5" y2="11.5"/><line x1="34.5" y1="7.5" x2="30.5" y2="11.5"/></g><path d="M20 46a12 12 0 0 1 23-4 9 9 0 0 1 1 18H23a10 10 0 0 1-3-14z" fill="none"/>',
    cloud: '<path d="M18 48a13 13 0 0 1 25-5 10 10 0 0 1 1 19H21a11 11 0 0 1-3-14z" fill="none"/>',
    rain: '<path d="M18 38a13 13 0 0 1 25-5 10 10 0 0 1 1 19H21a11 11 0 0 1-3-14z" fill="none"/><line x1="22" y1="48" x2="19" y2="58"/><line x1="33" y1="48" x2="30" y2="58"/><line x1="44" y1="48" x2="41" y2="58"/>',
    snow: '<path d="M18 36a13 13 0 0 1 25-5 10 10 0 0 1 1 19H21a11 11 0 0 1-3-14z" fill="none"/><line x1="22" y1="50" x2="22" y2="58"/><line x1="18" y1="54" x2="26" y2="54"/><line x1="38" y1="50" x2="38" y2="58"/><line x1="34" y1="54" x2="42" y2="54"/><line x1="30" y1="46" x2="30" y2="52"/>',
    fog: '<path d="M18 34a13 13 0 0 1 25-5 10 10 0 0 1 1 18" fill="none"/><line x1="12" y1="46" x2="52" y2="46"/><line x1="16" y1="54" x2="48" y2="54"/>',
    thunder: '<path d="M18 38a13 13 0 0 1 25-5 10 10 0 0 1 1 19H21a11 11 0 0 1-3-14z" fill="none"/><path d="M33 44l-7 10h7l-4 10" fill="none"/>',
    none: '<circle cx="32" cy="32" r="22" fill="none" stroke-dasharray="2 6"/><line x1="20" y1="20" x2="44" y2="44"/>'
  };
  function svgWrap(inner) {
    return '<svg viewBox="0 0 64 64" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }

  var WX_LS_KEY = 'dashboard.weather.lastgood';

  function renderWeather(data, stale) {
    var cur = data.current || {};
    var hourly = data.hourly || {};
    var times = hourly.time || [];
    var temps = hourly.temperature_2m || [];
    var codes = hourly.weather_code || [];
    var pops  = hourly.precipitation_probability || [];

    // 今日（残り時間帯）の hi/lo と代表降水%
    var todayStr = (data._fetchedAt ? new Date(data._fetchedAt) : new Date());
    var y = todayStr.getFullYear(), m = todayStr.getMonth(), d = todayStr.getDate();
    var hi = null, lo = null, popMax = null;
    for (var i = 0; i < times.length; i++) {
      var t = new Date(times[i]);
      if (t.getFullYear() === y && t.getMonth() === m && t.getDate() === d) {
        var tv = temps[i];
        if (typeof tv === 'number') { if (hi === null || tv > hi) hi = tv; if (lo === null || tv < lo) lo = tv; }
        var pv = pops[i];
        if (typeof pv === 'number') { if (popMax === null || pv > popMax) popMax = pv; }
      }
    }

    var code = (typeof cur.weather_code === 'number') ? cur.weather_code : (codes.length ? codes[0] : 3);
    var kind = wxKind(code);
    $('wx-icon').innerHTML = svgWrap(WX_SVG[kind.k] || WX_SVG.cloud);
    $('wx-icon').style.color = '';   // accent に戻す（CSS の var(--accent)）
    var ct = (typeof cur.temperature_2m === 'number') ? Math.round(cur.temperature_2m) : '–';
    $('wx-temp').textContent = ct + '°';
    $('wx-label').textContent = kind.label;
    $('wx-hilo').innerHTML = '今日 <span class="hi">↑' + (hi === null ? '–' : Math.round(hi)) + '°</span> <span class="lo">↓' + (lo === null ? '–' : Math.round(lo)) + '°</span>';
    $('wx-pop').textContent = '降水 ' + (popMax === null ? '–' : popMax) + '%';
    var ft = data._fetchedAt ? new Date(data._fetchedAt) : new Date();
    $('wx-stamp').textContent = stale ? ('更新 ' + p2(ft.getHours()) + ':' + p2(ft.getMinutes())) : '';
  }

  function renderWeatherUnavailable() {
    $('wx-icon').innerHTML = svgWrap(WX_SVG.none);
    $('wx-icon').style.color = 'var(--ink-faint)';
    $('wx-temp').textContent = '–°';
    $('wx-label').textContent = '取得できません';
    $('wx-hilo').innerHTML = '今日 <span class="hi">↑–°</span> <span class="lo">↓–°</span>';
    $('wx-pop').textContent = '降水 –%';
    $('wx-stamp').textContent = '';
  }

  function fetchWeather() {
    var w = CFG.weather;
    if (!w || typeof w.lat !== 'number' || typeof w.lon !== 'number') { renderWeatherUnavailable(); return; }
    var url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + encodeURIComponent(w.lat)
      + '&longitude=' + encodeURIComponent(w.lon)
      + '&hourly=temperature_2m,weather_code,precipitation_probability'
      + '&current=temperature_2m,weather_code'
      + '&timezone=' + encodeURIComponent(w.tz || 'Asia/Tokyo')
      + '&forecast_days=1';
    fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        j._fetchedAt = Date.now();
        try { localStorage.setItem(WX_LS_KEY, JSON.stringify(j)); } catch (e) {}
        renderWeather(j, false);
      })
      .catch(function () {
        // 直近成功値（state）を表示。retry/backoff はしない＝次の毎時スケジュールで再試行。
        var raw = null;
        try { raw = localStorage.getItem(WX_LS_KEY); } catch (e) {}
        if (raw) {
          try {
            var j = JSON.parse(raw);
            var ageH = (Date.now() - (j._fetchedAt || 0)) / 3600000;
            if (ageH < 24) { renderWeather(j, true); return; }
          } catch (e) {}
        }
        renderWeatherUnavailable();
      });
  }

  // ─────────────────────────────────────────────────────────────
  // ゴミの日（dashboard-config.js のルールから次回 N 件を計算）
  // 曜日: JS ネイティブ 0=日..6=土。nth は「その月の第 ceil(day/7) 回目の曜日」。
  // 朝（5:30-9:00）の運用なので「今日が収集日」＝まだ収集前＝「きょう」扱い。
  // ─────────────────────────────────────────────────────────────
  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  function ruleMatchesDay(rule, dt) {
    var dow = dt.getDay();
    if (rule.weekly && rule.weekly.indexOf(dow) !== -1) return true;
    if (rule.nth) {
      var nth = Math.ceil(dt.getDate() / 7);
      for (var i = 0; i < rule.nth.length; i++) {
        if (rule.nth[i][0] === nth && rule.nth[i][1] === dow) return true;
      }
    }
    return false;
  }

  function computeGarbage(maxResults) {
    var rules = (CFG.garbage && CFG.garbage.rules) || [];
    if (!rules.length) return [];
    var out = [];
    var base = new Date();
    base.setHours(0, 0, 0, 0);
    for (var offset = 0; offset <= 70 && out.length < maxResults; offset++) {
      var dt = new Date(base.getTime() + offset * 86400000);
      var types = [];
      for (var i = 0; i < rules.length; i++) {
        if (rules[i].type && ruleMatchesDay(rules[i], dt)) types.push(rules[i].type);
      }
      if (types.length) out.push({ date: dt, offset: offset, types: types });
    }
    return out;
  }

  function whenLabel(offset, dt) {
    if (offset === 0) return 'きょう';
    if (offset === 1) return 'あす';
    if (offset === 2) return 'あさって';
    return (dt.getMonth() + 1) + '/' + dt.getDate();
  }

  function renderGarbage() {
    var list = computeGarbage(2);
    if (!list.length) {
      $('gb-when').textContent = '—';
      $('gb-type').textContent = 'ゴミ設定なし';
      $('gb-next').textContent = '';
      return;
    }
    var n0 = list[0];
    $('gb-when').innerHTML = whenLabel(n0.offset, n0.date) + ' <span class="dow">(' + WD[n0.date.getDay()] + ')</span>';
    $('gb-type').textContent = n0.types.join('・');
    if (list[1]) {
      var n1 = list[1];
      $('gb-next').textContent = '次: ' + n1.types.join('・') + ' ' + (n1.date.getMonth() + 1) + '/' + n1.date.getDate() + ' (' + WD[n1.date.getDay()] + ')';
    } else {
      $('gb-next').textContent = '';
    }
  }
  // index.html の時計が日付ロールオーバーを検知したら呼ぶ
  window.__refreshGarbage = function () { try { renderGarbage(); } catch (e) {} };

  // ─────────────────────────────────────────────────────────────
  // now-playing（localhost helper を 2.5s ポーリング）
  // ─────────────────────────────────────────────────────────────
  var NP_PORT = (CFG.nowPlaying && CFG.nowPlaying.port) || 47823;
  var npEl = $('now-playing');
  var npText = $('np-text');

  function setNowPlaying(title, artist) {
    if (!title) { npEl.classList.add('is-empty'); return; }
    npText.textContent = artist ? (title + ' — ' + artist) : title;
    npEl.classList.remove('is-empty');
  }

  function pollNowPlaying() {
    fetch('http://127.0.0.1:' + NP_PORT + '/np', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        if (j && j.playing && j.title) setNowPlaying(j.title, j.artist);
        else setNowPlaying(null);
      })
      .catch(function () { setNowPlaying(null); });   // helper 不在＝静かに隠す。retry しない（次の周期で）
  }

  // ─────────────────────────────────────────────────────────────
  // 起動
  // ─────────────────────────────────────────────────────────────
  try { renderGarbage(); } catch (e) {}
  try { fetchWeather(); } catch (e) { try { renderWeatherUnavailable(); } catch (e2) {} }
  try { setNowPlaying(null); pollNowPlaying(); } catch (e) {}

  setInterval(function () { try { fetchWeather(); } catch (e) {} }, 3600 * 1000);   // 毎時
  setInterval(function () { try { pollNowPlaying(); } catch (e) {} }, 2500);          // 2.5s
})();
