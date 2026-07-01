# screensaver — STATUS

dashboard 終了後 (09:05〜05:25) に TV (HDMI-1) へ p5.js ジェネラティブアートを全画面表示するスクリーンセーバー。

## 概要

- **アルゴリズム**: Perlin noise flow field パーティクル (1500 個、残像トレイル)
- **技術**: p5.js instance mode + firefox kiosk (file:// ローカル配信)
- **環境**: Dell Inspiron 3521 / HDMI-1 1080i / firefox 151
- **制御**: systemd timer で自動起動/停止 + remote PWA からオン/オフ

## 構成

```
screensaver/
├── web/           # p5.js アート本体 (index.html + art.js + style.css)
│   └── lib/       # p5.min.js (自己ホスト)
├── bin/           # screensaver-start.sh (firefox kiosk 起動)
├── systemd/       # service + timer ユニット
├── .state/        # firefox profile (gitignore)
└── docs/          # この STATUS.md
```

## systemd ユニット

| ユニット | 種別 | 役割 |
|---|---|---|
| screensaver.service | simple | firefox kiosk でアート表示 |
| screensaver-start.timer | timer | 09:05 に service 起動 |
| screensaver-stop.service | oneshot | service 停止 |
| screensaver-stop.timer | timer | 05:25 に stop.service 実行 |

dashboard.service がアクティブな場合、screensaver-start.sh はスキップする。

## 最終更新

2026-07-02 初期実装
