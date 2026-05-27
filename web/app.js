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

  // セリフ枠が朝/夜の一言を組み立てる際に使う最新の天気レスポンス（fetchWeather 成功時 / localStorage 復帰時に保持）。
  var lastWeatherData = null;

  // 時間ごと予報のスロット（5:30〜9:00 運用の朝に今日の流れを一望できる範囲）。
  var HOURLY_SLOTS = [6, 9, 12, 15, 18, 21];

  function renderHourly(hourly, base) {
    var strip = $('wx-hourly');
    if (!strip) return;
    var times = hourly.time || [];
    var temps = hourly.temperature_2m || [];
    var codes = hourly.weather_code || [];
    var pops  = hourly.precipitation_probability || [];
    var y = base.getFullYear(), m = base.getMonth(), d = base.getDate();
    var html = '';
    for (var s = 0; s < HOURLY_SLOTS.length; s++) {
      var h = HOURLY_SLOTS[s];
      var idx = -1;
      for (var j = 0; j < times.length; j++) {
        var t = new Date(times[j]);
        if (t.getFullYear() === y && t.getMonth() === m && t.getDate() === d && t.getHours() === h) { idx = j; break; }
      }
      if (idx < 0) continue;
      var temp = temps[idx];
      var code = codes[idx];
      var pop = pops[idx];
      var kind = wxKind(typeof code === 'number' ? code : 3);
      html += '<div class="wx-h-slot">'
           +   '<div class="wx-h-time">' + h + '時</div>'
           +   '<div class="wx-h-icon">' + svgWrap(WX_SVG[kind.k] || WX_SVG.cloud) + '</div>'
           +   '<div class="wx-h-temp">' + (typeof temp === 'number' ? Math.round(temp) + '°' : '–') + '</div>'
           +   '<div class="wx-h-pop">' + (typeof pop === 'number' ? pop + '%' : '–%') + '</div>'
           + '</div>';
    }
    strip.innerHTML = html;
  }

  function renderHourlyUnavailable() {
    var strip = $('wx-hourly');
    if (strip) strip.innerHTML = '';
  }

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
    renderHourly(hourly, todayStr);
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
    renderHourlyUnavailable();
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
        lastWeatherData = j;
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
            if (ageH < 24) { lastWeatherData = j; renderWeather(j, true); return; }
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

  // ─────────────────────────────────────────────────────────────
  // セリフ枠（30 秒ごとに 1 言ずつローテーション）。
  //   月〜金: 朝天気 → 夜天気 → 占い → ニュース 1..3
  //   土日:   一日天気 → 占い → ニュース 1..3
  // データソース:
  //   - 天気: lastWeatherData (Open-Meteo の hourly 配列を時刻 match で抽出、新規 fetch 無し)
  //   - 占い: 日付 seed の deterministic 関数で 1 件生成（双子座固定、外部 API 無し）
  //   - ニュース: helper の /news (NHK RSS proxy) を 1 時間ごとにポーリングしてキャッシュ
  // 失敗時は該当一言だけスキップ（ローテーション全体は止めない）。fetch 失敗時の retry/backoff は無し。
  // ─────────────────────────────────────────────────────────────
  var QUOTE_INTERVAL_MS = 30 * 1000;
  var QUOTE_FADE_MS = 320;             // style.css .quote-text transition と合わせる
  var NEWS_POLL_MS = 3600 * 1000;      // 1 時間ごと
  var lastNewsItems = [];

  // ── 天気: 時刻帯の代表値抽出 + 服装/傘の文言化 ──────────────────
  function _wxBandStats(data, baseDate, hourFrom, hourTo) {
    // data.hourly から baseDate の hourFrom..hourTo 時の温度・降水確率・代表 weather_code を集約。
    // 区間は半開区間 [hourFrom, hourTo)（Open-Meteo hourly は「時刻開始の 1 時間区間」セマンティクス）。
    // 該当データが 1 件も無ければ null。
    if (!data || !data.hourly) return null;
    var times = data.hourly.time || [];
    var temps = data.hourly.temperature_2m || [];
    var codes = data.hourly.weather_code || [];
    var pops  = data.hourly.precipitation_probability || [];
    var y = baseDate.getFullYear(), m = baseDate.getMonth(), d = baseDate.getDate();
    var tHi = null, tLo = null, popMax = null, code = null;
    for (var i = 0; i < times.length; i++) {
      var t = new Date(times[i]);
      if (t.getFullYear() !== y || t.getMonth() !== m || t.getDate() !== d) continue;
      var h = t.getHours();
      if (h < hourFrom || h >= hourTo) continue;
      var tv = temps[i];
      if (typeof tv === 'number') {
        if (tHi === null || tv > tHi) tHi = tv;
        if (tLo === null || tv < tLo) tLo = tv;
      }
      var pv = pops[i];
      if (typeof pv === 'number' && (popMax === null || pv > popMax)) popMax = pv;
      if (code === null && typeof codes[i] === 'number') code = codes[i];
    }
    if (tHi === null && popMax === null) return null;
    return { hi: tHi, lo: tLo, popMax: popMax, code: code };
  }

  function _clothesPhrase(hi) {
    // 最高気温 → 服装の一言。区切りは妥当な体感ベース。
    if (hi === null) return '';
    if (hi >= 30) return '半袖でも暑そう';
    if (hi >= 25) return '半袖で十分';
    if (hi >= 20) return '長袖シャツで';
    if (hi >= 15) return '薄手の上着があると安心';
    if (hi >= 10) return '上着をしっかり';
    if (hi >= 5)  return 'コートで';
    return '厚手のコートで';
  }

  function _umbrellaPhrase(popMax) {
    if (popMax === null) return '';
    if (popMax >= 70) return '傘は必須';
    if (popMax >= 50) return '傘があった方がいいよ';
    if (popMax >= 30) return '折りたたみ傘があると安心';
    return '傘はいらなさそう';
  }

  function _buildWeatherLine(label, stats) {
    if (!stats) return null;
    var parts = [];
    if (stats.hi !== null) {
      var t = '最高 ' + Math.round(stats.hi) + '°';
      if (stats.lo !== null && Math.round(stats.lo) !== Math.round(stats.hi)) {
        t += ' / 最低 ' + Math.round(stats.lo) + '°';
      }
      parts.push(t);
    }
    var clothes = _clothesPhrase(stats.hi);
    if (clothes) parts.push(clothes);
    var umb = _umbrellaPhrase(stats.popMax);
    if (umb) parts.push(umb);
    if (!parts.length) return null;
    return label + '：' + parts.join('、');
  }

  function buildWeatherLines() {
    // 平日 2 件 (朝 7-9 / 夜 18-22) / 土日 1 件 (一日 6-21)。半開区間 [from, to) で指定。
    // データ不在は該当行を返さない。
    var data = lastWeatherData;
    if (!data) return [];
    var base = new Date();
    var dow = base.getDay();
    var isWeekend = (dow === 0 || dow === 6);
    var out = [];
    if (isWeekend) {
      var all = _wxBandStats(data, base, 6, 21);
      var line = _buildWeatherLine('きょうの天気', all);
      if (line) out.push(line);
    } else {
      var morning = _wxBandStats(data, base, 7, 9);
      var ml = _buildWeatherLine('朝の天気', morning);
      if (ml) out.push(ml);
      var evening = _wxBandStats(data, base, 18, 22);
      var el = _buildWeatherLine('夜の天気', evening);
      if (el) out.push(el);
    }
    return out;
  }

  // ── 占い: 日付 seed の deterministic 生成（双子座固定） ──────────
  // 同じ日付なら何度生成しても同じ結果（リロードで変わらない）。
  var FORTUNE_LUCK = ['仕事', '勉強', '恋愛', '健康', '対人', '金銭', '創作', '趣味'];
  var FORTUNE_LEVEL = ['絶好調', '好調', 'まずまず', '穏やか', '一息つくとよさそう'];
  var FORTUNE_COLOR = ['青', '緑', '黄', '橙', '赤', '紫', '白', '黒', '金', '銀', '桃', '水色'];
  var FORTUNE_TIP = [
    '小さな約束を守ると流れが整う',
    '深呼吸を 3 回するだけで視界が広がる',
    '誰かに一言「ありがとう」を伝えてみよう',
    '机の上を 5 分だけ片付けるといい',
    '迷ったら静かな方を選ぶと吉',
    'いつもより 5 分早く出ると拾い物がある',
    '無理せず休む勇気が今日の運を呼ぶ',
    '誰かの話を最後まで聞くと運が回る'
  ];

  function _fortuneSeed(date) {
    // YYYYMMDD を seed 化。Mulberry32 風 32bit ハッシュ。
    var s = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
    var h = s | 0;
    h = (h ^ 61) ^ (h >>> 16);
    h = (h + (h << 3)) | 0;
    h = h ^ (h >>> 4);
    h = Math.imul(h, 0x27d4eb2d);
    h = h ^ (h >>> 15);
    return h >>> 0;
  }

  function _mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildFortuneLine() {
    var d = new Date();
    var rnd = _mulberry32(_fortuneSeed(d));
    var luck = FORTUNE_LUCK[Math.floor(rnd() * FORTUNE_LUCK.length)];
    var level = FORTUNE_LEVEL[Math.floor(rnd() * FORTUNE_LEVEL.length)];
    var color = FORTUNE_COLOR[Math.floor(rnd() * FORTUNE_COLOR.length)];
    var tip = FORTUNE_TIP[Math.floor(rnd() * FORTUNE_TIP.length)];
    return 'きょうの双子座：' + luck + '運が' + level + '。ラッキーカラーは' + color + '。' + tip + '。';
  }

  // ── ニュース: helper /news を 1 時間ごとポーリング ───────────────
  var NEWS_PORT = (CFG.nowPlaying && CFG.nowPlaying.port) || 47823;  // /np と同じ helper
  function pollNews() {
    fetch('http://127.0.0.1:' + NEWS_PORT + '/news', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        if (j && j.items && j.items.length) lastNewsItems = j.items.slice(0, 3);
      })
      .catch(function () { /* 失敗時は前回値保持。retry/backoff 無し */ });
  }

  function buildNewsLines() {
    if (!lastNewsItems || !lastNewsItems.length) return [];
    var out = [];
    for (var i = 0; i < lastNewsItems.length && i < 3; i++) {
      out.push('ニュース：' + lastNewsItems[i]);
    }
    return out;
  }

  // ── ローテーション: 1 cycle 分の一言キューを build → 順次表示 ──
  function buildQuoteQueue() {
    var q = [];
    var wx = buildWeatherLines();
    for (var i = 0; i < wx.length; i++) q.push(wx[i]);
    q.push(buildFortuneLine());
    var news = buildNewsLines();
    for (var j = 0; j < news.length; j++) q.push(news[j]);
    return q;
  }

  (function () {
    var el = $('quote-text');
    if (!el) return;
    var progressEl = $('quote-progress');     // セリフ切替メーター（下端の細線）。無くても本流は壊さない。
    var queue = [];
    var idx = 0;

    function refillIfNeeded() {
      if (idx >= queue.length) {
        queue = buildQuoteQueue();
        idx = 0;
      }
    }

    function showNext() {
      refillIfNeeded();
      if (!queue.length) {
        // 何も組み立てられなかった（起動直後で weather 未取得 & news 未取得）。
        // 骨格は維持しつつ「…」のまま、次周期で再試行。
        return;
      }
      el.textContent = queue[idx];
      idx++;
    }

    // 30s メーターを 0% から再カウント。class を一度外し reflow を強制してから付け直すことで
    // CSS animation を確実に再生（同名 class の再付与だけだと再開しないブラウザ仕様への対処）。
    function restartProgress() {
      if (!progressEl) return;
      progressEl.classList.remove('is-running');
      // reflow を強制（戻り値は捨てるが、参照することが副作用としてレイアウト計算を走らせる）。
      void progressEl.offsetWidth;
      progressEl.classList.add('is-running');
    }

    // 初回: queue を即組んで 1 言目を表示（fetchWeather が走り始めた直後で
    // lastWeatherData が未着でも、占いは無条件で出るので最低 1 言は描画される）。
    queue = buildQuoteQueue();
    if (queue.length) { el.textContent = queue[0]; idx = 1; }
    restartProgress();

    setInterval(function () {
      try {
        restartProgress();                     // setInterval と同タイミングで 0% リセット（drift しない）
        el.classList.add('is-fading');
        setTimeout(function () {
          showNext();
          el.classList.remove('is-fading');
        }, QUOTE_FADE_MS);
      } catch (e) {}
    }, QUOTE_INTERVAL_MS);

    // ニュースは起動直後 + 1 時間ごとに helper から取得。
    try { pollNews(); } catch (e) {}
    setInterval(function () { try { pollNews(); } catch (e) {} }, NEWS_POLL_MS);
  })();

  // ─────────────────────────────────────────────────────────────
  // 小箱キャラ アイドルアニメ（まばたき・目線のランダムタイマー）
  // 体の微揺れ・呼吸は CSS keyframes 完結。ここは「JS でしか出せないランダム性」だけ。
  // 状態連動（設計ノート 2026-05-16）:
  //   thinking/answering … 目線移動を停止（揺れ停止は CSS 側）。まばたきは継続
  //   error              … アイドル全停止（まばたき・目線とも止め、揺れ/呼吸は CSS 側）
  //   sleepy             … まばたきが遅く重い（閉じ 200ms）
  // 現状 data-state は normal 固定（外部連携は将来）。
  // ─────────────────────────────────────────────────────────────
  (function () {
    var cmp = $('companion');
    if (!cmp) return;
    var eyes = cmp.querySelector('.cmp-eyes');
    var eyeEls = cmp.querySelectorAll('.cmp-eye');
    if (!eyes || !eyeEls.length) return;
    var rand = function (min, max) { return min + Math.random() * (max - min); };
    var state = function () { return cmp.getAttribute('data-state') || 'normal'; };

    // まばたきは error のみ停止（sleepy を含むそれ以外は瞬きする）
    function blinkAllowed() { return state() !== 'error'; }
    // 目線移動は処理中（thinking/answering）と error で停止
    function gazeAllowed() {
      var s = state();
      return s !== 'thinking' && s !== 'answering' && s !== 'error';
    }

    function blinkOnce() {
      var hold = state() === 'sleepy' ? 200 : 100;   // sleepy は重いまばたき
      for (var i = 0; i < eyeEls.length; i++) eyeEls[i].classList.add('blink');
      setTimeout(function () {
        for (var i = 0; i < eyeEls.length; i++) eyeEls[i].classList.remove('blink');
      }, hold);
    }
    function scheduleBlink() {
      setTimeout(function () {
        if (blinkAllowed()) {
          blinkOnce();
          if (Math.random() < 0.1) setTimeout(blinkOnce, 180);   // 10回に1回 二連まばたき
        }
        scheduleBlink();
      }, rand(3000, 7000));   // 3〜7秒ランダム
    }
    function scheduleGaze() {
      setTimeout(function () {
        if (gazeAllowed()) {
          eyes.classList.remove('look-left', 'look-right');
          var r = Math.random();
          if (r < 0.4) eyes.classList.add('look-left');
          else if (r < 0.8) eyes.classList.add('look-right');
          // 残り 20% は正面のまま
          setTimeout(function () { eyes.classList.remove('look-left', 'look-right'); }, 1600);
        } else {
          eyes.classList.remove('look-left', 'look-right');   // 停止中は正面に戻す
        }
        scheduleGaze();
      }, rand(8000, 15000));   // 8〜15秒ランダム
    }
    scheduleBlink();
    scheduleGaze();
  })();
})();
