# companion-voice 開発台帳（Phase 3-2: TTS (VOICEVOX)、技術基盤完成で畳み・bot 統合 Phase 4 移送）

最終更新: 2026-06-12 (voice bot 統合 **完了** — bot/ 側実装 + say.sh 追記化 + speaker 11 切替 [.env は未作成と判明し user が新規作成] + restart + V-S1/V-S2 実弾 pass。完了基準 3 階層すべて達成、以後 bot.py 大改変の様子見観察)

## 2026-06-12 persona 軸 2 確定の反映: speaker = 玄野武宏 + 発話レイテンシ設計判断

persona 軸 2 (Phase 4「声の確定」、チケット #4) で **speaker = 玄野武宏 (ノーマル speaker_id=11、他スタイル: 喜び 39 / ツンギレ 40 / 悲しみ 41)** が OWNER 確定 (2026-06-12)。選定経緯・根拠 3 点 (スタイル数 / claude code 通知音声との声統一 / 軸 1 整合) は `~/companion/persona/docs/STATUS.md` 軸 2 section が center of truth。本台帳への影響:

- **四国めたん id=2 は技術検証時の仮置きとして据え置き** (`.env` の `VOICE_DEFAULT_SPEAKER=2` は変更しない)。**11 への切替は voice bot 統合タスク (軸 2 が gate、本台帳 TODO 4 の bot/ 側実装) で実施**。軸の確定は概念記録のみで挙動を変えない (persona 台帳「重要な注記」原則)
- **発話レイテンシの設計判断 (OWNER 確定 2026-06-12)**: この機材 (AVX1 / RTF 2.1-3.0 warm、31 字 17s・85 字 39s 実測) で**合成速度の改善は追わず「生成と再生の分離」で吸収する**。根拠 = 主用途の自発発話 (persona 軸 4「同じ部屋にいる相方」) は返事を期待しない一方通行で、生成を待つ主体がいない。テキスト確定 → 裏で合成 → 完成後に再生、にすればレイテンシは UX 要件から消える。voice bot 統合で自発発話に声を載せる際はこの形 (同期待ちしない呼び出し) で設計する
  - 検討した代替案と見送り根拠: 定型句 wav キャッシュ (自発発話は文面が毎回変わり効果が限定的、後のせ可) / エンジン切替 (AivisSpeech は CPU でより重い可能性、OpenJTalk 系は声質がキャラ性と相反。trigger 表「AivisSpeech 並行 RTF 実測」は従来どおり残置) / 別マシンへの合成オフロード (相手マシンの uptime に発話可否が依存し、本機完結の現設計を崩す)。いずれも対話的発話の実需が出てから再評価
  - **対話経路 (`/say`) との関係**: latency-sensitive なのは bot `/say` のみだが、こちらは軸 5 M-8 (voice-design.md v2.0、bot.py 100 字クリップ + `wait_for(90s)`、100 字 = warm 46s + cold 17s = 63s で余裕 27s) で手当て済み。再調整は K-16 trigger (rc=99 発火率 1% 超) に従い、数値の場当たり変更はしない。`/say` 運用頻度が上がる場合の engine 常駐化 trigger (1 日 5 回超 × 1 週間) も従来どおり

## 2026-06-01 方針転換: Phase 3-2 を畳み、bot 統合を Phase 4 へ移送

user 判断 (2026-06-01): voice の日常利用シーンが薄い (テレビ起動時は dashboard / YouTube 視聴) ため voice bot 統合を一旦後回し、Phase 3 を畳んで Phase 4 (相棒層) に進む。これに伴う本台帳の扱い:

- **voice/ 側技術基盤 (say.sh / bin/ / systemd unit) は完成済 (2026-05-19 完了基準 (i) 達成)。これをもって Phase 3-2 を畳む。**
- **bot/ 側統合 (voice_command.py / voice_status.py / voice_ledger.jsonl / bot.py slash registration、本台帳 TODO #4) は Phase 4「声の確定」と一体化して移送。** 声 = キャラクター性そのもので、キャラ確定後に bot へ声を載せる方が手戻りが出ない (PROJECT.md「機能先・キャラは後のせ」原則と整合、改修総量 ~15%)。
- **voice-design v2.0 の Phase 4 trigger (下記「Phase 4 trigger 再定義」section の #1 数値化 = bot /say 14 日 10 回 + 週 5 回 × 2 週間、素声運用 2 ヶ月上限) は companion 全体の Phase 4 着手判断から切り離す。** これらは「voice を日常運用する前提」の設計で、user 実態 (voice 非日常使用) で前提が成立しない。**撤回ではなく「Phase 4 着手後に voice をどう載せ拡張するかの判断材料」へ格下げ。** voice-design v2.0 の設計内容自体は Phase 4 の素材として残す。
- companion 全体の Phase 4 着手条件 #1 は vault 同期 (Phase 3-1) で形式充足 (PROJECT.md 着手条件 #1 2026-06-01 更新)。voice 頻度は #1 の根拠に使わない。
- **同日追加判断 (2026-06-01): 条件 #2 (2 週間観察) を Phase 4 着手の門から外す (bot.py 大改変時の様子見へ再定義)。Phase 4 着手自体は条件 #1 (vault 充足) + #3 (user 宣言) で進む。** voice bot 統合は Phase 4 中の bot.py 大改変にあたるため、これを入れるときはその変更に様子見観察を適用する (Phase 4 着手後の bot.py 大改変として様子見付き)。観察を Phase 4 着手の門にはしない。

詳細根拠: PROJECT.md 健全性履歴 2026-06-01 entry (「追加判断」section)。

## 設計メモ

- Phase 3-2（PROJECT.md L143-188 の Phase 3 ロードマップ「2. TTS（VOICEVOX）」）。**bot 駆動 `/say` slash command (24h 受付) + CLI consumer API (say.sh)** を Phase 3-2 で整備、朝自動発火 (morning-greeting) は Phase 4 punt
- 確定設計: `~/companion/workspace/redesign/voice-design.md` **v2.0** (2026-05-19, team `companion-voice-design` v2.0 仕切り直し議論 Round 1〜3 + lead 集約 + user 確定)
- 着手前 user 判断履歴: `~/companion/workspace/redesign/voice-questions.md` (v1.0 Q1-Q6 確定済) + 2026-05-18 user 追加 Q 2 件 (時間帯 24h 受付 / 朝挨拶 UX 完全 punt) で v2.0 方針確定

### 構成サマリ (voice-design.md v2.0 §0)

- **エンジン**: VOICEVOX 0.25.2 CPU mode、配布は公式 7z 自己展開、T-1 sprint #1 で AVX1 適合 1 回確定済
- **キャラ**: 四国めたん (speaker_id=2、T-1 sprint #1 V-15 で `/speakers` API 実機確認済)
- **駆動**: **bot 駆動先行 (`/say` slash command、24h 受付)**、朝自動発火 (旧案 A T2 = 6:30 timer) は Phase 4 punt
- **完了基準**: 3 階層 — (i) `say.sh` CLI 手動 invoke で発話成功、(ii) bot `/say` 経由発話 + bot `/status` voice 集計表示、(iii) V-0a/V-1/V-2/V-3/V-3a/V-15 + V-S1/V-S2 全 pass
- **failure mode 3 段階保険** (v1.0.2 4 段階から再構成): (1) bot interaction.followup 即時 / ~~(2) 9:00 サマリ撤回~~ / (3) 12:00 昼通知 trigger 再定義 + padding skipped trigger / (4) bot `/status` 統合 (Phase 4 punt 撤回で前倒し)

### 既存への副作用 (voice-design.md v2.0 §0)

- **bot/ 側**: bot.py に voice_command.py 分離 (devil T-D-1(b) 採用) + voice_status.py 新規 + voice_ledger.jsonl (append-only、Phase 4 trigger 集計元) 追加
- **maintenance/ 側**: `maintenance/scripts/notify-system-report.sh` 末尾 5 行追加 (12:00 昼通知 trigger 再定義、過去 24h voice FAIL ≥ 3 件 or padding skipped ≥ 5 件)
- **dashboard 側**: 変更なし (v1.0.2 で lead 例外承認だった「ExecStopPost 1 行追加」は v2.0 で撤回、「dashboard コード変更ゼロ死守」原則に復帰)
- **Phase 2.5 T-D 後半 (2026-05-19 即時前倒し完了) との順序** (v2.0.2 で voice/ 側前倒し + 2026-05-19 で T-D 後半も即時前倒し):
  - **voice/ 側 (bot.py を触らない部分: say.sh / bin/ / systemd/companion-voice-engine.service / git init)** → 2026-05-19 完了 (T-1 sprint #1 + V-S1 + 完了基準 (i) 達成)
  - **Phase 2.5 T-D 後半 (CreditBudgetGuard、bot/quota.py + bot.py)** → **2026-05-19 即時前倒し完了** (bot/docs/STATUS.md 2026-05-19 Done エントリ参照)
  - **Phase 2.5 健全性 2 週間観察** → 2026-05-19 〜 2026-06-02 (T-D 後半完了起点)
  - **bot/ 側 (voice_command.py / voice_status.py / voice_ledger.jsonl / bot.py への slash registration)** → Phase 2.5 健全性 2 週間観察完了後 = 2026-06 上旬目処 (元案 2026-06 中下旬から前倒し)
  - 前倒し根拠: devil T-D-1(d) 構造原則 (bot.py 同時 2 方向回避 + Phase 2.5 健全性 2 週間観察) は維持、ただし観察起点が 2026-05-19 に早まったため bot/ 側着手も 2026-06 上旬に前倒し。新規設計判断ではなく観察カウントの自動前倒し

### ディレクトリ構成 (voice-design.md v2.0 §1.6)

```
voice/
├── bin/
│   ├── voice-engine-up.sh        # 7z 展開済 run バイナリ exec
│   └── voice-engine-ready.sh     # /version 200 polling 30s benign give-up
├── scripts/
│   └── say.sh                    # consumer API (exit code 6 段階 + flock 1 段 + notify socket + last-result + 引数長 multi-tier + silence padding 1 秒)
│                                 # ※ morning-greeting.sh は作らない (Phase 4 punt)
├── systemd/
│   └── companion-voice-engine.service   # Type=simple, Restart=no, WorkingDirectory=engine/linux-cpu-x64/
│                                        # ※ voice-greeting.service / .timer は作らない (Phase 4 punt)
├── engine/linux-cpu-x64/                # 公式 7z 展開 (.gitignore)
├── docs/STATUS.md                       # 本ファイル
├── .state/                              # last-result-YYYY-MM-DD、0600 (.gitignore)
├── .env                                 # VOICE_DEFAULT_SPEAKER=11 等 (.gitignore、2026-06-12 user 新規作成)
├── .gitignore                           # engine/, .state/, .env
├── README.md                            # 用途・起動方法 (bot 経由が主、CLI 手動デバッグ可)
└── SETUP.md                             # 公式 7z DL + 展開手順 4 行 + ffmpeg install
```

**bot/ 配下の追加** (Phase 3-2 で voice/ と並行、別 commit、Phase 2.5 T-D 後半完了 + 健全性 2 週間観察完了後 = 2026-06 上旬目処):
- `bot/voice_command.py` 新規 (cmd_say + ledger 追記、Phase 2.5 T-D `quota.py` パターン継承)
- `bot/voice_status.py` 新規 (format_voice_summary、bot.py cmd_status に append)
- `bot/voice_ledger.jsonl` 新規 (append-only、Phase 4 trigger 集計元)
- `bot/bot.py` に slash registration + import 1 行追加

### say.sh CLI API 契約

`voice-design.md` v2.0 §1.4 を center of truth として参照。引数長 **multi-tier** (v2.0 衝突 2 lead 裁定):

- bot.py `/say` text 引数: **100 字** クリップ警告 (100 超で ephemeral 警告、silent truncate 禁止。v2.0 当初 200 字 → 2026-05-20 軸 5 M-8 で RTF 実測再計算により 100 字 + `wait_for(90s)` へ修正済、voice-design.md §1.4 参照)
- say.sh CLI 直接: 2000 字 exit 2 ARGS_INVALID (Discord 入力 2000 字上限と整合、bot wait 制約外で長文許容)

exit code 6 段階 (0 OK / 1 ENGINE_UNREACHABLE / 2 ARGS_INVALID / 3 LOCK_TIMEOUT / 4 SYNTHESIS_FAILED / 5 AUDIO_PLAYBACK_FAILED)、flock 1 段、副作用は `.state/last-result-YYYY-MM-DD` への 1 invoke 1 行追記 (O_APPEND、初回 0600 作成。2026-06-12 訂正: 旧 atomic write 上書きは 24h 件数集計 = voice-design §1.5 (3)(4) と矛盾するため追記化、Done 同日 entry 参照) + 失敗時 socket 通知 (`$XDG_RUNTIME_DIR/companion-bot.sock`、CLI 直接呼び出し時の保険として残置、bot 経由は bot.py が exit code 直接受信)。

silence padding 1 秒 必須 (HDMI sink wake-up latency 対策、T-1 sprint #1 確定)。リトライ自動化禁止 (CLAUDE.md「1 回で確定」原則)。flock 2 段化は consumer 同時 invoke 競合発生時の Phase 4 trigger。

### bot voice_command.py 実装 (voice-design.md v2.0 §1.8)

案 A bot.py 直接 subprocess + voice_command.py 分離 (devil T-D-1(b) 採用):

```python
# bot/voice_command.py (Phase 2.5 T-D cmd_play パターン継承)
async def cmd_say(text: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(SAY_SH, text, ...)
    try:
        # timeout は 2026-05-20 軸 5 M-8 で 60s → 90s に修正済 (100 字 = warm 46s + cold 17s = 63s)
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=90.0)
    except asyncio.TimeoutError:
        proc.kill(); await proc.wait()
        return 99, "[voice] TIMEOUT (90s)"
    return proc.returncode, _format_say_result(proc.returncode, stderr)
```

cold start UX = **案 W-silent** (defer thinking のみ、ephemeral 中間メッセージ追加なし、devil §1.7(d) 2 段返信煩雑性受容)。詳細は voice-design.md v2.0 §1.3 / §1.8 参照。

### Phase 4 trigger 再定義 (voice-design.md v2.0 §1.9)

> **2026-06-01 格下げ (冒頭「方針転換」section 参照)**: 以下の trigger 表 (特に #1 数値化 = bot /say 14 日 10 回 + 週 5 回 × 2 週間) は **companion 全体の Phase 4 着手判断からは切り離す**。voice を日常運用する前提が user 実態で成立しないため。本 section は **Phase 4 着手後に voice 機能をどう載せ拡張するかの判断材料**として残す (撤回ではない)。companion 全体の Phase 4 着手は PROJECT.md 着手条件 #1 (vault で充足) / #2 (6-11 判定) / #3 (user 宣言) による。

#### voice 機能の Phase 4 着手判断 (PROJECT.md L194-209 #1/#2 接続)

| PROJECT.md 着手条件 | v2.0 数値ガイドライン | 計測方法 |
|---|---|---|
| #1「日常運用 2 週間以上」 | bot `/say` invoke が 14 日間で 10 回以上 + 週単位 5 回以上の波が 2 週間継続 | `voice_ledger.jsonl` 集計 |
| #2「想定外停止/誤動作なし」 | bot.service NRestarts=0 + bot.log ERROR/WARN/Traceback 0 件 + voice FAIL < 10% | journalctl --user + voice/.state/last-result-* 集計 |
| #3「user 自己宣言」 | 主観判定、最終ゲート | user 明示宣言 |

#### Phase 4 trigger 候補 (各項目別)

| 項目 | trigger 条件 |
|---|---|
| 朝自動発火 (morning-greeting.sh / voice-greeting.{service,timer} 復活) | TV 状態取得手段の代替 (cec-client / PulseAudio sink / TV IP API / Requires のみ / 諦め) のうち 1 件が user 承認 + persona/ 着手と一体評価 |
| bot `/say` 自然文発火 (案 H) | persona/ キャラ確定 + voice /say 運用頻度 1 日 5 回以上を 1 週間継続 |
| テキスト口調仕込み (バリエーション加工) | persona/ キャラ確定 (Phase 3-2 では実装しない、devil T-D-3 後のせ原則違反回避) |
| engine 常駐化 | bot 駆動 /say invoke が 1 日平均 5 回超を 1 週間継続 (voice_ledger.jsonl 集計) |
| voice-on-demand.service 経由 | consumer 2 件目で再評価 |
| AivisSpeech 並行 RTF 実測 | persona/ キャラ続投 vs 切替判断 |

#### 素声運用期間上限 (devil T-D-3)

> **2026-06-01 切り離し (冒頭「方針転換」section 参照)**: 本上限は「Phase 3-2 完了 (bot 駆動 /say 運用開始) から起算」する設計だが、bot 統合を Phase 4 移送したため起点が Phase 4 に移る。companion 全体の Phase 4 着手判断には使わない。Phase 4 で bot 統合着手後の voice 運用判断材料として再利用。

- **上限 2 ヶ月** (Phase 3-2 完了から起算)、user 主観で延長可
- 上限内に着手条件 #1/#2 を満たさない場合 → Phase 3-2 縮退判断 (bot /say 撤去 / Phase 3-3 STT 前倒し検討)

#### Phase 3-2 実装の Phase 4 改修総量 (architect Round 2 §7.2)

Phase 3-2 実装の Phase 4 改修総量 ~15% (devil §1.3(c) 許容範囲 50% を大幅クリア)、捨て駒リスク低。

### ライセンス参照 (voice-design.md §7)

- **VOICEVOX 全体規約**: <https://voicevox.hiroshiba.jp/term/> (商用 / 非商用 OK、エンジン使用無料)
- **四国めたん 個別規約**: <https://zunko.jp/con_ongen_kiyaku.html> (機械学習禁止条項なし / キャライメージ損傷条項なし、クレジット表記要件「気になって見にいった際にわかる程度」)
- **companion 利用形態**: 完全個人使用、外部公開なし → クレジット記載対象なし、実質義務なし
- **将来の外部公開検討時**: 規約 URL を再確認し、媒体に応じてクレジット記載判断

---

## TODO

Phase 3-2 着手順序 (voice-design.md v2.0.2 §5.3 + §10、voice/ 側前倒し反映):

1. **voice/ 側実装着手** ✅ **完了 (2026-05-19)、v2.0.2 §5.3 voice/ 側前倒し**:
   - [x] T-1 sprint #1 残「発話確認 user 物理確認」消化 (2026-05-19 V-S1 CLI 実弾 pass で同時消化)
   - [x] `~/companion/voice/` を git init (PROJECT.md L46-59 のサブプロジェクト git 化手順)
   - [x] voice/bin/voice-engine-up.sh / voice-engine-ready.sh 実装 (v2.0 §1.6)
   - [x] voice/scripts/say.sh 実装 (exit code 6 段階 + flock 1 段 + notify socket + last-result + 引数長 multi-tier + silence padding 1 秒、v2.0 §1.4)
   - [x] voice/systemd/companion-voice-engine.service 作成 (v2.0 §1.6.1 確定形)
   - [x] `~/.config/systemd/user/` に symlink 配置
   - [x] **完了基準 (i)**: say.sh CLI 手動 invoke で発話成功 ✅ (2026-05-19 21:45 JST 「テスト発話、聞こえますか」全文 TV 物理確認 pass)
   - 残: engine の enable (常駐化) 判断 — bot 側 (voice_command.py) 着手段階 (Phase 2.5 健全性 2 週間観察完了後 = 2026-06 上旬目処) で判断
2. **Phase 2.5 T-D 後半 (CreditBudgetGuard) 完了** ✅ **2026-05-19 即時前倒し完了** (bot/docs/STATUS.md 2026-05-19 Done エントリ参照)
3. **Phase 2.5 健全性 2 週間観察期間** 2026-05-19 〜 2026-06-02 (T-D 後半完了起点、bot.service NRestarts=0 / bot.log ERROR=0 / `/quota` credit_usd 表示 / FAIL <10% を継続観察)
4. **bot/ 側実装着手** ✅ **完了 (2026-06-12、Phase 4 voice bot 統合として実装。Done 同日 entry 参照)**:
   - [x] bot/voice_command.py 新規 (v2.0 §1.8、Telegram 読み替え + engine on-demand start/stop を bot 側に配置)
   - [x] bot/voice_status.py 新規 (v2.0 §1.5 (4) + §1.9 ledger 集計)
   - [x] bot/sessions/voice_ledger.jsonl (append-only、設計図の bot/ 直下から sessions/ 配下に変更 = quota ledger 慣習)
   - [x] bot/bot.py に CommandHandler("say") + import 追加
   - 残 (user 操作): `voice/.env` の `VOICE_DEFAULT_SPEAKER` 2→11 切替、bot restart、V-S1/V-S2 実弾
5. **maintenance/scripts/notify-system-report.sh 末尾追加** (v2.0 §1.5 (3)) ✅ **完了 (2026-06-12、同上 entry)**
6. 完了基準 3 階層 (v2.0 §3) を全て満たした時点で Phase 3-2 完了、PROJECT.md L150-152 (Phase 3-1 完了状況) に倣って Done エントリ追記
7. **Phase 4 着手判断** (v2.0 §1.9): voice_ledger.jsonl + journalctl/voice/.state 集計で #1/#2 + user 自己宣言 #3 で判定

### T-1 sprint #2 完了済 (2026-05-18〜19、Done エントリ参照)

V-1 cold start pass / V-13 fail 確定 → 設計仕切り直し議論 (case B 採用) → voice-design v2.0 確定。

## In progress

（なし。2026-06-01 方針転換で Phase 3-2 を技術基盤完成で畳み、TODO #4 bot/ 側統合は Phase 4 移送。次の voice 作業は Phase 4 着手後の「声の確定」と一体。冒頭「方針転換」section + PROJECT.md 健全性履歴 2026-06-01 entry 参照）

## Review pending

（なし）

## 実機計測値 (T-1 sprint #1/#2, 2026-05-18〜19 JST)

engine 構成: VOICEVOX engine 0.25.2 linux-cpu-x64, `--host=127.0.0.1 --port=50021 --cpu_num_threads=2 --output_log_utf8`。Inspiron 3521 / Ivy Bridge AVX1 / RAM 3.7Gi total / Swap 2.0Gi。

### B-voice-15 / V-0a (AVX1 適合) — T-1 sprint #1 pass

- SIGILL なし起動 ✅、stderr に `INFO voicevox_core::synthesizer: CPUを利用します` 確認
- `/version` HTTP 200, body `"0.25.2"`, 31 ms
- engine startup (uvicorn listening 開始) まで warm 約 5 秒
- **判定: AVX1 適合 pass**、voice-design.md §1.1 の user 介入経路は不要

### V-15 (四国めたん speaker_id) — T-1 sprint #1 pass

- `/speakers` から四国めたん 6 style 確認 ✅
  - ノーマル id=2 (採用)、あまあま id=0、ツンツン id=6、セクシー id=4、ささやき id=36、ヒソヒソ id=37
- `voice/.env` の `VOICE_DEFAULT_SPEAKER=2` 確定 (※2026-06-12 判明: .env は実際には作られておらず say.sh 内デフォルト 2 で動いていた = drift。現在は user 作成の .env で 11 = 玄野武宏)

### B-voice-2 / V-2 (合成 RTF, warm) — T-1 sprint #1 pass

| 文長 | 字数 | `/audio_query` avg | `/synthesis` avg | wav size | play time | **RTF avg** |
|---|---|---|---|---|---|---|
| 短文 | 12字 | 20-30ms (trial1=1.75s で dict cache 初回ロード) | 5.71s | 93,228B | 1.94s | **2.94** |
| 中文 | 31字 | 25-35ms | 17.08s | 358,444B | 7.47s | **2.29** |
| 長文 | 85字 | 40-50ms | 39.35s | 887,852B | 18.50s | **2.13** |

- RTF は長文ほど効率良い (warm 2.1-3.0)、Ivy Bridge AVX1 + HDD としては妥当
- WAV 形式: 16bit mono **24 kHz** PCM

### B-voice-3 / V-3 (RAM 占有, warm) — T-1 sprint #1 pass

- engine RSS **268 MB** (274,288 KB) / VSZ 919 MB (940,836 KB)
- RAM 3.7Gi total / dashboard active 並行で `free -h` available 2.0Gi の状態でも余裕
- **判定: RAM 占有 pass**

### B-voice-4 / V-3a (PulseAudio HDMI 出力) + 発話確認 — T-1 sprint #1 pass

- `pactl get-default-sink` → `alsa_output.pci-0000_00_1b.0.hdmi-stereo` ✅ HDMI stereo
- `paplay /tmp/voicevox-test.wav` rc=0、発話確認 (2026-05-18 20:07-20:09): **「今日もよろしく」のみ聞こえ、冒頭「おはよう。」欠落**
  - 切り分け: `ffmpeg -af "adelay=1000"` で wav 先頭に silence 1 秒 prepend した padded wav → **全文聞こえる** ✅
  - `paplay --latency-msec=1500` は paplay→server buffer 制御で sink wake-up に効かない (検証済 ✗)
  - **原因確定: HDMI sink wake-up latency ≥ 1 秒**
- **判定: pass (silence padding 1 秒 前提)** ✅、voice-design.md v1.0.2 §1.4 で案 A (`say.sh` で adelay=1000) 確定

### B-voice-1 / V-1 (engine 真の cold start) — T-1 sprint #2 pass

- 真の cold start 3 回計測 (2026-05-18 21:14-21:16、user 側 MATE Terminal 経由):
  - trial 1: **11.34 秒** (drop_caches=3 直後)
  - trial 2: **11.52 秒**
  - trial 3: **17.48 秒**
  - 平均 ~13.4 秒 / 中央値 11.52 秒
- 計測手順: `sync && sudo sysctl vm.drop_caches=3` → engine 起動 → `/version` 200 polling までの秒数
- **判定: pass**、voice-design.md v1.0.2 §1.3「cold start 33-65 秒推定」は大きく overshoot (実機 11-17 秒、推定の 1/3 以下 = **drift 6 件目**)
- 各 trial 後の RAM: 1.3Gi used / 2.0Gi available 維持、リーク無し

### ~~B-voice-12〜14 / V-13 (HDMI EDID 物理電源 ON/OFF)~~ — T-1 sprint #2 fail → v2.0 で削除

- 計測 (2026-05-18 22:21、user 側 MATE Terminal + リモコン TV 電源 OFF 実施):
  - V-13(a) TV ON 時: `HDMI-1 connected 1920x1080+0+0`、grep check exit=0 ✅
  - V-13(b)(c) **リモコン TV 電源 OFF 時**: `HDMI-1 connected` **のまま**、grep check exit=0 ❌
  - TV ON 復帰確認: `HDMI-1 connected`、grep check exit=0 ✅
- **判定: fail 確定**。TV 側 hot standby で EDID 信号維持、xrandr では物理電源 ON/OFF 区別不可
- **v2.0 で V-13 削除**: 朝自動発火 punt 確定 (user case B 採用) で xrandr gate が不要、V-13 は voice-design v2.0 §2 から削除

### B-voice-5 / V-5 (BGM 同時再生 + mpv IPC ducking) — Phase 4 punt

朝自動発火復活 (Phase 4 trigger 候補) 時に実機計測。Phase 3-2 では実装しない。

### v2.0 新規 V-S1 / V-S2 — **両方 pass (2026-06-12 実弾、Telegram 読み替え)**

- **V-S1**: Telegram `/say おはよう` 実弾で発話 + 「✓ 発話完了」reply を user 確認 ✅ (22:13 JST、rc=0 / duration_ms=19726 = cold start 込みで見積もりどおり。voice_ledger.jsonl 追記 + last-result「OK @ 2026-06-12T22:13:45+09:00」+ bot.log `cmd=/say len=4 rc=0` 全系統一致)
- **V-S2**: `/status` で「voice (直近24h): …」集計表示を user 確認 ✅ (同日)
- speaker は `voice/.env` 新規作成 (`VOICE_DEFAULT_SPEAKER=11`、user 操作) 後の発話 = 玄野武宏。**これで完了基準 3 階層 (v2.0 §3) すべて達成**

---

## 設計判断履歴 (v2.0、新設)

voice-design.md v2.0 §5.1 / §8.2 / §8.3 を本台帳にも転記。lead 単独責任の書面化 (devil §4.7 lead 責務 #1 採用)。

### case B (朝自動発火 punt + bot 駆動先行) 採用根拠 5 項目 (voice-design.md v2.0 §5.1)

| # | 経緯項目 |
|---|---|
| 1 | 2026-05-18 T-1 sprint #2 V-13 fail 確定 (TV hot standby で EDID 維持) → user 提案「自動で鳴らす設計をやめて、いったんその時間帯に Discord から声をかけたときのみに絞る」 → lead 追加 Q 2 件 (時間帯 24h 受付 / 朝挨拶 UX 完全 punt) で case B user 確定 |
| 2 | CLAUDE.md「2 周目の定義」遵守確認: V-13 fail は 1 周目の漏れ。case A (TV 状態取得手段置換) は設計引き直し許容方向だが、user 意向で case B (設計概念ごと撤回) に倒したため、case A 検証は適用免除 |
| 3 | case A 検証を試さなかった機会損失: 5 案 (cec-client / PulseAudio sink / TV メーカー IP API / dashboard.service Requires のみ / 諦め) は Phase 4「morning-greeting 復活」trigger で再検証候補として残置 |
| 4 | R3++ 構造論との関係: v1.0.2 §5 旧 trigger (3 朝連続自動発火失敗) は朝自動発火を punt するため形骸化 → v2.0 で削除、新 trigger に置換 |
| 5 | 将来 Phase 4 で朝挨拶復活判断時の手段選択肢: case A 5 案を Phase 4 punt 項目として残置、user 再評価で復活判断 |

### devil 致命級指摘 5 件の v2.0 反映 (Round 2)

| # | devil 指摘 | v2.0 反映先 |
|---|---|---|
| 1 | T-D-1(d) Phase 2.5 T-D 後半 (2026-06 上旬) との作業順序逆転禁止 | voice-design v2.0 §5.3 + 本台帳 TODO #1〜#3 |
| 2 | T-D-3 ux テキスト口調仕込みのキャラ性後のせ原則違反疑義 | Phase 4 punt 確定、voice-design v2.0 §4 |
| 3 | T-D-1(b) voice_command.py 分離 (bot.py 直書き禁止) | voice-design v2.0 §1.8 |
| 4 | 9:00 サマリ撤回代償 = padding skipped trigger 化 (過去 24h ≥ 5 件) | voice-design v2.0 §1.5 (3) |
| 5 | engine 常駐数値化 (bot /say 1 日 5 回 × 1 週間継続) | voice-design v2.0 §1.9 / §4 |

### Round 3 衝突 2 件の lead 裁定

| # | 衝突 | architect Round 2 | ux Round 2 | lead 裁定 |
|---|---|---|---|---|
| 1 | cold start UX | 案 W-imm (defer + ephemeral) | 案 W-silent (defer thinking のみ) | **W-silent 採用** (ux 最新 = devil 反証反映、simple) |
| 2 | say.sh CLI 引数長 | 2000 字 (CLI 直接は bot wait 制約外) | 300 字 (architect Round 1 参照のまま) | **2000 字採用** (architect Round 2 最新、ux 側 cross-review version 不一致による情報タイムラグ) |

### Phase 2.5 T-D 後半 (2026-05-19 即時前倒し完了) との作業順序 (voice-design v2.0.2 §5.3、voice/ 側前倒し + T-D 後半即時前倒し反映)

devil T-D-1(d) 構造原則は維持: (1) bot.py 同時 2 方向変更回避 (2) Phase 2.5 健全性 2 週間観察カウントへの影響回避。voice/ 側 (bot.py を触らない部分) はこの 2 根拠と独立、T-D 後半 (CreditBudgetGuard、bot/quota.py + bot.py の budget exceeded 経路のみ) も voice 系統の bot.py 拡張とは独立。

確定スケジュール (v2.0.2 + 2026-05-19 T-D 後半即時前倒し反映):

- **2026-05-19: voice/ 側実装着手 + T-D 後半 (CreditBudgetGuard) 即時前倒し完了** (v2.0.2 + 2026-05-19 追加前倒し)
  - voice/scripts/say.sh / voice/bin/voice-engine-up.sh / voice-engine-ready.sh / voice/systemd/companion-voice-engine.service / voice/ git init
  - 完了基準 (i) 「say.sh CLI 手動 invoke で発話成功」(v2.0 §3) 達成
  - **bot/quota.py に CreditBudgetGuard 実装、bot/bot.py の exceeded_message 移譲、`.env.example` を `BOT_BUDGET_GUARD=credit_usd` default に切替** (bot/docs/STATUS.md 2026-05-19 Done エントリ参照)
- 2026-05-19 〜 2026-06-02: Phase 2.5 健全性 2 週間観察期間 (T-D 後半完了起点、bot.service NRestarts=0 / bot.log ERROR=0 / `/quota` credit_usd 表示継続)
- **2026-06 上旬: bot/ 側実装着手** (健全性 2 週間観察完了後)
  - bot/voice_command.py / voice_status.py / voice_ledger.jsonl / bot.py への slash registration + import 1 行
  - voice/ 側がすでに動作する状態で接続するため衝突軽微、別 commit 必須
- 2026-06 中旬: voice Phase 3-2 完了基準 (ii)(iii) 達成 + 運用観察開始
- 2026-06 中下旬〜2026-07 上旬: Phase 4 着手判断 (元案 2026-07 中下旬〜2026-08 上旬から前倒し)

### voice/ 側前倒し採用 (v2.0.2、2026-05-19)

| # | 経緯項目 |
|---|---|
| 1 | 2026-05-19 user 提案「6 月の変更 (=CreditBudgetGuard) 以外を前倒しできないか、そうしないと 1 ヶ月近く何もできない」→ lead 選択肢提示 (A. voice/ 側全部前倒し / B. T-1 sprint 残のみ / C. Phase 3 順序変更 / D. 現状維持) → user「おすすめで」→ A 採用確定 |
| 2 | 前倒し可能性の構造判定: voice/ 側 (bot.py / bot.service を一切触らない部分) は devil T-D-1(d) 構造原則 (bot.py 同時 2 方向回避 + Phase 2.5 健全性 2 週間観察) と独立。両根拠は bot.py / bot.service への変更が前提のため、voice/ ディレクトリ単独実装には適用されない |
| 3 | 新規設計判断ではない位置付け: voice-design v2.0 確定設計 (§1.6 ディレクトリ構成 / §1.8 bot voice_command.py 実装 / §3 完了基準 3 階層) はすべて維持。voice-design v2.0 §5.3 スケジュールのうち voice/ 側着手日のみ前倒し。team 議論なしで lead が user 意向を文書化 |
| 4 | drift 整備の前倒し処理: voice/SETUP.md (jq install 文 / T-1 sprint 完走条件) + voice/README.md (dashboard 駆動 6:30 → bot 駆動 /say) の v1.0 残置 drift を本台帳更新と同時に解消 |
| 5 | 期待効果: 完了基準 (i) を 5 月中に達成、6 月の T-D 後半完了後の bot/ 側実装で完了基準 (ii)(iii) を一気に到達。voice Phase 3-2 全体完了が 2026-07 上旬から早まる可能性 (運用観察 2 週間カウントの開始も早まる、Phase 4 着手判断は変動なし)。**2026-05-19 追加前倒し**: T-D 後半 (CreditBudgetGuard) も 2026-06 上旬から 2026-05-19 即時に前倒し、bot/ 側着手が 2026-06 上旬目処に更に早まる、voice Phase 3-2 完了は 2026-06 中旬目処 |

### v2.0 議論で得た workspace/CLAUDE.md 補強候補 (2026-05-19 反映済)

team companion-voice-design v2.0 Round 1〜3 議論で得た構造的反省。**`~/companion/workspace/CLAUDE.md` §「運用上の落とし穴と回避策」B-2「teammate 同士の cross-review 精度向上」として 2026-05-19 反映済** (Phase 3-2 完了を待たず drift 整備で前倒し、voice/ 側完了後の空白期間活用):

- teammate Round N cross-review 着手前に「他 teammate の Round N 最新 plan を読み切る」明文化
- 各 plan の改版履歴 section を Round 2 / Round 3 ごとに必ず付ける運用 (cross-review 精度向上)
- ux「自己整合チェック報告」を出す際の比較対象 plan version (Round N) 明示書式
- lead Round 2 SendMessage で teammate に「相手の latest version を読み直してから cross-review」を明示指示する prompt 設計 (今回 lead orchestration ミスの自認)

---

## Done

- 2026-06-12 voice bot 統合 (Phase 4、persona 軸 2 gate 開通) — voice/ 側変更 = say.sh last-result 追記化
  - **背景**: TODO #4 bot/ 側実装の着手 (bot/voice_command.py / voice_status.py / voice_ledger.jsonl / /say 登録、詳細は `bot/docs/STATUS.md` 同日 Done)。その code-reviewer レビューで **修正必須 1 件** = last-result の atomic write (上書き) では日毎最終結果しか残らず、voice-design §1.5 (3) の 24h FAIL ≥ 3 / padding skipped ≥ 5 trigger と §1.5 (4) /status 24h 集計が構造的に発火不能 (設計書自体の内部矛盾を実装が継承していた) を検出
  - **対応 (案 A 採用)**: `say.sh` の fail() / 成功パスを `append_last_result` に変更し **1 invoke 1 行追記** 化。再レビュー軽微提案で write_last_result / append_last_result の 2 関数を O_APPEND 直書き 1 関数に統合 (umask 077 で初回 0600 作成、truncate しない。mv -f と並行追記の競合で行を失う経路も同時に消滅)。日次ファイルなので肥大は有界
  - **案 B (bot ledger のみ集計) 不採用根拠**: CLI invoke と padding skipped (exit 0 で他に表面化経路がない、devil 致命指摘 #4) が漏れ、failure mode (3) を実質無効化するため
  - **検証**: sandbox (VOICE_HOME 隔離 + engine 未起動 FAIL 経路) で 2 invoke → 2 FAIL 行 + socket 2 行が累積、0600 維持、`bash -n` pass。OK 経路は同一関数のため FAIL 経路検証で足りる
  - **voice-design.md v2.0.3 改版**: §1.4 副作用記述の訂正 + 実装 divergence 3 点 (Telegram 読み替え / engine start/stop の bot 側配置 / ledger 配置) を改版履歴に記録
  - **speaker 切替 (2→11) は user 操作で完了 (同日)**: `voice/.env` は claude セッションの deny 対象 (Read/Edit とも) のため切替コマンドを提示 → **`.env` はそもそも未作成だったことが判明** (say.sh はスクリプト内デフォルト 2 で動いていた、V-15 当時の台帳記述「.env の VOICE_DEFAULT_SPEAKER=2 確定」は drift)。user が `VOICE_DEFAULT_SPEAKER=11` の .env を新規作成 (0600)
  - **V-S1 / V-S2 実弾 pass (同日 22:13 JST)**: 「実機計測値」section の V-S1/V-S2 entry 参照。完了基準 3 階層 (v2.0 §3) すべて達成
- 2026-06-01 Phase 3-2 を技術基盤完成で畳み、bot 統合を Phase 4 移送 (user 方針転換)
  - **背景**: user 判断「voice は日常利用シーンが薄い (テレビ前は dashboard / YouTube)、Phase 3 を畳んで Phase 4 へ」。冒頭「方針転換」section + PROJECT.md 健全性履歴 2026-06-01 entry が center of truth
  - **更新内容**: (1) L1 タイトル + L3 最終更新を「技術基盤完成で畳み・bot 統合 Phase 4 移送」に / (2) 冒頭「方針転換」section 新設 / (3) TODO #4 bot/ 側実装を「Phase 4 移送」に / (4) Phase 4 trigger 再定義 section + 素声運用 2 ヶ月上限に「companion 全体の Phase 4 着手判断から切り離し・格下げ」注記 / (5) In progress 更新
  - **設計判断の位置づけ**: voice-design v2.0 の設計内容 (bot 駆動 /say / voice_command.py 分離 / cold start UX 等) は破棄せず Phase 4 の素材として残置。trigger 数値化・素声 2 ヶ月上限は「撤回」でなく「Phase 4 着手後の voice 拡張判断材料」へ格下げ
  - **code-reviewer**: PROJECT.md / bot / remote STATUS と一括で整合性点検 (同セッション)
  - **次タスク**: companion 全体の Phase 4 着手 (条件 #1 vault 充足 / #2 6-11 判定 / #3 user 宣言)、その後 Phase 4「声の確定」で bot 統合着手

- 2026-05-20 全体コードレビューで発覚した voice/ 側 軽微 3 件反映
  - **背景**: 健全性 2 週間観察期間 (2026-05-19〜2026-06-02) 起点で実施した全体レビュー (PROJECT.md 健全性履歴 2026-05-20 entry / bot/docs/STATUS.md 2026-05-20 entry 参照)。voice/ 側は **修正必須 0 件**、軽微 5 件のうち 3 件採用 / 2 件不採用
  - **軽微 B3-1**: `say.sh:65` `ts()` を `%Y-%m-%d %H:%M:%S%z` → `%Y-%m-%dT%H:%M:%S%:z` (ISO8601 厳密形式) に変更。bot/ 側 (健全性観察完了後 = 2026-06 上旬目処に着手) で `voice_status.py` が `datetime.fromisoformat()` で 1 行 parse できる。voice/ 側 CLI 単独で使う last-result の人間可読性は維持
  - **軽微 B3-3**: `say.sh:171` `paplay` を `if ! paplay ...; then fail 5 ...; fi` 形式に変更。`ffmpeg` ブロック (line 164) と統一、`PAPLAY_RC` 中間変数撤去
  - **軽微 B3-4**: `voice-engine-up.sh:29` `cd "$ENGINE_DIR"` に「手動 invoke 時の保険、systemd 経由では WorkingDirectory= で同一 dir」コメント 1 行追加。将来読者が二重指定に困惑しないため
  - **不採用**: B3-2 (`LANG=C curl` で英語固定化 → exit code 番号分類が主軸、reason 文言は人間向け log の位置付けで現状 OK、subagent 自身も「現状 OK」評価) / B3-5 (`systemd unit TimeoutStopSec=30` 明示 → default 90s で engine cleanup に十分、Phase 4 常駐化 trigger 時の判断材料として punt 妥当)
  - **作業範囲**: `voice/scripts/say.sh` (2 箇所) + `voice/bin/voice-engine-up.sh` (1 箇所) + `voice/docs/STATUS.md` 本エントリ。3 ファイル
  - **bash syntax check**: 両ファイル `bash -n` pass
  - **code-reviewer**: 軸 3 で並列実施済 (本エントリ反映の根拠)、再レビュー不要
  - **次タスク**: 観察期間 (2026-05-19〜2026-06-02) 継続観察、完了後 bot/ 側 voice_command.py 実装着手 (2026-06 上旬目処)

- 2026-05-19 README.md drift 解消 (5/19 進捗反映: 発話確認 pass / git init + push 完了 / 使い方の前置き整備、`90337f3` push 済)
  - **背景**: voice/README.md が voice/ 側実装完了 + T-D 後半即時前倒し完了の進捗反映から取り残されていた。本台帳 / PROJECT.md / SETUP.md は反映済で README だけ drift 残置
  - **更新内容** (5 箇所、1 ファイル):
    - L11 「発話確認のみ user 物理確認 pending」→「発話確認 user 物理確認は 5/19 pass で完了基準 (i) 達成」
    - L13 「Phase 2.5 T-D 後半完了後 = 2026-06 中下旬の予定維持」→「健全性 2 週間観察完了後 = 2026-06 上旬目処、T-D 後半 5/19 即時前倒し完了に伴い元案 2026-06 中下旬から前倒し」
    - L14 「voice/ git init は実装着手 1 件目の commit に揃える」→「2026-05-19: voice/ git init + GitHub プライベート repo 初回 push 完了、voice/ 側実装 (say.sh / bin/ / systemd) 完走」
    - L20 見出し「使い方 (実装着手後に追記)」→「使い方」
    - L24 「Phase 2.5 T-D 後半完了後」→「健全性 2 週間観察完了後 = 2026-06 上旬目処」
  - **code-reviewer**: 省略 (drift 整備のみ実装変更ゼロ、前回 5/19 「workspace/CLAUDE.md §B-2 反映済 drift 解消」エントリと同方針)
  - **次タスク**: Phase 2.5 健全性 2 週間観察期間 (2026-05-19 〜 2026-06-02) 継続観察 → 完了後 bot/ 側 voice_command.py 実装着手

- 2026-05-19 Phase 2.5 T-D 後半 (CreditBudgetGuard) 即時前倒し完了に伴う台帳 drift 解消
  - **背景**: 同日中に bot/ 側で T-D 後半 (元案 2026-06 上旬実施) を即時前倒しで実装完了 (bot/docs/STATUS.md 2026-05-19 Done エントリ参照、commit `5d64ec2`)。voice/ 系統のスケジュール参照箇所が「T-D 後半 = 2026-06 上旬完了予定」前提のまま残置すると drift、Phase 3-2 全体スケジュールが誤って読まれるため整備
  - **更新内容**:
    - L24-28 スケジュール表: T-D 後半完了予定 2026-06 上旬 → 2026-05-19 即時前倒し完了、bot/ 側着手は健全性 2 週間観察完了後 = 2026-06 上旬目処 (元案 2026-06 中下旬から前倒し)
    - L51 「bot/ 配下の追加」 注記: 「Phase 2.5 T-D 後半完了後」→「健全性 2 週間観察完了後 = 2026-06 上旬目処」
    - TODO #1-#4: T-D 後半完了済 + 健全性観察期間 (5/19〜6/2) を明示
    - In progress: 次タスクを TODO #3 健全性観察 → TODO #4 bot/ 側実装に切替
    - 設計判断履歴「Phase 2.5 T-D 後半との作業順序」section: 確定スケジュール訂正 + 2026-05-19 追加前倒し反映
    - 「voice/ 側前倒し採用 (v2.0.2)」表の期待効果列に 2026-05-19 追加前倒し効果を追記
  - **historical record 残置**: L253 devil 指摘表「T-D-1(d) Phase 2.5 T-D 後半 (2026-06 上旬) との作業順序逆転禁止」/ 2026-05-19 drift 解消エントリ内「前倒し候補 (b) 本セッションでは未着手」は時点記録のため残置 (bot/STATUS.md 側に T-D 後半 Done エントリで書き起こし済、本 voice 台帳はそちらを参照)
  - **作業範囲**: voice/docs/STATUS.md L3 最終更新 + L24-28 / L51 / L137-140 / L155 / L266-281 / L291 の合計 6 箇所、計 1 ファイル。bot/docs/STATUS.md / design.md §4 / PROJECT.md は同タイミングで別 commit で反映 (workspace 直下は git 管理外)
  - **code-reviewer**: 本 voice 台帳の drift 解消単独でレビューせず、bot/STATUS / design.md / PROJECT.md と一括で同セッションのレビュー結果を継承 (drift 解消のみで実装変更なし、修正必須なし)
  - **次タスク**: TODO #3 Phase 2.5 健全性 2 週間観察期間 (2026-05-19 〜 2026-06-02、journalctl --user -u companion-bot.service / bot.log / `/quota` credit_usd 表示を継続観察) → 期間完了後 TODO #4 bot/ 側 voice_command.py 実装着手

- 2026-05-19 workspace/CLAUDE.md §B-2 反映済 drift 解消 + subordinate CLAUDE.md 参照行確認 (voice/ 側完了後の空白期間 (a) 消化)
  - **背景**: voice/ 側前倒し完了 (本日 V-S1 CLI 実弾 pass で完了基準 (i) 達成) で、次タスク Phase 2.5 T-D 後半 (2026-06 上旬予定) まで約 2〜3 週間の空白期間が発生。user 確認で前倒し候補 (a) workspace/CLAUDE.md 補強候補書き起こし + (c) subordinate CLAUDE.md 参照行確認を 1 セッションで処理
  - **(a) 結果 = drift 整備のみ**: workspace/CLAUDE.md L101-110 §「運用上の落とし穴と回避策」B-2「teammate 同士の cross-review 精度向上 (2026-05-19 voice-design v2.0 議論より追加)」として v2.0 議論 4 項目 (cross-review 精度向上 / 改版履歴 Round 2/3 必須化 / 比較対象 plan version 明示書式 / lead Round 2 SendMessage「latest version 読み直し」明示指示) は **既に反映済** と判明。本台帳「v2.0 議論で得た workspace/CLAUDE.md 補強候補」section + PROJECT.md L286 健全性チェック履歴 2026-05-18 entry の同記載が「Phase 3-2 完了タイミングで CLAUDE.md 改版検討対象」と未反映扱いで残置されていた drift を「反映済」に書き換えて整備
  - **(c) 結果**: 機械側 entry-point 2 ファイル (`workspace/CLAUDE.md` L3 / `bot-workspace/CLAUDE.md` L29-33) で「設計判断・対症療法の上限」上位参照行を確認、追加変更不要。`vault/CLAUDE.md` は Windows パス (L44) + メイン機 Obsidian 操作前提で companion 機側からの編集対象外と判定 (PROJECT.md L154 / L297「整理・タグ運用はメイン機側で行う」方針と整合、機械側書き込み境界は上位 `~/companion/CLAUDE.md` + `bot-workspace/CLAUDE.md` でカバー済)
  - **作業範囲**: voice/docs/STATUS.md「v2.0 議論で得た workspace/CLAUDE.md 補強候補」section の前置き 1 行 (見出し含む) + PROJECT.md L286 該当 1 行のみ、計 2 ファイル書き換え。workspace/CLAUDE.md / bot-workspace/CLAUDE.md / vault/CLAUDE.md には触らず (実体反映済または編集対象外)
  - **code-reviewer**: 修正必須なし、軽微提案 2 件 (Done エントリへの code-reviewer 行追加 / (c) 結果ファイル別所感の簡潔化) いずれも採用反映済
  - **前倒し候補 (b) Phase 2.5 T-D 後半 (CreditBudgetGuard) 実装前倒し**: 本セッションでは未着手。`MONTHLY_BUDGET_ACTIVE_FROM = datetime(2026, 6, 15, 0, 0, JST)` は **enable 切替** 判定であり実装と独立、ENV `BOT_BUDGET_GUARD=requests_count` のままにすれば実機影響なし可能性。ただし新規設計判断扱い (bot/docs/STATUS.md L36-37「2026-06 上旬実施」予定変更) のため user 別途相談ゲート、本タスク完了報告後に提示
  - **次タスク**: (b) の前倒し可否 user 相談 → 採否確定後に Phase 2.5 T-D 後半着手 or 6 月上旬まで一旦待機

- 2026-05-19 V-S1 CLI 実弾 pass + T-1 sprint #1 残「発話確認」消化、完了基準 (i) 達成
  - **背景**: voice/ 側実装 (git init + say.sh + engine 起動経路 + systemd unit) 完走を受けて実弾検証。完了基準 (i) は voice-design.md v2.0 §3「say.sh CLI 手動 invoke で発話成功」、TODO #1 voice/ 側前倒しの最終ゲート
  - **実弾手順 + 結果**:
    1. `systemctl --user start companion-voice-engine.service` → `Active: active` (engine 起動 OK、systemd-managed 経路の動作確認も兼ねる)
    2. `voice/bin/voice-engine-ready.sh` → stdout `ready` + rc=0 (cold start 後の /version 200 polling、benign give-up 経路の動作確認)
    3. `voice/scripts/say.sh "テスト発話、聞こえますか"` → rc=0、実時間 19.037s (warm 合成 17-18 秒 + silence padding 1 秒 + paplay)、`.state/last-result-2026-05-19` に `OK @ 2026-05-19 21:45:38+0900` 記録 (padding skipped なし = ffmpeg `adelay=1000` 成功経路)
    4. user 物理確認 (TV 前): 「テスト発話、聞こえますか」**全文聞こえた** ← T-1 sprint #1 残「発話確認 user 物理確認」+ V-S1 (CLI 実弾) を同時消化
    5. `systemctl --user stop companion-voice-engine.service` → `Active: inactive (dead)` (engine 停止、bot/ 側着手まで常駐させない方針)
  - **検証経路カバレッジ** (Phase 3-2 voice/ 側実装の smoke test):
    - exit 0 OK + silence padding 成功 ✅ (本実弾)
    - exit 2 ARGS_INVALID ✅ (2026-05-19 say.sh 実装完了エントリで確認済)
    - exit 1 ENGINE_UNREACHABLE / exit 3 LOCK_TIMEOUT / exit 4 SYNTHESIS_FAILED / exit 5 AUDIO_PLAYBACK_FAILED は実弾未経過 (実害想定低、bot 側着手後の運用観察で発現すれば回収)
  - **常駐 (systemctl --user enable) は保留**: bot/ 側 voice_command.py 実装 (Phase 2.5 T-D 後半完了後 = 2026-06 中下旬目処) 着手段階で判断。Phase 2.5 健全性 2 週間観察期間中に常駐プロセス変化を入れない方針 + RAM RSS 268MB 占有を遅らせる方針 (devil T-D-1(d) 構造原則と整合)
  - **次タスク**: Phase 2.5 T-D 後半 (CreditBudgetGuard、bot/docs/STATUS.md TODO) 完了 → bot/ 側実装 (voice_command.py + voice_status.py + voice_ledger.jsonl + bot.py slash registration) → V-S2 (bot 経由 /say 実弾)

- 2026-05-19 voice/ engine 起動経路実装 (voice-design.md v2.0 §1.6 + §1.6.1 確定形)
  - **背景**: TODO #1 voice/ 側前倒し着手の engine 常駐手段。say.sh が依存する VOICEVOX engine 0.25.2 を systemd user service で起動できる状態にする。完了基準 (i)「say.sh CLI 手動 invoke で発話成功」の前提
  - **実装内容** (3 ファイル、83 行):
    - `bin/voice-engine-up.sh` (34 行): foreground 実行 wrapper、systemd ExecStart + 手動デバッグ両用。`cd engine/linux-cpu-x64 && exec ./run --host=127.0.0.1 --port=50021 --cpu_num_threads=2 --output_log_utf8` (§1.6.1 確定オプション、`--use_gpu` / `--speaker=<id>` は付けない)。.env / ENV (`ENGINE_HOST` / `ENGINE_PORT` / `VOICE_ENGINE_THREADS`) override 可、engine バイナリ不在ガード (rc=1 + SETUP.md 誘導)
    - `bin/voice-engine-ready.sh` (35 行): /version 200 polling 30s benign give-up。`curl -sSf -m 2` で 200 のみ成功扱い、`VOICE_READY_TIMEOUT_SEC` / `VOICE_READY_INTERVAL_SEC` override 可。timeout でも exit 0 + stdout に `ready`/`timeout (Ns)` (systemd 後段 chain fail 防止 + 手動デバッグ判別)
    - `systemd/companion-voice-engine.service` (14 行): Type=simple / Restart=no (voice-design.md §1.6 + CLAUDE.md「失敗時の回復は state 引き or ユーザー介入」、SIGILL 等は症状隠蔽せず user 介入要求) / WorkingDirectory=engine/linux-cpu-x64 / ExecStart=bin/voice-engine-up.sh / [Install] WantedBy=default.target (24h 受付想定の常駐 daemon、bot.service 類似)
  - **配置**: `~/.config/systemd/user/companion-voice-engine.service` に symlink (既存 maintenance / dashboard と同パターン) + `systemctl --user daemon-reload` 済、`systemctl --user status` で `Loaded: linked` + `Active: inactive (dead)` 確認 (enable / start はせず、user 判断段階に保留)
  - **smoke test** (静的):
    - `bash -n` syntax pass (両 .sh)
    - voice-engine-ready.sh: `VOICE_READY_TIMEOUT_SEC=2` で benign give-up → stdout `timeout (2s)` + rc=0 確認
    - voice-engine-up.sh: `ENGINE_DIR=/nonexistent` で engine 不在ガード発火 → stderr error + rc=1 確認
    - `systemd-analyze --user verify` で unit 構文 pass (無音)
  - **未テスト経路** (engine 実起動が user 承認段階のため後段):
    - `systemctl --user start companion-voice-engine.service` → engine 起動 → ready.sh で `ready` 確認 → say.sh 実弾 (V-S1)
    - SIGILL 等 engine fail 時の Restart=no 観察 (unit が failed のまま残るか確認)
  - **code-reviewer**: 修正必須なし。軽微提案 (a)(b)(c) はいずれも採用見送り / 取り下げ (現状で運用可)。dashboard.service の `ExecStartPre` / `KillMode=control-group` / `TimeoutStopSec` は voice engine では不要 (GUI 依存なし、子プロセス分岐なし、systemd default の SIGTERM → 90s → SIGKILL で十分) と確認
  - **次タスク**: user が `systemctl --user start companion-voice-engine.service` で engine 起動 → voice-engine-ready.sh で ready 確認 → say.sh 実弾 (V-S1)。TODO #1 完了基準 (i) 達成判定 + T-1 sprint #1 残「発話確認 user 物理確認」(TV 前で 4 短文 paplay) と合わせて消化

- 2026-05-19 voice/scripts/say.sh 実装 (consumer API、voice-design.md v2.0 §1.4 確定形)
  - **背景**: TODO #1 voice/ 側前倒し着手の主要部品。bot 駆動 `/say` slash command + CLI 手動デバッグの両方が直接呼び出す consumer。完了基準 (i)「say.sh CLI 手動 invoke で発話成功」の準備
  - **実装内容** (182 行):
    - exit code 6 段階 (0 OK / 1 ENGINE_UNREACHABLE / 2 ARGS_INVALID / 3 LOCK_TIMEOUT / 4 SYNTHESIS_FAILED / 5 AUDIO_PLAYBACK_FAILED)
    - flock 1 段 (`.state/engine.lock`、`-w 5` で取得失敗 → exit 3、FD 9 exit close で解放)
    - 副作用「常時実行」: `.state/last-result-YYYY-MM-DD` atomic write (mktemp → chmod 600 → printf → mv -f、同一 fs rename(2))、`.state/` 自体は 0700 (※当時の実装。2026-06-12 に 1 invoke 1 行追記へ変更、Done 同日 entry 参照)
    - exit != 0 時 socket 通知 (`$XDG_RUNTIME_DIR/companion-bot.sock`、`nc -U -N`、maintenance/lib/notify.sh 慣例踏襲)。socket 不在 / 送信失敗は last-result に追記して握りつぶす (fail-open)
    - silence padding 1 秒 (ffmpeg `adelay=1000`、fail-open。失敗時は padding skipped を last-result に追記 exit 0 維持)
    - 引数長 2000 字超 → exit 2、speaker_id 整数バリデート
    - リトライ自動化禁止 (CLAUDE.md「1 回で確定」原則)
    - .env 読込 (VOICE_DEFAULT_SPEAKER=2 等)、ENGINE_HOST/ENGINE_PORT も env override 可
  - **smoke test** (静的): `bash -n` syntax pass、`-h` ヘルプ出力 OK、空引数 → exit 2 で last-result-2026-05-19 に「FAIL ARGS_INVALID: empty text (exit 2)」記録 (0600 で書き込み確認)
  - **未テスト経路** (Phase 3-2 実装完走後の V-S1 で実弾検証):
    - exit 1 ENGINE_UNREACHABLE (engine 未起動状態で実行)
    - exit 3 LOCK_TIMEOUT (別 say.sh で flock 占有時)
    - exit 4 SYNTHESIS_FAILED (engine HTTP error 経路)
    - exit 5 AUDIO_PLAYBACK_FAILED (paplay rc != 0)
    - exit 0 OK + silence padding 成功経路
  - **code-reviewer**: 修正必須なし。軽微提案 5 件 (A: HTTP_CODE 空文字ガード、B: `nc` タイムアウト、C: 失敗 WAV 保存、D: `--get -X POST` warning、E: SPEAKER percent-encode) はいずれも仕様準拠範囲で現状維持判断 (Phase 4 trigger 発生時に再検討)
  - **次タスク**: voice/bin/voice-engine-up.sh + voice-engine-ready.sh / voice/systemd/companion-voice-engine.service (engine 起動経路、say.sh が依存する VOICEVOX engine の常駐手段)

- 2026-05-19 voice/ git init + GitHub プライベート repo (mooneclipse/companion-voice) 初回 push 完了
  - **背景**: voice-design.md v2.0.2 §5.3 voice/ 側前倒し着手方針に沿って、PROJECT.md L46-59「サブプロジェクトの git 化手順」で voice/ を git 化
  - **作業内容**: `git init -b main` + user 設定 (`1870071+mooneclipse@users.noreply.github.com` / `mooneclipse`) + pre-commit hook (gitleaks) 配置 + `.gitignore` 作成 (4 行: `engine/` / `.state/` / `.env` / `.env.*`、本台帳 L46 center of truth 準拠) + 初回 commit `c5a7d61` (4 files / 467 insertions) → `git push -u origin main`
  - **gitleaks**: dir スキャン (421MB) と commit hook 両方 `no leaks found`、engine/ (1.69GB の 7z + 展開済バイナリ) は `.gitignore` `engine/` パターンで除外、`git check-ignore -v` で確認済
  - **code-reviewer**: 修正必須なし。軽微提案 (`*.swp` / `*~` 追加可否、maintenance のみ採用の慣習) は bot/dashboard 多数派慣習 + YAGNI で採用せず (実害出たら 1 行追加で対応)
  - **次タスク**: TODO #1 残り (T-1 sprint #1 発話確認 user 物理確認 / voice/bin/voice-engine-up.sh + voice-engine-ready.sh / scripts/say.sh / systemd/companion-voice-engine.service 実装)

- 2026-05-19 PROJECT.md Phase 3 ロードマップ #2 (TTS/VOICEVOX) を voice-design v2.0 反映で更新
  - **背景**: PROJECT.md L180-182 が v1.0 設計時の薄い 3 行 (「TTS (VOICEVOX): 応答を音声化」「CPU 軽量モードで実用域。Phase 4 のキャラ声と直接接続できる」「ディレクトリ: ~/companion/voice/」) のまま、v2.0 確定 (5/19) が反映されていなかった。別セッション「続きおねがい」で center of truth として最初に読まれる文書のため、ここを v2.0 整合させて voice 実装着手時の誤認を防ぐ
  - **差分**: PROJECT.md L180-187 を 7 行に拡張、v2.0 確定事項 (bot 駆動先行 / 朝自動発火 Phase 4 punt / Phase 2.5 T-D 後半完了後 2026-06 中下旬目処) + 実機計測値 (RTF 2.1-3.0 warm / RSS 268MB / speaker_id=2) + 設計参照 (voice-design.md v2.0) + 台帳参照 (voice/docs/STATUS.md) を反映
  - **作業範囲**: PROJECT.md L180-187 のみ。voice-design.md v2.0 / voice/docs/STATUS.md (5/19 反映済) / bot 関連 / SETUP.md は触らず、center of truth 整合のみ
  - **code-reviewer**: 修正必須なし、軽微提案 1 件 (voice-design.md §5.1 番号併記) はユーザー判断で現状維持 (PROJECT.md 他 entry の慣習 = section 名まで掘り下げない、と整合)

- 2026-05-19 voice-design v2.0 確定 = team `companion-voice-design` v2.0 仕切り直し議論 (Round 1〜3) + lead 集約
  - **背景**: T-1 sprint #2 V-13 fail を受けて user 提案「自動で鳴らす設計をやめて、いったんその時間帯に Discord から声をかけたときのみに絞る」を受領、team 議論で正式評価
  - **議論経緯**: Round 1 (各 role independent initial position) → user 追加 Q 2 件確認 (時間帯 24h / 朝挨拶 punt) → Round 2 (cross-review + 反証応答) → Round 3 (lead 単独集約、衝突 2 件裁定 = W-silent / say.sh CLI 2000 字)
  - **主要確定事項** (voice-design.md v2.0 全体反映):
    - 朝自動発火 (案 A T2) 完全 punt、bot 駆動先行 (`/say` slash 24h 受付) 採用
    - voice_command.py 分離 (devil T-D-1(b) 採用)、bot.py 直書き禁止
    - cold start UX 案 W-silent (defer thinking のみ)
    - 引数長 multi-tier (bot.py /say 200 字 / say.sh CLI 2000 字)
    - failure mode 4 → 3 段階 (9:00 サマリ + dashboard ExecStopPost 例外承認とも撤回、padding skipped trigger 化 24h ≥ 5 件)
    - Phase 4 trigger 数値化 (週 5 回 × 2 週間 + voice_ledger.jsonl)、素声運用 2 ヶ月上限
    - Phase 2.5 T-D 後半 (2026-06 上旬完了) との順序確定: voice 実装着手は T-D 後半完了後
    - Phase 4 punt 項目大幅更新 (テキスト口調仕込み追加 = キャラ性後のせ原則違反回避 / 自然文発火追加 / engine 常駐数値化等)
  - **設計判断履歴**: 本台帳「設計判断履歴」section に case B 採用根拠 5 項目 + devil 致命級指摘 5 件反映 + Round 3 衝突 2 件裁定 + Phase 2.5 順序 + workspace/CLAUDE.md 補強候補を書面化
  - **作業実績**: voice-design.md v1.0.2 → v2.0 全面書き直し (346 行 → 大幅拡張、§5.1 case B 採用根拠 / §5.3 Phase 2.5 順序 / §8.2 v2.0 議論経緯 / §8.3 workspace/CLAUDE.md 補強候補等を新設)、team `companion-voice-design` 3 teammate (architect / ux / devil) shutdown_request → approve 受領 → TeamDelete cleanup 完了
  - **既存への副作用なし**: bot.service / dashboard.service / maintenance timer 群いずれも実機変更なし (本セッションは設計確定のみ、実装は Phase 2.5 T-D 後半完了後)

- 2026-05-18 T-1 sprint #2: V-1 engine cold start pass / V-13 HDMI EDID fail 確定 → 設計仕切り直しトリガ
  - V-1 cold start 3 回: trial1=11.34s / trial2=11.52s / trial3=17.48s、推定 33-65 秒の 1/3 以下 (drift 6 件目)
  - V-13 fail: TV 側 hot standby で EDID 維持、xrandr では物理電源 ON/OFF 区別不可
  - **次セッション**: voice-design v2.0 設計仕切り直し議論を起動 → 上記 2026-05-19 entry で完了

- 2026-05-18 T-1 sprint #1: B-voice-15 AVX1 適合実機検証 完全 pass
  - 完走項目 (実機計測値 section 詳細): V-0a / V-15 / V-2 (RTF 短2.94/中2.29/長2.13 warm) / V-3 (RAM RSS 268MB) / V-3a (PulseAudio HDMI sink) / B-voice-15 発話確認 (silence padding 1 秒 前提)
  - **重要な発見**: HDMI sink wake-up latency ≥ 1 秒、`paplay --latency-msec=` では解消せず、wav 先頭に silence 1 秒 prepend が必須。voice-design.md v1.0.2 §1.4 で確定
  - drift 5 件発見・記録 (voice-design.md v1.0.1 で訂正済)

- 2026-05-18 Phase 3-2 着手準備: voice/ サブプロジェクト初期化、台帳 STATUS.md 作成、T-1 sprint タスク登録
  - voice-design.md v1.0 team 議論 11 ラウンド + user 最終承認で確定 (case B 採用前)

## 既知の問題

（なし）

## 観察ルール (v2.0 更新)

- **新 R3++ trigger A (voice 駆動 FAIL 累積率)**: 過去 1 ヶ月の voice /say invoke のうち FAIL (exit != 0) 累積 10% 超 → 設計仕切り直しサイン (voice-design.md v2.0 §5.2)
- **新 R3++ trigger B (朝挨拶復活 case)**: Phase 4 punt の case A 5 案 (cec-client / PulseAudio sink / TV IP API / Requires のみ / 諦め) のうち 1 件で実機検証 pass → 朝自動発火復活判断
- **clean shot 確認**: 各 V-* 結果は本台帳「実機計測値」section に記録、対応する V-* で合否判定
- **vault push reject 観察ルール**: voice/ は git init 後 GitHub remote (`mooneclipse/companion-voice`) に push する想定だが、vault と違いメイン機側の先行 commit はない (機械専用 repo) ため reject 観察ルールは適用外
- **VOICEVOX engine version up 時の CLI 再検証**: 将来 engine を 0.25.2 → 新版に上げる際は `engine/linux-cpu-x64/run --help` で起動オプション仕様を再確認し、voice-design.md v2.0 §1.6.1 確定表との差分を発見したら drift 記録 → 改版。再検証結果は本台帳「実機計測値」section に「VOICEVOX engine version + 検証日 + 差分結果」として追記してから本番投入
- **素声運用期間 2 ヶ月上限**: Phase 3-2 完了から起算、超過時に Phase 4 着手判断 (#1/#2/#3 充足) or Phase 3-2 縮退 (bot /say 撤去 / Phase 3-3 STT 前倒し) 判断
