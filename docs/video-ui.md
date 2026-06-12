# video-ui.md — リモコン「動画」画面 仕様 (as-built)

最終更新: 2026-06-12 (TVer 対応 + URL 入力 1 本化のタイミングで起こした軽量仕様。
設計の大元は `~/companion/workspace/redesign/video-design.md`、DL キューは同
`dlqueue-design.md`。本ファイルは **PWA 画面の現状仕様** だけを短く持つ)

## 画面構成

動画画面 (`#video`) は排他 3 view + 常設 1 カード:

| 要素 | 表示条件 | 中身 |
|---|---|---|
| `#video-idle` | phase=idle、または「閉じる」で畳んだ時 | URL 欄 1 本 + 「再生」「あとでDL」「クリア」+ 状態文言 `#video-msg` |
| `#video-resolving` | phase=resolving | スピナー + 経過秒 + 目安文言 + キャンセル |
| `#video-transport` | phase=playing/paused | タイトル / シークバー / ±N スキップ / LIVE バッジ / 一時停止 / 音量 / 閉じる / 停止 |
| 事前DLリスト (常設・折りたたみ) | 常時 (既定は閉) | DL 項目一覧 (再生 / 再試行 / 削除) + 容量表示。**投入欄はここには無い** (URL 欄に一本化) |

ホーム画面には再生中のみ `#nowbar` (タイトル + 位置、タップで動画画面へ)。

## URL 入力は 1 本、出口が 2 つ

- **再生**: `POST /api/video/play` → TV の常駐 mpv で即再生
- **あとでDL**: `POST /api/dl` → 事前 DL キュー投入 (完了は Telegram 通知)。
  成功時は URL 欄を空にし、DL リストを開いて投入結果を見せる
- どちらの結果文言も URL 欄直下の `#video-msg` に出す。リスト内の「再試行」だけは
  リスト側 `#dl-result` に出す (押した場所の近くに出す原則)

## 対応サービス (2026-06-12 現在)

| サービス | 再生 | 事前DL | 備考 |
|---|---|---|---|
| YouTube | ○ | ○ | live / VOD / music / youtu.be |
| ニコニコ動画 | ○ | ○ | nico.ms 可。ニコ生は対象外 |
| TVer | ○ | **×** | RV-11 (2026-06-12) で実 URL 3 本検証済 (DRM なし HLS)。期限付き見逃し配信のためローカル保存はしない (サーバ `normalize_dl` が 400) |

門はすべてサーバ側 `server/urlguard.py` (再生 = `normalize` / DL = `normalize_dl`)。
PWA の文言は表示のみで判定はしない。

## 状態機械と真実の所在

- phase は IDLE → RESOLVING → PLAYING ⇄ PAUSED。真実は mpv
  (`GET /api/video/state` を 2s ポーリング)、PWA はその写像
- 再生タップで楽観的に RESOLVING 表示 (サーバ応答前)。解決は**通常 10 秒前後**
  (vendored ytdl_hook + force-ipv4 後の実測: YouTube ~10s / ニコニコ 8s / TVer 11s)。
  90 秒超で「通常より時間がかかっています」へ文言エスカレーション
- 投入が playing に達さず idle に落ちたら「読み込めませんでした」(clean-fail)。
  PWA 非表示中の終了は成功/失敗を断定せず「前回の再生は終了しています」
- **閉じる ≠ 停止**: 「閉じる」は view を畳むだけで TV は再生継続 (idle view に
  「操作に戻る」が出る)。「停止」は confirm 付きで mpv stop
- LIVE は ●LIVE バッジ + シーク/スキップ非表示 (seekable=false で判定)

## localStorage (表示ヒントのみ、token とは別キー)

| キー | 用途 |
|---|---|
| `video_resolve_at` | resolve 経過秒の起点 |
| `video_last_url` | 直前投入 URL (取りこぼし時の再投入ヒント) |
| `video_skip_step` | ±N スキップのステップ秒 (5/10/30/60) |

## 変更時の注意

- 静的ファイル (web/) は即反映だが PWA キャッシュがあるので `sw.js` の CACHE を bump
- allowlist を触るときは video-design §4.1 の canonical ベクタ + 両 repo
  (remote `tests/test_urlguard.py` / bot `tests/test_bot.py`) のミラーテストを同期
- 追加 host が「再生のみ」(期限付き配信等) なら `STREAM_ONLY_HOSTS` にも同時追加。
  忘れると事前 DL が黙って通る (fail-open)
- server/*.py を触ったら `systemctl --user restart companion-remote.service` 必須
