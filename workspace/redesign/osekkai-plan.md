# osekkai-plan — 夜時間おせっかいシステム 実装計画 (v0.2、OWNER 承認待ち)

- **作成日**: 2026-07-14 (チケット #108)
- **v0.2 (2026-07-15)**: OWNER 裁定を反映 — `/want`・`/retro` 流用検討の撤去、データ最小化 (タイトル非蓄積 + 保持期限、D-4/D-6)、AW の夜間限定記録 (D-3)、週次バックログ反映の Phase 1 縮小 (D-5)、ログ運用ルール (D-9)
- **位置づけ**: 要件正本 `osekkai-requirements.md` §8 step 2 の成果物。step 3 = 本計画を OWNER に提示して承認を得てから実装に入る。**本ドキュメントは承認されるまで実装に入らない**
- **調査の出所**: §6 前提確認は手元実測、§7 調査は researcher 3 本 (bot 配管 / ytcheck 部品 / ActivityWatch Web 一次情報)。要約は各節に根拠付きで転記

---

## 1. §6 前提確認の結果 (2026-07-14 実測)

| 前提 | 結果 |
|---|---|
| Linux 機 claude 認証 | ✅ claude CLI 2.1.209、本セッション自体が稼働証明 |
| Tailscale 接続 | ✅ 本機 100.123.48.81。**m-gamepc (Windows) = active/direct 接続中**、**pixel-6 (Android) = 登録済み (確認時 offline、last seen 5h — スマホの通常挙動)** |
| Telegram bot | ✅ companion-bot active (NRestarts=0)、`bot/.env` 存在 (600、token/chat_id は git 外) |
| ytcheck 稼働 | ✅ `companion-ytcheck.timer` 毎日 05:03 JST 発火中 |

要件 §2/§3-3 の既存スキル (`/want`・`/retro`) 流用検討は **OWNER 指示 (2026-07-15) により対象外** — 意図管理は最初から独自ストアで設計する (D-5)。

**要件書への訂正 1 件**: §6/§9「ytcheck = Telegram/Tailscale 送信の同型先行例」はコード事実と不一致。ytcheck は「timer + 収集 + claude -p + vault ファイル書き込み」までで **Telegram/Tailscale 送信コードは存在しない**。F5 の流用元は companion-bot (こちらに完備)。ytcheck から流用するのは claude -p 骨格・timer 設定・pending リトライ・flock+atomic write の各パターン。

## 2. アーキテクチャ概要 (Phase 1 = PC のみ)

```
[Windows PC (m-gamepc)]
  ActivityWatch (aw-server-rust + aw-watcher-window + aw-watcher-afk)
  待受を Tailscale 到達可に変更 (aw-server.toml [server] address)
        │ REST pull (Tailscale 内、夜ブロック中のみ)
        ▼
[Linux 機 (本機)]
  osekkai/collector  … 生成タイミング直前に on-demand pull → SQLite 蓄積 (F1/F2)
  osekkai/trigger    … systemd timer (平日 19時台 / 23:30) → 判定 → bot socket へ envelope (F7)
  osekkai/data       … activity.db + backlog.json + tonight.json (F2/F6)
        │ Unix socket ([[proactive-v1]] 同型の osekkai 用 envelope)
        ▼
[companion-bot]
  osekkai 専用 topic + 永続 claude セッション (talk 型) → claude -p で文面生成 (F4) → Telegram (F5)
  OWNER の返信 → on_message → 同セッション resume → 応答 (双方向)
```

## 3. 主要設計判断 (D-1〜D-8)

- **D-1 対話は bot 専用 topic + 永続セッション (talk 型)**。proactive 3 モード (investigate/ticket/remind) は ephemeral session で「報告に返信しても文脈が戻らない」構造のため、osekkai の「号令を覚えていて返信を受けて応答する」要件と噛み合わない。**4 モード目としての相乗りはしない** → チケット #97 (3 モード共通骨格の括り出し) の「4 つ目のモード追加」には該当しない、という整理。着手時にこの根拠を osekkai/docs/STATUS.md へ記録する (2 周目ルールの作法)。topic 追加は `BOT_THREAD_ID_OSEKKAI` env 1 個で `sessions.py` 無改修。
- **D-2 トリガーは外部 systemd timer + 判定スクリプト → socket envelope**。proactive-companion.sh と同型。既存 proactive の時間窓 (`PROACTIVE_HOUR_END=22`、23:30 は窓外) や `snooze_until` (ペルソナ全体のグローバルフラグ) とは**独立のゲート**を持つ — 転用すると意味が混線するため。envelope は**新マーカーを増やさず既存 `[[proactive-v1]]` の kind フィールド追加**で判別する (socket 受信段階の判別は JSON envelope 1 回、という bot 既存設計の維持。マーカー 2 種目は 2 周目議論を誘発するため不採用)。
- **D-3 Windows 収集は ActivityWatch REST pull**。`aw-server.toml` の `[server] address` 変更で LAN 待受は公式手順 (remote-server.rst)。取得は query API (AFK 補正済み canonical events) を第一候補、粒度は exe 名 + ウィンドウタイトル全文。**安定版 (v0.13.2) に API 認証は無い** → Tailscale 内限定 + Windows Firewall で Tailscale インターフェースに限定して受容 (Bearer 認証は 2026-04 に master へ入ったが未リリース、リリース後に追随)。**記録自体も Windows タスクスケジューラで 19:00 起動 / 24:00 停止の夜間限定にする** — 「この時間帯以外は対象外」(§3-1) を観測レイヤーでも守る (OWNER 裁定 2026-07-15)。窓稼働の対象を watcher のみ (aw-server は常駐、pull がいつでも通る) にするかスタック全体 (pull も 19 時以降に限る) にするかは**手順書作成時に確定して明記**する — どちらでも pull 失敗時は N3 + pending リトライで安全劣化する。AW は Windows 専用の**差し替え可能な収集部品**として扱い、システムの中心基盤に据えない (リリース停滞気味 + Android 非対応のため)。
- **D-4 蓄積は Linux 側 SQLite** (`osekkai/data/activity.db`)。pull は常時ポーリングせず**生成タイミング (号令/振り返り) の直前に on-demand** で**前回 pull 済み時刻以降〜現在**の範囲を取得して蓄積 (前夜 23:30 前電源断分の backfill もこの範囲指定で自然に拾える)。PC オフライン時は「取れた分で動く」 (N3) — 活動データゼロでも号令は出せる、振り返りは「今夜はデータなし」と言うだけ。ytcheck の pending リトライパターンは失敗時の再取得に流用。schema は backfill に必要な最小限に留め (照会 UI 等は作らない)、**保持期限を設けて古い行は自動削除** (目安 90 日、Phase 3 の頻度調整で見直し可)。
- **D-5 意図管理は独自 JSON ストア新設** (`backlog.json` = 週次バックログ + 締切アイテム、`tonight.json` = 今夜の意図・休むフラグ・送信済みマーク)。Google Calendar 連携は Phase 3 以降のオプション。書き込みは ytcheck `channel_store.py` の flock + atomic write の型を流用 (timer と bot の複数書き手)。
- **D-6 プライバシーは Phase 1 から安全側デフォルト**: claude -p に渡すのは**アプリ/exe 名 + 集計時間 + AFK 状態のみ、ウィンドウタイトル全文は渡さない** (N1)。**ウィンドウタイトルは SQLite への蓄積もしない** — Phase 1〜2 で使わない機微データを溜めない (この機体は TV 共用 + x11vnc 遠隔可、OWNER 裁定 2026-07-15)。タイトルの蓄積・活用 (何の創作か等の解像度向上) は Phase 3 のマスクフィルタ設計とセットで開始する。
- **D-7 トーンは osekkai 専用 system prompt**。§3-4 (提案形・指摘 1 つ・1〜2 文・トリガーなければ沈黙) を明文化し、ytcheck `config.py` の「禁止表現列挙 + 書き換え方針」パターンで埋め込む。口調ベースは Phase 4 確定済みの「対等な相方」に揃える。
- **D-8 頻度制御は tonight.json の送信済みフラグ** (号令 1/日、中間 1/日 = Phase 3、「今日は休む」フラグで当日の以降トリガーを全て沈黙)。判定は state 1 read で決定的に (CLAUDE.md 派生原則)。
- **D-9 ログ運用**: 実行ログは既存慣習どおり `~/companion/logs/osekkai/` (repo 外・バックアップ外)。**ログに生ウィンドウタイトルを出さない** — ログを第 2 の無期限蓄積にしない (アプリ名レベルまで)。Telegram 対話と要約が bot の sessions/・bot.log に残るのは既存 bot と同等で許容。

**claude -p 追加負荷の見積もり**: Phase 1 は 1 晩 2 回 (号令 + 振り返り)。`BOT_REQUESTS_PER_HOUR=20` の枠内で問題なし。ただし bot の `claude_lock` はプロセス全体 1 本 + 既定 timeout 900s のため、osekkai 呼び出しには**短い `timeout_s` を個別指定** (長考不要の短文生成、目安 180s) して OWNER の通常チャットを塞がないようにする。

## 4. Phase 分解 (§8 step 4 準拠)

### Phase 1 — PC のみで夜ブロック一周 (号令 → 観測 → 就寝前 → Telegram)

1. **[OWNER 作業]** Windows (m-gamepc) に ActivityWatch インストール + `aw-server.toml` の address 変更 + Firewall を Tailscale に限定 + **タスクスケジューラで watcher を 19:00〜24:00 のみ稼働** (手順書はこちらで用意)
2. **[OWNER 作業]** Telegram supergroup に osekkai 用 topic を新設、thread_id を `.env` に追加
3. `~/companion/osekkai/` 新設 (docs/STATUS.md、モノレポ方針どおり git init 不要)
4. collector: REST pull (query API) + SQLite 蓄積 (**D-6 の境界はここ — 蓄積前にウィンドウタイトルを破棄し exe 名 + 時間 + AFK のみ書く**) + オフライン耐性 + **F3 要約器** (SQLite → アプリ別集計・AFK 状態のダイジェスト生成)
5. 意図ストア: backlog.json / tonight.json + flock 書き込み
6. trigger: 平日 19 時台 (RandomizedDelay で押し付け感回避) + 23:30 の timer 2 本 + 判定スクリプト (休むフラグ / 送信済み / 平日判定)
7. bot 側: osekkai envelope kind + osekkai topic の on_message 分岐 (専用 system prompt で永続セッション) — **bot.py 中規模改変につき、反映後は PROJECT.md ルールの「変更規模に応じた短い様子見」を設定**
8. 実弾検証: 実際の夜ブロックを 1 周通して完了 (§8 step 5)

意図の週次仕込み (§3-3) は Phase 1 では **Python 直書きの bot コマンドか手書き JSON** で backlog.json に登録する最小形 (`/tweet` の subprocess 書き込みと同型) — **claude セッションに state 書き込みをさせる配管は書き込み境界の拡張になるため Phase 1 では作らない** (自然文からの自動反映は運用後に要否判断、OWNER 裁定 2026-07-15)。tonight.json への意図記録も bot の Python 側が返信テキストを書く。「OWNER 側から『今夜始める』と振る」は osekkai topic への発話がそのまま永続セッションに届くため追加実装なしで成立。**ただし手動開始と timer 号令の二重発火を防ぐため、osekkai topic への OWNER 発話時にも tonight.json の号令済みマークを立てる** (§3-2「押し付けない」の担保)。

### Phase 2 — Android 追加

**aw-android の REST 直接 pull は現状不可能** (待受が 127.0.0.1 固定で公開設定なし)。aw-sync の Android 対応は 2026-07 時点で開発版のみ + 不安定 (onboarding 起動不良 issue #170 等)。着手時に (a) aw-android sync の成熟待ち、(b) Tailscale 越し wireless ADB で `dumpsys usagestats` を pull、(c) 他 OSS、を再調査して決める。**Phase 1 の設計は Android が別経路になる前提 (収集器をデバイス別プラグイン型に)** で組む。

### Phase 3 — 中間チェック / 締切リマインド / プライバシーフィルタ / 頻度調整

21〜22 時の逸脱判定 (宣言した意図 vs 直近活動の差分、逸れている時だけ 1 回)、締切アイテムの残り日数リマインド、ウィンドウタイトルのマスクフィルタ設計 + **蓄積・活用の開始** (D-6 で Phase 1 は非蓄積)、実運用フィードバックでの頻度・文面調整。

## 5. リスクと妥協点

- **aw-server 無認証**: Tailscale 内の他デバイスからは無制限アクセス可能な状態が残る (全員 OWNER の端末なので実質リスク低)。Bearer 認証リリースで追随する
- **PC 未起動の夜**: 活動観測なしで号令・振り返りだけ動く (設計内)
- **PC は使ったが 23:30 前に電源断**: 当夜 pull は失敗するが aw-server 側に履歴が残るため翌号令時の pull で backfill 可能。当夜の振り返りは「データなし」と断定せず「もう PC 落とした? 今夜どうだった?」と対話で聞く文面に倒す
- **claude_lock 競合**: osekkai 側 timeout 短縮で緩和 (上記見積もり)
- **本機リソース** (RAM 3.7Gi/HDD): pull + SQLite は負荷軽微、常駐追加なし (timer 起動の oneshot のみ)
- **低圧性 (N2) の実効性**: 文面は実弾でしか検証できない — Phase 1 完了条件を「夜ブロック 1 周 + OWNER が窮屈と感じないこと」とし、感触次第で文面・頻度を最優先で調整

## 6. OWNER への確認事項 (承認ゲート)

1. **計画全体の承認** (§8 step 3。承認後に実装チケットを切って着手)
2. Windows への ActivityWatch 導入・設定変更は **OWNER 作業** になる (手順書は用意する)
3. **無認証 aw-server を Tailscale 内で公開する妥協** (上記リスク) の受容可否
4. Telegram に **osekkai 専用 topic を新設** する運用でよいか (#chat 相乗りはペルソナ雑談との混線と引き換えに topic 追加不要 — 推奨は専用 topic)
