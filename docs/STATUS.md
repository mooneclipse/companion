# screensaver — STATUS

dashboard 終了後 (09:05〜05:25) に TV (HDMI-1) へ p5.js ジェネラティブアートを全画面表示するスクリーンセーバー。

## 概要

- **アルゴリズム**: アートパターン 4 種を 30 分ごとに時間ローテーション (順序は起動時シャッフル、切替時 3 秒フェードアウト)
  - `flow`: Perlin noise flow field パーティクル (1500 個、残像トレイル) — 初期実装の見た目そのまま
  - `ridge`: noise 稜線 30 本 (Joy Division 風ラインアート、背景色 fill でオクルージョン)
  - `orbit`: 中心周回の発光点 420 個 + トレイル (星の軌跡風)
  - `fireflies`: 漂い明滅する発光ドット 110 個 (蛍風、noise 漂い + 個体位相の alpha 脈動)
- **URL パラメータ** (プレビュー/デバッグ用): `?p=<name>` でパターン固定 (ローテーション無効)、`?rot=<秒>` で切替間隔上書き。不正値は無視
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

dashboard.service がアクティブな場合、screensaver-start.sh はスキップする。逆方向の排他 (dashboard 起動時に screensaver を stop) は dashboard-start.sh 側にあり双方向 (Conflicts= は対称動作 = screensaver 起動が dashboard を落とすため不採用)。

## remote PWA 連携

- remote server (`~/companion/remote/server/screensaver.py` + `app.py`) が `GET /api/screensaver/state` / `POST /api/screensaver/toggle {action: start|stop}` を提供 (Bearer 必須)
- **toggle はクライアント主導**: PWA が表示中の状態 (ssActive) から意図する action を明示送信。サーバ側で is_active() から start/stop を判断しない (state 取得〜タップ間の状態変化で意図と逆の操作が走るため。2026-07-02 引き直し)
- toggle 成功後 1.5 秒でサーバの実態を引き直す (dashboard 稼働中の start は排他ガードで即 dead になるため、仮定値のままだと「表示中」誤表示が残る)
- **remote の web/ 変更は sw.js の CACHE bump 必須** (PWA は shell precache。bump しないと旧 app.js が配られ続ける)

## Done

- 2026-07-08: アートパターン 3 種追加 (ridge / orbit / fireflies) + 30 分ローテーション + `?p=` / `?rot=` パラメータ。art.js をパターンレジストリ構造 (`{name, init, draw}`) にリファクタ、flow は見た目据え置き。新パターンの描画量は flow (1500 noise + 1500 line/フレーム) と同等以下 (ridge ≈ 2900 noise + 30 shape、orbit = 420 point 三角関数のみ、fireflies = 220 noise + 220 ellipse)。Playwright + Chromium で 4 パターンの描画 + console エラーなし + `?rot=5` の自動切替/フェードを確認
- 2026-07-02: 初期実装 (`6e02523`) → timer Unit= 修正 + 粒子色を生成時固定 (`e2ca01f`) → stop timer Unit= 明示 (`f37e919`)。code-reviewer 全体レビュー: 修正必須 0 / 軽微 3 (うち 2 対応済み = toggle 実態引き直し・双方向排他)。timer は enabled + started 確認済み (start 09:05 / stop 05:25)

## TODO

- [ ] 実機確認: TV での見え方 (1080i でのちらつき・色味・粒子サイズ)。`systemctl --user start screensaver.service` でいつでも手動起動可 (無音)
- [ ] CPU/熱の実測: 1500 粒子 30fps を約 20 時間/日回す負荷を `top` で 1 回測って本ファイルに記録 (粒子数・fps の調整判断材料)

## 最終更新

2026-07-08 アートパターン 4 種 + 時間ローテーション
