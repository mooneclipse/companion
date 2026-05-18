/* dashboard-config.js — ユーザーが編集する設定。git 管理。
 * <script src> で読み込む（file:// だと fetch() は弾かれるが script src は通る）。
 *
 * 曜日の番号は JavaScript ネイティブ: 0=日 1=月 2=火 3=水 4=木 5=金 6=土
 *
 * garbage.rules の各要素:
 *   { type: "種別名", weekly: [曜日, ...] }            毎週その曜日に収集
 *   { type: "種別名", nth: [[第何週, 曜日], ...] }      その月の第n曜日に収集（第n週が無い月はスキップ）
 *   （weekly と nth は併用可。例: 資源を第1・第3水曜 → { type:"資源", nth:[[1,3],[3,3]] }）
 *
 * ↓↓↓ 名古屋市中村区の自分の地区の実際の収集日に書き換えること（下はダミー）↓↓↓
 */
window.DASHBOARD_CONFIG = {
  weather: {
    // 名古屋市中村区（N35°10'25.38" E136°52'16.87"）
    lat: 35.173717,
    lon: 136.871353,
    tz: 'Asia/Tokyo'
  },
  garbage: {
    rules: [
      { type: '可燃ごみ',   weekly: [1, 4] },          // 毎週 月・木（ダミー）
      { type: 'プラ容器',   weekly: [3] },             // 毎週 水（ダミー）
      { type: '紙・布',     nth: [[1, 5], [3, 5]] },   // 第1・第3 金（ダミー）
      { type: '不燃ごみ',   nth: [[2, 1]] },           // 第2 月（ダミー）
      { type: '資源（びん・缶・ペットボトル）', nth: [[1, 2], [3, 2]] }  // 第1・第3 火（ダミー）
    ]
  },
  nowPlaying: {
    // bin/dashboard-start.sh が起動する now-playing helper の待受ポート（server/nowplaying-helper.py と一致させること）
    port: 47823
  }
};
