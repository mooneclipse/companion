# remote-design.md (companion-remote 設計議論 brief)

version: v0.1 (議論前 brief、agent team `companion-remote-design` で v1.0 に確定する起点)
作成: 2026-05-20
ステータス: **議論未着手**。本ファイルは team 起動時に lead が teammate へ配布する起点ドキュメント。

---

## 0. 目的と非目的

### 目的

スマホ (Pixel-6、Tailnet 同居) を Linux Mint 機 (miho-inspiron-3521) 専用の「軽量リモコン」にする。

- 素早い open → 1〜2 タップで操作 → close
- 完全個人利用 (miho 1 人のみ、家族端末・友人端末からの利用想定なし)
- Discord アプリのアカウント切替制約 (bot 認可アカウント ≠ user 通常アカウント) を回避
- companion 機の既存資産 (bot / voice / vault / dashboard) を **疎結合に** 操作可能

### 非目的

- push 通知 / バックグラウンド処理 (要件: user 明示で「不要」)
- スマホハード活用 (カメラ・センサ・GPS、要件: 不要)
- 外部公開 (Tailnet 外からのアクセス、絶対に作らない)
- マルチユーザ (家族・友人含めゼロ)
- ストア配布 (個人利用前提、apk/ipa 配布も不要)
- PROJECT.md Phase 4 (キャラクター層) との接続 (リモコンは「土管」側、装飾は乗せない)

---

## 1. 確定済み要件 (このセッションで user 確認済)

- 構成: **PWA + Tailscale Serve** の方針 (user 同意済、ネイティブ Android / Termux 案は却下)
- セキュリティ最重視: 外部からの侵入を起こさないこと
- 既存 PC 資産との関係: bot.py / bot.service / voice/ には触らない (Phase 2.5 健全性観察と独立)
- 起動方式: スマホ Chrome → ホーム画面追加 → アイコンタップで全画面起動

---

## 2. セキュリティ要件 (このセッションで user 同意済の 3 層)

### 2.1 ネットワーク層 (Tailscale)

- サーバは `127.0.0.1:<port>` バインドのみ。0.0.0.0 / `*` 厳禁
- 外向き口は `tailscale serve` 経由だけ。Tailnet 内のみ到達
- **`tailscale funnel` 絶対禁止** (外部公開コマンド、誤発射防止で settings.json `deny` に登録済)
- `ufw` 等のホストファイアウォール検討 (`allow in on tailscale0` だけにする)

### 2.2 アクセス層 (Tailscale ACL)

- Tailscale 管理画面 ACL で「該当 PC の HTTPS port に到達できるのは Pixel-6 だけ」と明示
- ACL タグ運用検討 (アカウント乗っ取り時に新規追加デバイスが即座に届かない構成)
- `tailnet lock` 有効化検討 (議論項目)

### 2.3 アプリ層 (1 段認証)

- 初回ロード時にランダム生成トークン → スマホ localStorage 保存 → `Authorization: Bearer ...` で API 保護
- Tailscale クライアント識別 (`$TS_REMOTE_ADDR` chk) との二段化は議論項目 (多層化のコスパ)
- トークン失効・再発行 endpoint を最初から用意 (スマホ紛失時の対応)

---

## 3. 技術選択肢 (議論で確定する箇所)

### 3.1 サーバ実装

- 候補 A: **FastAPI + uvicorn** (Python、bot/quota.py 等と統一可能、依存軽量)
- 候補 B: aiohttp / Flask + gunicorn (Python、別実装)
- 候補 C: Go / Rust などコンパイル言語 (依存最小、ただし companion 機の他資産と乖離)

**default 案**: A (Python、既存 ecosystem と整合)

### 3.2 PWA フロント

- 候補 A: **素の HTML/JS + manifest.json + 最小 service worker** (依存ゼロ、ビルド工程なし)
- 候補 B: Vite + (React | Vue | Svelte) (DX 良いが依存重い、apk 同等のオーバーヘッド)
- 候補 C: HTMX + 配信側 SSR (zero JS framework、Python サーバと相性良い)

**default 案**: A (個人利用 PWA はビルド工程いらない、yaml で要件足りる)

### 3.3 配信方式

- 候補 A: **`tailscale serve https / http://localhost:<port>`** (HTTPS 自動 + Let's Encrypt MagicDNS 証明書)
- 候補 B: nginx reverse proxy + `tailscale serve` で前段
- 候補 C: 平文 HTTP のまま Tailnet 内提供 (Tailscale 暗号化で代替)

**default 案**: A (HTTPS 化は service worker 動作要件、Tailscale 標準機能)

### 3.4 サーバ起動方式

- 候補 A: **systemd user service** (常駐、再起動自動復帰、bot.service / voice/ と同 pattern)
- 候補 B: cron / oneshot (常駐不要、起動オーバーヘッド許容)

**default 案**: A (リモコンは「いつでも開けば動く」のが価値、常駐前提)

---

## 4. 機能スコープ (議論で確定する箇所)

リモコンに載せる「機能」を最小から積む。MVP v1 → v2 と拡張する設計。

### 4.1 MVP v1 候補機能 (議論で取捨選択)

以下のうち、agent team で **3〜5 機能** に絞る。

| # | 機能 | 内容 | bot との関係 |
|---|---|---|---|
| F-1 | 任意テキストを Claude Code に流す | Discord bot 経由と同等の `claude -p` 呼び出し | bot 経由 or 直接 |
| F-2 | voice/say.sh で発話 | bot `/say` と同等 | bot 経由 or 直接 |
| F-3 | 各種ステータス表示 | bot `/status` / `/quota` 同等 | bot 経由 or ledger 直読 |
| F-4 | vault notes 検索 / 閲覧 | grep + Markdown 表示 | 直接 (vault clone を読む) |
| F-5 | TV ダッシュボード on/off | dashboard.service / dashboard-stop.service 手動 trigger | 直接 (systemd user) |
| F-6 | system レポート即時実行 | maintenance notify-system-report.sh 手動 trigger | 直接 |
| F-7 | 音量・画面・電源など OS 操作 | xrandr / pactl / loginctl など | 直接 |
| F-8 | unattended-upgrades 結果再確認 | maintenance notify-unattended-upgrades.sh 状態表示 | 直接 |

### 4.2 設計分岐 (議論の中心)

リモコンが既存 bot に対して **どういう関係を持つか** で大きく 2 案:

- **案 X: 薄い HTTP shim** — リモコンは bot Unix socket / slash command を HTTP で叩き直す薄いラッパ。bot.py が center of truth、リモコンは UI のみ
- **案 Y: 独立した責務サーバ** — リモコンは bot に依存せず直接 systemd / vault / voice を叩く。bot は Discord 経路、リモコンは Web 経路、両方並列
- **案 Z: ハイブリッド** — F-1 / F-2 / F-3 は bot 経由 (会話状態が bot にある)、F-4〜F-8 は直接

**default 案**: Z (会話状態のある操作だけ bot を尊重、ステートレスな OS 操作は直接)

devil's advocate には「Z の境界が曖昧で whack-a-mole になる」観点で反証してもらう。

---

## 5. Open Questions (team で確定すべき項目)

### q-1: アプリ層認証の強度

- a. ランダムトークン 1 個 (localStorage、永続)
- b. 短期トークン + refresh
- c. WebAuthn (スマホ指紋・PIN)
- d. Tailscale 識別だけで OK (アプリ層認証なし)

→ default: a (個人利用、Tailscale ACL で既に守られている前提で 1 段だけ追加)

### q-2: bot との責務境界 (§4.2)

→ X / Y / Z のどれを採用するか。default: Z

### q-3: PWA service worker のスコープ

- offline 対応する? (Tailnet 切断時の UI 表示だけでも valuable か)
- アプリ shell のキャッシュ戦略 (stale-while-revalidate / network-first)

→ default: 最小 service worker (manifest + 起動アイコンのみ、offline 不要)

### q-4: HTTP API バージョニング

- `/api/v1/...` を最初から切る? それとも v1 暗黙 (個人利用なので破壊的変更許容)

→ default: 個人利用なので暗黙 v1、必要になったら切る (YAGNI)

### q-5: ログとオブザーバビリティ

- リモコン操作ログをどこに残す? (bot.log / 専用 ledger.jsonl / journalctl)
- 失敗時の user へのフィードバック手段 (UI トースト / bot DM 通知 / silent)

→ default: 専用 `remote/.state/access.log` (append-only)、失敗は UI トーストで完結

### q-6: bot 機能との重複時の挙動

- 例: F-2 で「リモコンから /say した発話」は bot `voice_ledger.jsonl` に書く? 別 ledger?

→ default: voice_ledger.jsonl に source=remote と付けて統合 (voice/STATUS.md v2.0 §1.8 と整合)

### q-7: スマホ紛失・トークン漏洩時の運用手順

- Tailscale 管理画面 device revoke の手順を STATUS.md に書面化
- アプリ層トークン無効化 endpoint の認証経路 (リモコン UI から / SSH から)

→ default: SSH ログインで `remote/.state/tokens.json` を空にする手動手順 (UI 経由は循環参照)

### q-8: tailscale serve の persistent 設定

- `tailscale serve --bg` で永続化? それとも systemd user service で叩き直し?

→ default: systemd user service で `tailscale serve` 設定 + アプリサーバ起動を 1 ユニットに

### q-9: スマホブラウザ間の動作要件

- Chrome only? Firefox / Samsung Browser サポート?

→ default: Chrome のみ動作確認、他ブラウザは best-effort (Pixel-6 default Chrome 想定)

### q-10: 開発・iteration 環境

- ローカルで開発する場合の dev 経路 (Tailscale 経由 vs SSH ポートフォワード)
- ホットリロード戦略 (静的アセット mtime watch / 手動 reload)

→ default: 開発中は SSH ポートフォワード + Chrome DevTools、本番投入時に tailscale serve に切替

---

## 6. team 設計 (agent teams 起動仕様)

### 6.1 team 名

`companion-remote-design`

### 6.2 役割 (4 teammate + lead)

CLAUDE.md「Agent Teams 運用方針」§C (devil's advocate 必須) 遵守。

| role | 担当 | tools |
|---|---|---|
| lead (= 通常 claude セッション) | orchestration / approve / 成果物書き起こし | full |
| architect | §3 技術選択肢 / §4.2 責務境界 / §5 q-2,q-3,q-4,q-8 | read-only + plan mode |
| ux | §4.1 機能スコープ / §5 q-3,q-5,q-9 / リモコン UX 全般 | read-only + plan mode |
| security | §2 セキュリティ層 / §5 q-1,q-7 / 攻撃面分析 | read-only + plan mode |
| devil's advocate | architect / ux / security plan への反証 / 採用前検証項目の列挙 / 案 Z (§4.2) の whack-a-mole リスク | read-only + plan mode |

### 6.3 spawn 前 pre-approval (settings.json に登録済)

CLAUDE.md「Agent Teams 運用方針」§E (permission pre-approval 必須) 遵守。本ファイル §7 で確認。

### 6.4 議論ラウンド設計 (CLAUDE.md §B-2 cross-review 精度向上適用)

- Round 1: 各 teammate が独立に v1.0 plan 起案
- Round 2: 各 teammate が **他 teammate の Round 1 最新 plan を読み切ってから** cross-review (改版履歴 section 必須、比較対象 plan version 明示書式)
- Round 3: devil が致命級指摘を整理、lead が plan_approval_response 前に **plan ファイル全体読み直し** + inbox 再読 (CLAUDE.md §B / §D 落とし穴対策)
- 確定後、lead が `remote-design.md` v1.0 に書き起こし、`remote/docs/STATUS.md` にサブタスク分割を反映

### 6.5 plan vs 成果物の役割分離 (CLAUDE.md §F)

- plan ファイル (`~/.claude/plans/companion-remote-design.md`): 議論アーカイブ、改版履歴含め肥大化許容
- 最終成果物: 本ファイル v1.0 (`workspace/redesign/remote-design.md`) + `remote/docs/STATUS.md` サブタスク
- team cleanup で plan ファイルは消える、lead が center of truth として転記責任

### 6.6 user 確認が要る項目 (議論起動前)

team 起動前に user に確認すべき項目を以下に列挙。本リスト 8 項目に user が回答してから team spawn。

- **u-1**: §5 q-1〜q-10 の default 案で議論を進めて良いか? それとも user 側で先に動かしたい default があるか?
- **u-2**: §4.1 機能スコープのうち、MVP v1 で **絶対欲しい** ものを 1〜2 個指定 (なければ teammate に丸投げで OK)
- **u-3**: §4.2 案 X / Y / Z のどれを軸にするか (default Z で議論進めても OK、ただし user の感覚と違うなら指定)
- **u-4**: スマホ側ブラウザは Chrome 想定で良いか? (q-9)
- **u-5**: アプリ層認証は a (ランダムトークン localStorage 永続) で良いか? それとも b/c/d 検討?
- **u-6**: 開発期間中の dev 経路 (SSH ポートフォワード 想定で良いか)
- **u-7**: 完了基準を「リモコンから F-X を叩ける」のどこまでとするか (3 機能? 5 機能? 全機能?)
- **u-8**: 着手のタイミング (今すぐ team 起動 / Phase 2.5 健全性観察 = 2026-06-02 まで待つ / voice/ 側 bot 実装完了後)

---

## 7. spawn 前チェックリスト (CLAUDE.md「Agent Teams 運用方針」遵守)

- [x] devil's advocate を role に組み込み済 (§C)
- [ ] u-1 〜 u-8 user 回答取得 (§6.6)
- [ ] permission pre-approval `.claude/settings.json` に反映 (§E、本セッションで実施済 → §7.1 で確認)
- [ ] plan mode + plan_approval_request 必須運用宣言 (本ファイル §6.4 で明示)
- [ ] cross-review 精度向上 4 項目を team prompt に組み込み (§B-2、本ファイル §6.4)
- [ ] team spawn 直前に本ファイルと STATUS.md を最新版で読み直す (§B)

### 7.1 pre-approval された Bash コマンド (本セッションで `.claude/settings.json` 追加分)

```
Bash(tailscale status*)
Bash(tailscale ip*)
Bash(tailscale netcheck*)
Bash(tailscale version*)
Bash(tailscale serve status*)
Bash(tailscale cert*)
Bash(ss:*)
Bash(netstat:*)
```

deny に登録 (誤発射防止):

```
Bash(tailscale funnel:*)
```

ask に登録 (状態変更系、user 1 回承認で許可):

```
Bash(tailscale serve:*)
```

---

## 改版履歴

- v0.1 (2026-05-20): 初版、議論前 brief。lead は本ファイルを起点に team `companion-remote-design` を spawn 予定
