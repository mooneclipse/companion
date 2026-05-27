# Telegram 移行セットアップ手順書

作成: 2026-05-27 (Phase 2.6 実装着手前検証)
適用日: 2026-06-02 以降 (Phase 2.5 観察期間完了後 cold cut)

設計 center of truth: `~/companion/workspace/redesign/telegram-design.md`
本書の位置付け: BotFather セットアップ + supergroup 構築 + 実機検証 (V-4 / V-5 / V-6) + cold cut 切替手順を 6/2 当日に逐次実行できるチェックリストにまとめたもの。設計判断は本書では行わない (設計は `telegram-design.md` 側に確定済)。

---

## 0. 前提条件チェック

cold cut 着手前に以下が満たされていること:

- [ ] **Phase 2.5 観察期間 2026-05-19 〜 2026-06-02 完了** (N-T3 違反なし)
- [ ] Telegram モバイルクライアント (Android, Pixel-6) でログイン済 (OWNER アカウント)
- [ ] PC 側で `~/companion/bot/` 配下に既存 Discord bot 動作中 (rollback 時の戻り先)
- [ ] `bot/.env` の既存値 (`DISCORD_TOKEN` / `OWNER_ID` / `NOTIFY_CHANNEL_ID` 等) を別ファイルにバックアップ済

---

## 1. BotFather で Telegram bot を作成

### 1.1 BotFather 起動

1. Telegram モバイルで検索: `@BotFather` (青チェック付きの公式 bot)
2. `/start` でセッション開始

### 1.2 新規 bot 作成

```
/newbot
```

BotFather からの質問に順次回答:

1. **bot 名 (display name)**: 任意 (例: `renbot`)
2. **bot username**: `@` で終わる一意な ID。**必ず末尾 `bot` または `Bot`** (例: `companion_renbot`)

成功すると以下のメッセージが返る:

```
Use this token to access the HTTP API:
1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ0123456789

Keep your token secure and store it safely...
```

**この token を漏らさないように記録** (即座に `.env` へ移す、別アプリ経由でコピーしない)。

### 1.3 privacy mode を off に設定 (重要)

bot がグループ内の全メッセージを受信するために必要 (設計 §4.2 段 1〜4 の前提)。

```
/mybots
→ 作成した bot を選択
→ Bot Settings
→ Group Privacy
→ Turn off
```

確認メッセージ:

```
'Privacy mode is disabled for @companion_renbot.
The bot will receive all messages that people send to groups.'
```

bot.py の post_init で `can_read_all_group_messages` をチェックする実装 (設計 §4.2 末尾) があるため、ここで off にしておかないと **bot 起動時に `sys.exit(1)` で落ちる**。

### 1.4 OWNER の Telegram user.id を取得

設計 §8.1 `.env` の `OWNER_ID` に必要。

1. Telegram で `@userinfobot` (青チェック公式) を起動
2. `/start` 送信
3. 返ってくる JSON 中の `Id: 123456789` が user.id

---

## 2. supergroup 作成 + Topics 有効化

### 2.1 supergroup 作成

1. Telegram モバイル → 右上の鉛筆アイコン → `New Group`
2. メンバー追加画面: 何も追加せず右上の → ボタン (OWNER のみで OK)
3. group 名を入力 (例: `companion-renbot`)、`Create`
4. 作成完了 → group プロフィール → `...` → `Convert to supergroup` (Topics 機能は supergroup でのみ使える)

### 2.2 Topics 機能を有効化

1. supergroup プロフィール → 鉛筆アイコン (Edit)
2. `Topics` トグルを ON
3. `Save`

確認: メイン画面に `General` topic が自動作成される。

### 2.3 必要な 4 topics を手動作成 (設計 §6.1)

OWNER が手動で作成 (bot 権限 `can_manage_topics` は付与しない、whack-a-mole 回避):

| # | topic 名 | アイコン | 用途 |
|---|---|---|---|
| 1 | (既定) General | (なし) | scratch / システム通知吸収 |
| 2 | `#chat` | 任意 (💬 推奨) | 既定の `claude -p` 対話 |
| 3 | `#research` | 任意 (🔍 推奨) | Phase 3-1 Web 検索 → vault push |
| 4 | `#maintenance` | 任意 (⚙️ 推奨) | maintenance 通知出口 |

各 topic は supergroup 画面 → 右上の `+` ボタン → 名前入力で作成。

`#aidiary` / `#voice-log` は Phase 4 着手時に実需が出てから手動追加 (YAGNI 原則、設計 §6.1)。

---

## 3. bot を supergroup に admin として追加

### 3.1 bot を add

1. supergroup → メンバー一覧 → `Add Member` → bot username (例: `@companion_renbot`) を検索
2. add 確認 → `OK`

### 3.2 bot を Administrator に昇格

1. supergroup → メンバー一覧 → bot を tap → `Promote to Admin`
2. 権限設定 (Telegram モバイル UI ラベル、ON/OFF を明示):
   - **Delete Messages**: OFF (運用上必須ではない)
   - **Ban Users**: OFF (OWNER 1 人運用)
   - **Manage Topics**: **OFF** (`can_manage_topics: false`、設計 §6.1 通り、whack-a-mole 回避)
   - **Pin Messages**: ON (任意、bot 自動 pin はしないが手動 pin の許可)
   - **Remain Anonymous**: OFF
   - その他はデフォルトのまま
3. `Save`

bot を Administrator にする理由: privacy mode off + Admin で `getUpdates` が全メッセージ + 全 thread の event を返す。Member のみだと topic 関連 event が制限される。

---

## 4. NOTIFY_CHAT_ID + BOT_THREAD_ID_* の取得

### 4.1 取得方法: curl で getUpdates

token を環境変数に乗せて、PC 側 (`~/companion/bot/`) で curl を 1 回叩く。

```bash
# token を bash history に残さないため read -rs で隠し入力
read -rs TELEGRAM_BOT_TOKEN
export TELEGRAM_BOT_TOKEN
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates" | jq .
```

**初回は空応答** (`{"ok":true,"result":[]}`) のはず。bot は何の Update も受け取っていない。

### 4.2 各 topic で 1 メッセージ送信 → getUpdates 再実行

OWNER が Telegram モバイルで以下を実行:

1. supergroup → `General` topic → bot 宛 `@companion_renbot test general` を送信
2. supergroup → `#chat` topic → `@companion_renbot test chat` を送信
3. supergroup → `#research` topic → `@companion_renbot test research` を送信
4. supergroup → `#maintenance` topic → `@companion_renbot test maintenance` を送信

直後に PC 側で curl 再実行:

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates" | jq '.result[].message | {chat_id: .chat.id, thread_id: .message_thread_id, text: .text}'
```

期待される出力例:

```json
{"chat_id": -1001234567890, "thread_id": null, "text": "@companion_renbot test general"}
{"chat_id": -1001234567890, "thread_id": 2,    "text": "@companion_renbot test chat"}
{"chat_id": -1001234567890, "thread_id": 3,    "text": "@companion_renbot test research"}
{"chat_id": -1001234567890, "thread_id": 5,    "text": "@companion_renbot test maintenance"}
```

- `chat.id` (全 message 共通の負値) = `NOTIFY_CHAT_ID`
- `thread_id = null` = General topic (設計 §2.3 の `_general` suffix で扱う)
- `thread_id = 2/3/5` = それぞれ `#chat` / `#research` / `#maintenance` の thread_id

### 4.3 .env に記録 (cold cut 当日に実施、観察期間中は記録のみ)

```bash
# bot/.env (新規追加分、cold cut 6/2 当日に書き込み)
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ0123456789
NOTIFY_CHAT_ID=-1001234567890
BOT_THREAD_ID_CHAT=2
BOT_THREAD_ID_RESEARCH=3
BOT_THREAD_ID_MAINTENANCE=5
BOT_THREAD_ID_VOICE_LOG=     # 空 = MAINTENANCE 落ち (Phase 3-2 追加時に埋める)
```

**観察期間中 (〜6/2) は .env に書かない** (N-T3 違反回避)。値は別途メモ。

---

## 5. 実機検証 V-4 / V-5 / V-6 (cold cut 切替前に実施)

設計 telegram-design §12 で確定した未検証項目。本セットアップ完了後、`bot.service` 起動前に curl で確認する。

### 5.1 V-5: General topic の thread_id 値確認

§4.2 の curl 出力で General topic message の `thread_id = null` (JSON 上は `message_thread_id` field 自体が存在しない) であることを確認済 → **クリア**。

PTB v22 でも同じ: `update.effective_message.message_thread_id` は `None` で返る。設計 §2.3 の `'_general'` suffix 扱いと整合。

### 5.2 V-4: message_thread_id 削除後再利用挙動確認

手順:

1. supergroup で新規 topic `#test-delete` 作成 → OWNER が 1 メッセージ送信 → curl で `thread_id` を取得 (例: `thread_id = 7`)
2. Telegram モバイルで `#test-delete` topic を削除 (topic を long press → Delete)
3. supergroup で別の新規 topic `#test-new` 作成 → OWNER が 1 メッセージ送信 → curl で `thread_id` を取得 (例: `thread_id = 8`)

**期待**: `thread_id` は連番増加 (`7 → 8`)、削除した `7` は再利用されない。

確認できれば設計 §2.4 stale-thread-observation jsonl 運用 (1 回=許容、2 回=2 周目) の前提が成立。

不一致 (thread_id が再利用される) なら `(chat_id, thread_id)` 複合キーが衝突する可能性 → 設計引き直し議論起動。

### 5.3 V-6: can_manage_topics: false 時の挙動確認

bot に `can_manage_topics: false` の状態で `createForumTopic` API を叩く → 403 forbidden が返ることを確認。

```bash
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createForumTopic" \
  -d "chat_id=${NOTIFY_CHAT_ID}" \
  -d "name=test-from-bot"
```

**期待出力**:

```json
{"ok":false,"error_code":400,"description":"Bad Request: not enough rights to manage topics"}
```

(または error_code=403)

確認できれば、bot.py が誤って `createForumTopic` を呼んでも Telegram 側で物理的に弾かれる安全策が成立。bot.py 自体では `createForumTopic` を呼ばない設計だが、念のため。

---

## 6. cold cut 切替日 (2026-06-02 以降) のオペレーション手順

観察期間完了後、本書 §1〜§5 が全て満たされた状態で開始。

### 6.1 切替直前チェック

- [ ] §1.2 で取得した `TELEGRAM_BOT_TOKEN` メモ済
- [ ] §1.3 privacy mode off 設定済
- [ ] §1.4 OWNER user.id メモ済
- [ ] §2 supergroup + Topics + 4 topics 作成済
- [ ] §3 bot を Administrator として追加済 (`can_manage_topics: false`)
- [ ] §4 NOTIFY_CHAT_ID + BOT_THREAD_ID_* メモ済
- [ ] §5 V-4/V-5/V-6 実機検証 pass
- [ ] PC 側で `bot.service` が動作中 (Discord bot)

### 6.2 切替 step

```bash
# 0. cold cut commit が HEAD に来ていることを確認 (requirements.txt 等が Telegram 版になっている前提)
cd ~/companion/bot
git log -1 --oneline   # "migrate Discord to Telegram supergroup topic model" 系の commit を確認

# 1. Discord bot 停止
systemctl --user stop companion-bot.service

# 2. venv 退避 (rollback path、設計 §8.4 devil A7)
mv venv venv-discord-backup

# 3. 新 venv 作成 + 依存導入
python3 -m venv venv
venv/bin/pip install -r requirements.txt

# 4. .env 更新 (バックアップ後)
cp .env .env.discord-backup
# vim .env で TELEGRAM_BOT_TOKEN / NOTIFY_CHAT_ID / BOT_THREAD_ID_* を追記
# DISCORD_TOKEN / NOTIFY_CHANNEL_ID は残置 (rollback 用、bot.py 側は読まない)

# 5. systemd unit reload (description 変更が反映される)
systemctl --user daemon-reload

# 6. bot 起動
systemctl --user start companion-bot.service

# 7. 起動確認
systemctl --user status companion-bot.service
journalctl --user -u companion-bot.service -n 50 --no-pager
tail -50 ~/companion/logs/bot.log
```

### 6.3 起動後 smoke test

OWNER が Telegram モバイルで:

1. `#chat` topic で `@companion_renbot こんにちは` を送信 → bot 応答確認
2. `#research` topic で `@companion_renbot 検索テスト` を送信 → bot 応答 + session が `#research` 用に分かれていること確認
3. `/quota` slash command で予算情報表示確認
4. `/status` slash command で稼働情報表示確認
5. `/reset` slash command で `#research` の session 破棄確認

ledger.jsonl と sessions/topics/ にファイルが正しく作られていることを PC 側で確認:

```bash
ls -la ~/companion/bot/sessions/topics/
tail -3 ~/companion/bot/sessions/ledger.jsonl
```

期待される sessions/topics/ ファイル名:

```
-1001234567890_2.json       # #chat
-1001234567890_3.json       # #research
```

### 6.4 catch-up 経路確認

bot 起動 +15 秒で catch-up 2 通 (notify-unattended-upgrades + system-report) が `#maintenance` topic に飛ぶことを確認:

```bash
journalctl --user -u companion-bot-catchup-unattended-upgrades.service -n 20 --no-pager
journalctl --user -u companion-bot-catchup-system-report.service -n 20 --no-pager
tail -20 ~/companion/maintenance/notify-unattended-upgrades.log
tail -20 ~/companion/maintenance/notify-system-report.log
```

`#maintenance` topic で受信が確認できれば forwarding 経路成立 (silent default + `[critical]` のみ音 ON は設計 §7.3 通り)。

### 6.5 rollback 手順 (障害時)

cold cut +24h 以内に致命的問題が出た場合:

```bash
systemctl --user stop companion-bot.service
cd ~/companion/bot

# Telegram 起動で生成された state を退避 (Discord 版 quota.py が読めない可能性、ledger.jsonl は cut line をメモ)
wc -l sessions/ledger.jsonl  # rollback 時点の行数をメモ (Telegram 由来行の cut line)
mv sessions/topics sessions/.archive/topics-rolled-back/

# venv / .env を Discord 版へ戻す
mv venv venv-telegram
mv venv-discord-backup venv
mv .env .env.telegram-backup
mv .env.discord-backup .env

# bot.py / 関連ファイルを cold cut commit の 1 つ前へ巻き戻し
git log --oneline | head -10  # cold cut commit を特定
git checkout <cold-cut commit の 1 つ前> -- bot.py sessions.py quota.py requirements.txt companion-bot.service .env.example

systemctl --user daemon-reload
systemctl --user restart companion-bot.service
```

rollback 後は `~/companion/workspace/redesign/telegram-design.md` に障害内容を追記し、再設計議論を起動。`sessions/.archive/topics-rolled-back/` は再 cold cut 時の判断材料として保存。

---

## 7. 切替 1 週間後の cleanup

cold cut +7 日経過し問題なければ:

```bash
cd ~/companion/bot
rm -rf venv-discord-backup
rm .env.discord-backup
mv sessions/channels sessions/.archive/channels-pre-telegram  # 設計 §2.5
```

cleanup 後は rollback path が消える。Phase 4 着手判定はさらに +7 日 (合計 14 日観察) 後に評価。

---

## 8. トラブルシュート

### 8.1 bot 起動時に `privacy mode が ON` エラーで sys.exit(1)

→ §1.3 を再実施 (`/mybots` → bot 選択 → Bot Settings → Group Privacy → Turn off)。bot を一度 supergroup から remove して再 add すると Privacy 変更が確実に反映される。

### 8.2 getUpdates で空応答が返り続ける

可能性:
- bot がまだ supergroup に add されていない (§3.1)
- privacy mode が off になっていない (§1.3)
- bot が Administrator になっていない (§3.2、Member のみだと制限あり)
- 既に長時間 bot が動作していて offset 進んでいる → `?offset=-1` 付与で最新 Update のみ取得

### 8.3 Telegram モバイルで bot が見つからない

検索時は `@` 込みの username で検索 (`@companion_renbot`)、display name では引かないことがある。

### 8.4 createForumTopic で 403 ではなく 400 が返る

`Bad Request: not enough rights` の文言を含めば実質同等。404 や 500 が返るなら API 仕様変更の可能性 → V-6 結果を `bot/docs/STATUS.md` に追記して再評価。

---

## 9. 参照

- 設計: `~/companion/workspace/redesign/telegram-design.md` (center of truth)
- 検証結果: `~/companion/bot/docs/STATUS.md` Phase 2.6 section
- Telegram Bot API: <https://core.telegram.org/bots/api>
- PTB v22 docs: <https://docs.python-telegram-bot.org/en/v22.7/>
- BotFather guide: <https://core.telegram.org/bots/features#botfather>
