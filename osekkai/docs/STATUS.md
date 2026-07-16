# osekkai — 夜時間おせっかいシステム 開発台帳

平日 19:00〜24:00 の夜ブロックを対象に、意図 (今夜やりたいこと) → 行動 (PC 活動記録) → 振り返りのループを Telegram で低圧に伴走するシステム。

- **要件正本**: `~/companion/workspace/redesign/osekkai-requirements.md` (§3 は変更不可の合意事項)
- **実装計画正本**: `~/companion/workspace/redesign/osekkai-plan.md` v0.2 (2026-07-15 OWNER 承認済、設計判断 D-1〜D-9)
- **チケット**: #110 (Phase 1 実装) / #111 (OWNER 作業 = AW 導入 + topic 新設、#110 のブロッカー) / #112 (Phase 2 Android) / #113 (Phase 3 中間チェック・締切・フィルタ) / #114 (aw-server Bearer 認証リリース追随 watch)。#108 (要件受領〜計画承認) は 2026-07-15 完了

## 構成 (Phase 1 予定)

```
osekkai/
├── docs/STATUS.md            # この台帳
├── docs/SETUP-windows-aw.md  # [OWNER 作業] Windows ActivityWatch 導入手順書
├── scripts/                  # collector / trigger 判定スクリプト (実装時に作成)
├── systemd/                  # trigger timer 2 本 (実装時に作成)
└── data/                     # activity.db / backlog.json / tonight.json (git 管理外、実装時に .gitignore)
```

実行ログは `~/companion/logs/osekkai/` (repo 外、D-9)。

## 設計判断記録

### 2026-07-15: proactive 3 モードに相乗りしない (チケット #97 非該当の整理)

osekkai の対話は bot の **talk 型 (永続セッション、専用 topic)** で組み、既存 proactive 3 モード (investigate/ticket/remind) の 4 つ目としては追加しない。根拠: 3 モードは毎回新規 uuid の ephemeral session で「報告に OWNER が返信しても、その報告を見ていないセッションが resume される」構造 (bot.py 側に明記)。osekkai は「号令を覚えていて返信を受けて応答する」ことが要件 (§3-2/§3-5) なので構造的に噛み合わない。∴ #97「4 つ目のモード追加時は共通骨格括り出しを先に」のトリガーには**該当しない** (#97 は ephemeral trio の 5 関数トリオ重複が主題で、osekkai はそのコピペを増やさない)。CLAUDE.md 2 周目ルールの作法に基づく事前記録。

### 2026-07-15: ActivityWatch の窓稼働はスタック全体 (aw-qt 起動/停止) を採用

計画 v0.2 D-3 の「手順書作成時に確定」事項。**aw-qt (server + watcher 一式) を Windows タスクスケジューラで平日 19:00 起動 / 24:00 停止**とする。pull の機会は号令 (19 時台)・振り返り (23:30)・前夜分 backfill (翌 19 時台) のすべてが窓内で完結するため、server だけ常駐させても得るものは「日中に pull できる可能性」だけで、要件上日中は対象外 (§3-1)。常駐プロセスを増やさない方を取る。pull 失敗時は N3 + pending リトライで安全劣化 (計画どおり)。

## TODO (Phase 1、計画 §4 の番号)

- [x] 1. **[OWNER 作業]** Windows (m-gamepc) に ActivityWatch 導入 — 手順書 `docs/SETUP-windows-aw.md` に従う (インストール / address 変更 / Firewall / タスクスケジューラ窓稼働) ✅ 2026-07-15 導入完了 + Linux 側から到達確認 OK (下記 Done 参照)
- [x] 2. **[OWNER 作業]** Telegram supergroup に osekkai 用 topic 新設 → thread_id を `bot/.env` の `BOT_THREAD_ID_OSEKKAI` に追加 ✅ 2026-07-15 OWNER が topic 新設、thread_id=1115 を .env に追記済 (claude 実施)
- [x] 4. collector: REST pull (query API、前回 pull 済み以降〜現在) + SQLite 蓄積 (蓄積前にタイトル破棄、exe 名+時間+AFK のみ、保持 90 日) + F3 要約器 ✅ 2026-07-15 `scripts/collector.py` 実装 + 実弾検証 + レビュー OK (下記 Done 参照)
- [x] 5. 意図ストア: backlog.json / tonight.json + flock+atomic write (ytcheck channel_store の型) ✅ 2026-07-16 `scripts/intent_store.py` 実装 + 実弾検証 + レビュー OK (下記 Done 参照)
- [x] 6. trigger: 平日 19 時台 (RandomizedDelay) + 23:30 の systemd timer 2 本 + 判定スクリプト (休むフラグ / 号令済み / 平日判定は state 1 read) ✅ 2026-07-16 `scripts/trigger.py` + `systemd/companion-osekkai-{call,retro}.{timer,service}` 実装 + モック socket 検証 + レビュー待ち (下記 Done 参照)
- [x] 7. bot 側: proactive-v1 envelope の kind 追加 + osekkai topic の on_message 分岐 (専用 system prompt、短 timeout 個別指定、手動開始時の号令済みマーク) ✅ 2026-07-16 実装 + レビュー (軽微 2 反映) + commit `b009917` + bot 再起動・健全性確認 + `companion-osekkai-{call,retro}.timer` の enable まで完了 (下記 Done エントリ参照)
- [ ] 8. 実弾検証: 実際の夜ブロックを 1 周通す。完了条件 = 1 周通過 + OWNER が窮屈と感じないこと。今夜 2026-07-16 (19:11 号令 → 23:38 振り返り) で実施予定

(3. 台帳新設は本ファイルで完了)

## In progress

- **TODO 8 実弾検証**: 今夜 2026-07-16 の夜ブロックで 1 周 (19:11 号令 → 23:38 振り返り) を通す。完了条件 = 1 周通過 + OWNER が窮屈と感じないこと。あわせて TODO 7 の bot 改変 (commit `b009917`) への様子見も継続中。
  - **前半 (号令) 通過確認 2026-07-16 19:11**: timer 発火 19:11:44 → envelope 送信完了 (trigger.log) → OWNER が Telegram 着信を確認 (19 時すぎ)。ただし collector pull は timeout で失敗 (`pull_ok=False` のまま送信、N3 の想定どおり続行)。19:31 時点で AW サーバ (100.100.152.68:5600) は 200/18ms で応答 — 発火時点の一時的な到達不能 (PC スリープ or Tailscale 経路) とみられる。last_pulled_at は 07-15 22:56 JST のまま進んでいないため、23:38 の retro 側 pull が同範囲を再取得して振り返りダイジェストは復旧する設計。残り = 23:38 振り返り通過 + OWNER 窮屈感ヒアリング。

## Done

- **2026-07-16**: TODO 7 完了 (commit `b009917`、bot/) — bot 側 kind ディスパッチ + osekkai topic 永続セッションを実装。**ディスパッチ**: `[[proactive-v1]]` marker は proactive と共有し JSON の `kind` フィールドで判別 (D-2)。`_decode_envelope` (marker+decode 共通ヘルパー) を新設して `parse_proactive_payload` をそこへ委譲するリファクタ (挙動不変) + 兄弟関数 `parse_osekkai_payload` (kind=="osekkai" かつ mode が call/retro のときのみ受理) を追加、`proactive_queue` のサニタイズ済み whitelist 展開は一切通らない。**partial read 対応 (TODO 6 申し送り (3))**: `_handle_notify_connection` を単発 `read(N)` からループ read (EOF まで結合) へ変更 + 各 `read()` に 10s timeout (half-close しない sender での task リーク防止、レビュー指摘で追加)。既存 sender (`maintenance/lib/notify.sh`・`proactive-companion.sh`・`trends-weekly.sh` の `nc -U -N`、`notify-claude-status.py` の `shutdown(SHUT_WR)`) は全て half-close 実装であることを grep して確認済み。**D-1 talk 型永続セッション**: `run_claude` に `timeout_s`/`system_prompt` の optional override を追加 (省略時は従来どおり、既存呼び出しは無変更)。`OSEKKAI_CLAUDE_TIMEOUT` (既定 180s、claude_lock 直列化で通常チャットを塞がないための個別指定、plan v0.2 §3 OWNER 承認済み) と `OSEKKAI_SYSTEM_PROMPT` (PERSONA を土台に D-7 の振る舞い基準 + ytcheck 由来の禁止表現/書き換え方針を積み増し) を新設。`osekkai_queue` + `_osekkai_worker`/`_run_osekkai` (号令/振り返り) を新設、`on_message` に osekkai topic 分岐を追加。**意図記録**: `_osekkai_record_manual_start` が OWNER 発話ごとに `intent_store.py` を subprocess 経由で叩き、号令済みマークを毎回立てる (冪等) + 今夜の意図が未記録なら発話文をそのまま記録 (`tonight_status` 1 read → 未設定なら check-then-set、単一ユーザーなので atomic set-if-absent は不採用)。claude セッションに state 書き込みをさせない OWNER 裁定を維持。**沈黙権の実効化 (レビューで発見・修正)**: `run_claude` は沈黙/timeout/エラー時に空文字ではなく `"[empty output]"` 等の sentinel 文字列を返す契約のため、素朴な空文字判定では D-7 の沈黙権が実効しない。sentinel prefix 判定の `_osekkai_should_send` を新設し `_run_osekkai` (worker) と `on_message` (OWNER 返信) の両経路に対称適用 (最初 worker のみ直して on_message 側の同型リークを見落とし、2 度目のレビュー指摘で追加修正)。同型の穴が既存の `_run_proactive` talk 分岐にもあるが本 TODO のスコープ外として未修正、別チケットでの triage を推奨。**テスト**: 385→437 tests pass (新設 52 件)。**レビュー**: 修正必須 0、軽微 2 点 (read timeout 追加、partial read テストを実際に複数回の物理 `read()` を強制する形に修正) を反映済み。**デプロイ**: `systemctl --user restart companion-bot` 実施、healthy 確認 (active running、`notify socket listening ... osekkai thread_id=1115` ログ確認、osekkai 関連の traceback なし。既存の #109 memo cleanup 警告 (message_id 1017/1018) は本デプロイと無関係の既知問題)。**timer 有効化**: bot 側 commit 直後は auto mode classifier が「実 OWNER に自発的にメッセージを送りうる本番デプロイ操作は teammate-message だけでは正当な同意の基準を満たさない」と判定してブロックしたため、claude 側では未実施のまま報告して停止。**2026-07-16 朝、OWNER が起床して明示承認**、main セッションから `companion-proactive` と同じ symlink 方式で `companion-osekkai-{call,retro}.{timer,service}` 4 unit を `~/.config/systemd/user/` へ symlink 設置 → `systemctl --user enable --now companion-osekkai-call.timer companion-osekkai-retro.timer` を実施。`systemctl --user list-timers` で次回発火を確認 = 号令 **本日 19:11:23 JST**、振り返り **本日 23:38:58 JST**。次は TODO 8 実弾検証
- **2026-07-16**: TODO 6 完了 (commit a05cfa6) — `scripts/trigger.py` 新設 (stdlib のみ、`call`/`retro` の 2 サブコマンド + `--date` 検証用オーバーライド) と `systemd/companion-osekkai-{call,retro}.{timer,service}` 4 本。**ゲート順**: 平日判定 (JST、土日は無音 rc=0) → 休むフラグ (`intent_store.tonight_status` の 1 発読みのみ) → (call/retro 固有) `collector.pull()` を先に実行 (失敗しても続行、N3) → `tonight_mark_called`/`tonight_mark_retro_sent` の `first_call` を見る 1 発判定 (TODO 5 申し送りどおり、read→判断→mark の 2 段にしない) → `first_call=True` のときだけ envelope 構築 + 送信。**envelope**: 既存 `[[proactive-v1]]` マーカーをそのまま使い `kind: "osekkai"` で判別 (D-2、新マーカーは作らない)。スキーマ (call): `{"kind":"osekkai","version":1,"mode":"call","date":"YYYY-MM-DD","pull_ok":bool,"backlog":[{"id":int,"text":str,"deadline":str|null}],"tonight":{...tonight_status 全フィールド}}`。retro はこれに `"activity_summary": <collector.summarize() の日本語ダイジェスト文字列>` を追加 (pull 失敗時は summarize 自体は空データとして正常に「活動データなし」文言を返す、summarize 自体が例外を投げた場合のみ trigger 側で固定の代替文言に倒す)。**送信**: `socket.AF_UNIX` で connect → sendall → `shutdown(SHUT_WR)` (`nc -U -N` と同型、bot.py 側 `reader.read()` の EOF 待ちに対応)。**送信失敗時 (socket 不在含む)**: エラーログ + rc=1 で終了のみ。マークの巻き戻し・リトライ・pending ファイルは作らない (上位 CLAUDE.md 派生原則) — 結果マークが立ったまま当夜沈黙するのは「押し付けない」方向への安全劣化として意図的に許容 (実装時の判断)。**ログ**: `~/companion/logs/osekkai/trigger.log` を自前で `mkdir -p` して書く (proactive-companion.sh の OUR_LOG と同型。systemd `StandardError=append:` は親ディレクトリを自動生成しないため timer 側リダイレクトには頼らない) + stderr 併用。**timer 設定**: 号令 `OnCalendar=Mon..Fri 19:00:00` + `RandomizedDelaySec=50min` (20:00 に溢れない安全マージンを残して 19 時台に収める)、振り返り `OnCalendar=Mon..Fri 23:30:00` + `RandomizedDelaySec=10min` (就寝直前の合図なので号令ほど大きくずらさない)。両方とも `Persistent=false` — 号令/振り返りとも「夜ブロックの入口/出口」を示す時刻依存の合図であり、マシンが寝ていた分の catch-up 発火は文脈的に不自然 (23 時に号令が来る等) と判断したため (companion-proactive/ytcheck の `Persistent=true` とは意図的に非対称、実装時の判断)。**検証**: モック socket (bot.py `_handle_notify_connection` と同じ `reader.read(NOTIFY_SOCKET_MAX_BYTES)` 呼び出し 1 発で受信する自作 asyncio サーバ。**訂正**: `asyncio.StreamReader.read(n)` は EOF まで読み切るループ処理ではなく「バッファにある分をそのまま返す」仕様 — 今回の検証サイズ (数百バイト、送信側 1 回の `sendall()`) では 1 回の `read()` で全文が揃ったため実害はなかったが、bot.py 本体の実装も同じ単発 read である点は TODO 7 への申し送りとして上記 TODO 7 行に追記済み。かつ TODO 7 で実装される想定の「`kind=="osekkai"` を専用ディスパッチする」将来の bot 挙動を模してテスト) に対し、call/retro 各初回送信・同日 2 回目 dedup (送信されない)・週末 (2026-07-18 土曜) 無音・休むフラグ ON での call/retro 両方無音・collector pull 失敗 (到達不可 `http://127.0.0.1:1`、N3: 号令は pull_ok=false のまま送信される) を実施しすべて期待どおり。送信失敗系は socket 不在パスに向けて実行し rc=1 を確認、かつ直後に `tonight-status` を引いて `called=true` のまま (ロールバックなし) であることを確認。検証時は `OSEKKAI_BACKLOG`/`OSEKKAI_TONIGHT`/`OSEKKAI_DB`/`OSEKKAI_AW_URL`/`OSEKKAI_LOG_DIR`/`OSEKKAI_SOCK` を env override して scratchpad (socket ファイルのみ AF_UNIX のパス長上限 108 バイトの制約で `/tmp` 直下) に切り替え、実 `data/` は未変更 (確認済み)。systemd unit 4 本は `systemd-analyze verify --user` で構文検証のみ実施 (`~/.config/systemd/user/` へのインストール・enable・start はしていない)。実 bot socket への送信も未実施。**レビュー**: 修正必須 1 点 (TODO 7 前提条件の未記載 — timer 有効化を TODO 7 実装後に限定する根拠が抜けていた、上記 TODO 7 行に反映) + 軽微 2 点 (socket path フォールバックを bot.py 本体に揃える、検証記述の `reader.read()` 挙動の正確化) をすべて反映済み
- **2026-07-16 01:12**: TODO 5 完了 (commit 7d6928a、.gitignore 追補は d23b914) — `scripts/intent_store.py` 新設 (stdlib のみ)。ytcheck `channel_store.py` の flock(LOCK_EX) + 同ディレクトリ tmp + os.replace を流用しつつ、`data/` が git 管理外のため git 自動 commit 部分は持ち込まない。**スキーマ**: backlog.json = `{"items": [{"id", "text", "deadline", "created_at", "done", "done_at"}]}` (id は既存最大+1)。tonight.json = JST 日付キー付き dict、各エントリに intent/resting/called/retro_sent とそれぞれの `*_set_at`/`*_at` を持つ (前日フラグが当日判定を誤らせない構造、D-8)。**CLI 8 サブコマンド** (backlog-add/list/complete、tonight-intent/rest/called/retro/status) をモジュール関数と両方提供、TODO 6/7 は subprocess でも import でも呼べる。`tonight-status` は機械可読 JSON を stdout に出す契約。**二重発火防止**: `tonight_mark_called()` / `tonight_mark_retro_sent()` は冪等かつ、今回の呼び出しが初回マークだったかを示す `first_call` を返り値に含める (tonight.json には persist しない) — 消費側は「mark して first_call を見る」1 発で判定でき、read→判断→mark の 2 段 (二重送信の余地あり) を避けられる。**実弾検証**: CLI/import 両経路で backlog 追加→一覧→完了→冪等確認、tonight の意図記録→号令→休むフラグ→振り返り→当日状態読み、日付跨ぎ相当 (`--date` 別指定) での状態分離、20 並列プロセスでの flock 排他検証 (backlog-add / tonight-called 双方で lost update なし) を実施。code-reviewer レビュー = 修正必須なし、軽微 2 点 (JSON 破損と `--date` 不正のエラーメッセージ分離、`first_call` discriminator 追加) を反映済み
- **2026-07-15 23:02**: TODO 4 完了 (commit ee4d070) — `scripts/collector.py` 新設 (stdlib のみ、`pull` / `summary` / `status` の 3 サブコマンド)。**設計の要点**: (1) aw-server Python v0.13.2 の query API は timeperiod 境界でイベントをクリップして返すことを実測確認 (狭い timeperiod 指定で ts=境界・duration=期間長ちょうど) → 「前回 pull 済み時刻〜現在」の連続 pull がタイル状に隙間なく蓄積でき、「pull 開始時刻以降 delete → insert」の単一トランザクションで冪等。(2) リトライ機構は「失敗時に last_pulled_at が進まない」ことのみ (プロセス内リトライ・pending ファイルなし、state 1 read の型)。(3) D-6 境界は pull 内の 1 箇所 — イベント data から app/status のみ取り出しタイトルは蓄積もログもしない (schema に title 列自体がない)。(4) state は SQLite 一元 (meta.last_pulled_at:デバイス別キー)、複数書き手は busy_timeout で直列化 (flock は JSON 意図ストア側の型)。遡り上限 MAX_PULL_DAYS=7、保持 90 日、`data/` は `.gitignore` で管理外。**実弾検証**: 窓内 (22:56) に pull 87+5 行 → 連続 pull で 1+1 セグメント追加のみ (重複なし) → summary ダイジェスト正常 (galleyhouse.exe 1時間9分 ほか) → 到達不可 URL で rc=1 + state 不変。code-reviewer レビュー = 修正必須なし (軽微 2 点反映: その他行の孤立整形、#114 へクリップ挙動再実測の追記)
- **2026-07-15 21:57**: TODO 2 完了 — OWNER が osekkai topic 新設 (テスト投稿リンク `t.me/c/3851931893/1115/1116` → thread_id=1115)、`bot/.env` に `BOT_THREAD_ID_OSEKKAI=1115` を追記 (.env 中身は読まずキー件数のみで重複なし確認)。bot.py はまだこの変数を参照しないため bot 再起動は不要、TODO 7 の bot 分岐実装時に読み込む。thread_id の実効性 (その topic へ送れるか) の裏取りも TODO 7 で実施。OWNER 作業 2 件が出揃いチケット #111 完了
- **2026-07-15 21:50**: TODO 1 完了 — OWNER が m-gamepc に AW v0.13.2 導入、Linux 側から Tailscale 越しに到達確認 OK (窓内 21:50 実施)。`/api/0/info` 応答 (hostname=m-gamepc, testing=false)、buckets に `aw-watcher-window_m-gamepc` / `aw-watcher-afk_m-gamepc` の両方が存在、window イベントも実データ流入中 (app/title 取得確認)。設定は Python 版 `aw-server.toml` の `host = "0.0.0.0"` で有効だった。残る OWNER 作業は TODO 2 (osekkai topic + thread_id) のみ、claude 側は TODO 4 (collector) から着手可
- **2026-07-15**: Phase 1 着手 (チケット #110)。計画 v0.2 OWNER 承認 → `osekkai/` 台帳新設 + Windows AW 導入手順書 `docs/SETUP-windows-aw.md` 作成。設計判断 2 件 (proactive 非相乗り = #97 非該当、AW 窓稼働はスタック全体) を上記に記録
- **2026-07-14〜15** (チケット #108): 要件受領 (`osekkai-requirements.md`) → §6 前提確認 → §7 調査 (bot 配管 / ytcheck 部品 / ActivityWatch Web 一次情報) → 実装計画 v0.1〜v0.2 → OWNER 承認。経緯は計画正本の改版履歴参照

## 既知の問題

- (なし)

---

**最終更新**: 2026-07-16 19時台 (TODO 8 前半通過 — 19:11 号令発火 + OWNER 着信確認。collector pull は一時的 timeout で `pull_ok=False`、retro 側 pull で復旧見込み。残りは 23:38 振り返り。前回 2026-07-16: TODO 7 完了 + timer enable)
