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
 * ↓↓↓ 名古屋市中村区の自分の地区の実際の収集日（2026-06-16 実データ反映）↓↓↓
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
      { type: '可燃ごみ',     weekly: [2, 5] },         // 毎週 火・金
      { type: '発火性危険物', weekly: [2, 5] },         // 毎週 火・金
      { type: '資源ごみ（紙・ペットボトル・缶・ビン）', weekly: [5] },  // 毎週 金
      { type: 'プラスチック製容器包装', weekly: [4] },  // 毎週 木
      { type: '不燃ごみ',     nth: [[2, 3]] },          // 毎月 第2 水
      { type: '粗大ごみ',     nth: [[4, 3]] },          // 毎月 第4 水
      { type: '資源ごみ（古紙・ダンボール）', nth: [[3, 3]] }  // 毎月 第3 水
    ]
  },
  nowPlaying: {
    // bin/dashboard-start.sh が起動する now-playing helper の待受ポート（server/nowplaying-helper.py と一致させること）
    port: 47823
  }
};
