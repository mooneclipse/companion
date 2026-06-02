# companion-games 開発台帳（umbrella: 全部 AI で作るゲーム / 第 1 作「みちゆき」）

最終更新: 2026-06-02 (v1 初版 = michiyuki/web 一式 + 配信サーバ + systemd unit を新規作成、ローカル commit)

## 概要

「スマホで遊べるゲームを全部 AI で作る」umbrella プロジェクト。ユーザー(SE, 完全個人利用)が「自分にいっさい要望を聞かず、自分が楽しめるゲームを AI が勝手に作る」という趣旨で発注。嗜好の一次資料は vault `aidiary/2026-04-11_games-i-want-to-try.md`(広大な世界をただ歩く / 地形だけで語る / Journey・Shadow of the Colossus のような静かで「終わりが惜しい」体験 / 「ないものに触れる」)。

第 1 作 **みちゆき** はこれに寄せた静かな横歩きゲーム。スコア無し・失敗無し、長押しで歩き、progress 0→1 の道中で空と地面の色が夜明け→夜へ移ろい、断章(石碑)を読みながら終端へ向かう。

- 対象ユーザ: miho 個人のみ(完全個人利用、外部公開なし)
- 配信形態: スマホ(Tailnet 同居)から開く静的 PWA
- 不要なもの: スコア / マルチプレイ / 課金 / 音(v1 は無音)

## 位置付け

`workspace/PROJECT.md` の Phase 1〜4 ロードマップとは独立した **フェーズ外の独立プロジェクト**(remote / dashboard と同じ扱い)。umbrella「全部 AI で作るゲーム」の第 1 作。

## ネットワーク境界

companion-remote の流儀を踏襲。

- サーバ(`server/app.py`)は **127.0.0.1 のみに bind**(0.0.0.0 / tailnet IP 厳禁)。
- 外向きは **`tailscale serve`(HTTPS 前段リバースプロキシ)経由のみ**。Tailnet 内からしか到達しない。
- 認証は tailscale 境界に委ねる(単一ユーザー、API 無し)。`/healthz` のみ無認証の生存確認。
- ポートは env `GAMES_PORT`(デフォルト 47825、remote の 47824 と衝突しない別番号)。

## 設計判断: ランタイムで claude を呼ばない（budget-guard 境界回避）

ゲームはランタイムで claude / 外部 API を**一切呼ばない純静的 PWA**。断章テキストは**ビルド時に AI 生成した静的データ**(`michiyuki/web/fragments.js`)で、配信時は素朴なファイルサーブに徹する。これにより budget-guard 境界に踏み込まない。唯一の外部依存は和文フォントの Google Fonts CDN(`<link>`)で、取得失敗時は CSS の serif フォールバックで成立する(CSP で `fonts.googleapis.com` / `fonts.gstatic.com` のみ許可)。

## ディレクトリ構成

```
games/
├── docs/STATUS.md
├── michiyuki/web/
│   ├── index.html       # canvas + 断章オーバーレイ + CSP + フォント link
│   ├── app.js           # ゲーム本体(歩行 / パララックス / 色補間 / 断章 / 入力)
│   ├── fragments.js     # 断章テキスト(verbatim, AI 生成静的データ) + 色キーフレーム
│   ├── style.css        # 静けさ最優先のタイポグラフィ / オーバーレイ
│   ├── manifest.json    # PWA(name みちゆき / standalone / 夜明け色基調)
│   ├── sw.js            # shell precache の service worker(オフライン再プレイ)
│   └── icons/           # icon-192.png / icon-512.png(夜明け色グラデ, PIL 生成)
├── server/app.py        # stdlib http.server, 127.0.0.1 bind, 固定 allowlist 配信
└── systemd/companion-games.service
```

git: **(C) ローカル git のみ(remote なし、rollback 専用)**。GitHub remote は意図的に付けない(マシン外バックアップ不要)。gitleaks pre-commit hook 導入済み。

## 起動手順（SETUP）

```sh
# 1. user service として登録
ln -sf ~/companion/games/systemd/companion-games.service ~/.config/systemd/user/companion-games.service
systemctl --user daemon-reload
systemctl --user enable --now companion-games.service
systemctl --user status companion-games.service   # active 確認

# 2. tailscale serve で HTTPS 前段を張る(Tailnet 内のみ到達)
#    127.0.0.1:47825 を tailnet の HTTPS にぶら下げる。
sudo tailscale serve --bg --https=443 127.0.0.1:47825
tailscale serve status                              # 公開状態確認
# → スマホの Tailnet から https://<machine>.<tailnet>.ts.net/ で「みちゆき」が開く

# ポート変更する場合は ~/companion/games/.env に GAMES_PORT=xxxxx を置く(EnvironmentFile=-)。
```

## v1 で実装した範囲

### Done
- [x] 配信サーバ(`server/app.py`): 127.0.0.1 bind / 固定 allowlist dict 配信 / ディレクトリリスティング無し / Content-Type 明示 / generic エラー / `/healthz` 無認証生存確認 / `GAMES_PORT` env(default 47825)。
- [x] systemd user unit(`systemd/companion-games.service`): WorkingDirectory=%h/companion/games / Restart=on-failure / WantedBy=default.target。
- [x] ゲーム本体(`michiyuki/web`): canvas 全画面横歩き / 長押し(pointer)前進・→/Space でも前進 / フル踏破 約 3.5 分 / パララックス 3 層(決定論的 sin 和ノイズ) / 歩行者シルエット(bob) / progress に沿った空・地面色の線形補間(6 キーフレーム) / 夜の星 / 断章 8 本(opening + waypoint 6 + ending)を閾値到達でフェードイン・タップ dismiss / ending 後の静かな終端。
- [x] 断章テキストは仕様の verbatim を `fragments.js` に構造化(progress 閾値 + text、ending は改行保持)。実装側で改変・創作しない。
- [x] PWA: manifest.json(みちゆき / standalone / 夜明け色基調) / sw.js(shell precache, オフライン再プレイ) / icons 192・512(PIL で夜明け色グラデ生成)。
- [x] 動作確認: `node --check` で app.js / fragments.js / sw.js 構文 OK、manifest.json JSON 妥当、テストポートで配信(全 allowlist 200 + 正 Content-Type / allowlist 外 404 / リスティング無効 / 127.0.0.1 bind)を確認。**ブラウザ目視プレイは環境上未実施**。

### TODO（今後の候補）
- [ ] 音: ambient soundscape の追加(v1 は無音。風 / 足音 / 環境音を progress に連動)。
- [ ] 複数ゲーム gallery 化: umbrella の 2 作目以降が出たら `/` をゲーム選択にし、server STATIC を分割。
- [ ] 断章の増補: 道中の waypoint を増やす / 季節・天候バリエーション。
- [ ] 実機目視プレイでのバランス調整(歩行速度 / 断章の出現タイミング / フォント表示)。
