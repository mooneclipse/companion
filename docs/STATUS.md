# companion-voice 開発台帳（Phase 3-2: TTS (VOICEVOX) + bot 駆動先行 v2.0）

最終更新: 2026-05-19 (voice-design.md v2.0.2 改版で voice/ 側前倒し方針確定、PROJECT.md L184 整合反映)

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
- **Phase 2.5 T-D 後半 (2026-06 上旬完了予定) との順序** (v2.0.2 で voice/ 側前倒し):
  - **voice/ 側 (bot.py を触らない部分: say.sh / bin/ / systemd/companion-voice-engine.service / git init)** → 2026-05 中下旬から前倒し着手
  - **bot/ 側 (voice_command.py / voice_status.py / voice_ledger.jsonl / bot.py への slash registration)** → Phase 2.5 T-D 後半完了後 = 2026-06 中下旬
  - 前倒し根拠: devil T-D-1(d) 構造原則 (bot.py 同時 2 方向回避 + Phase 2.5 健全性 2 週間観察) は voice/ 側単独実装と独立。voice/ は bot.py / bot.service を一切触らないため両根拠と無関係。新規設計判断ではなく運用上の前倒し (詳細は「設計判断履歴」section 参照)

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
├── .env                                 # VOICE_DEFAULT_SPEAKER=2 等 (.gitignore)
├── .gitignore                           # engine/, .state/, .env
├── README.md                            # 用途・起動方法 (bot 経由が主、CLI 手動デバッグ可)
└── SETUP.md                             # 公式 7z DL + 展開手順 4 行 + ffmpeg install
```

**bot/ 配下の追加** (Phase 3-2 で voice/ と並行、別 commit、Phase 2.5 T-D 後半完了後):
- `bot/voice_command.py` 新規 (cmd_say + ledger 追記、Phase 2.5 T-D `quota.py` パターン継承)
- `bot/voice_status.py` 新規 (format_voice_summary、bot.py cmd_status に append)
- `bot/voice_ledger.jsonl` 新規 (append-only、Phase 4 trigger 集計元)
- `bot/bot.py` に slash registration + import 1 行追加

### say.sh CLI API 契約

`voice-design.md` v2.0 §1.4 を center of truth として参照。引数長 **multi-tier** (v2.0 衝突 2 lead 裁定):

- bot.py `/say` text 引数: 200 字クリップ警告 (200 超で ephemeral 警告、silent truncate 禁止)
- say.sh CLI 直接: 2000 字 exit 2 ARGS_INVALID (Discord 入力 2000 字上限と整合、bot wait 制約外で長文許容)

exit code 6 段階 (0 OK / 1 ENGINE_UNREACHABLE / 2 ARGS_INVALID / 3 LOCK_TIMEOUT / 4 SYNTHESIS_FAILED / 5 AUDIO_PLAYBACK_FAILED)、flock 1 段、副作用は `.state/last-result-YYYY-MM-DD` atomic write (0600) + 失敗時 socket 通知 (`$XDG_RUNTIME_DIR/companion-bot.sock`、CLI 直接呼び出し時の保険として残置、bot 経由は bot.py が exit code 直接受信)。

silence padding 1 秒 必須 (HDMI sink wake-up latency 対策、T-1 sprint #1 確定)。リトライ自動化禁止 (CLAUDE.md「1 回で確定」原則)。flock 2 段化は consumer 同時 invoke 競合発生時の Phase 4 trigger。

### bot voice_command.py 実装 (voice-design.md v2.0 §1.8)

案 A bot.py 直接 subprocess + voice_command.py 分離 (devil T-D-1(b) 採用):

```python
# bot/voice_command.py (Phase 2.5 T-D cmd_play パターン継承)
async def cmd_say(text: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(SAY_SH, text, ...)
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60.0)
    except asyncio.TimeoutError:
        proc.kill(); await proc.wait()
        return 99, "[voice] TIMEOUT (60s)"
    return proc.returncode, _format_say_result(proc.returncode, stderr)
```

cold start UX = **案 W-silent** (defer thinking のみ、ephemeral 中間メッセージ追加なし、devil §1.7(d) 2 段返信煩雑性受容)。詳細は voice-design.md v2.0 §1.3 / §1.8 参照。

### Phase 4 trigger 再定義 (voice-design.md v2.0 §1.9)

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

1. **voice/ 側実装着手** (2026-05 中下旬から前倒し、v2.0.2 §5.3):
   - **T-1 sprint #1 残「発話確認 user 物理確認」消化** (TV 前で 4 短文 paplay、precondition)
   - `~/companion/voice/` を git init (PROJECT.md L46-59 のサブプロジェクト git 化手順)
   - voice/bin/voice-engine-up.sh / voice-engine-ready.sh 実装 (v2.0 §1.6)
   - voice/scripts/say.sh 実装 (exit code 6 段階 + flock 1 段 + notify socket + last-result + 引数長 multi-tier + silence padding 1 秒、v2.0 §1.4)
   - voice/systemd/companion-voice-engine.service 作成 (v2.0 §1.6.1 確定形)
   - `~/.config/systemd/user/` に symlink 配置
   - **完了基準 (i)**: say.sh CLI 手動 invoke で発話成功 (v2.0 §3)
2. **Phase 2.5 T-D 後半 (CreditBudgetGuard) 完了確認** (2026-06 上旬予定、bot/docs/STATUS.md 参照)
3. T-D 後半完了 + 2 週間の Phase 2.5 健全性観察開始
4. **bot/ 側実装着手** (T-D 後半完了後、2026-06 中下旬目処):
   - bot/voice_command.py 新規 (v2.0 §1.8)
   - bot/voice_status.py 新規 (v2.0 §1.5 (4) + §1.9 ledger 集計)
   - bot/voice_ledger.jsonl 新規 (append-only)
   - bot/bot.py に slash registration + import 1 行追加
5. **maintenance/scripts/notify-system-report.sh 末尾 5 行追加** (v2.0 §1.5 (3))
6. 完了基準 3 階層 (v2.0 §3) を全て満たした時点で Phase 3-2 完了、PROJECT.md L150-152 (Phase 3-1 完了状況) に倣って Done エントリ追記
7. **Phase 4 着手判断** (v2.0 §1.9): voice_ledger.jsonl + journalctl/voice/.state 集計で #1/#2 + user 自己宣言 #3 で判定

### T-1 sprint #2 完了済 (2026-05-18〜19、Done エントリ参照)

V-1 cold start pass / V-13 fail 確定 → 設計仕切り直し議論 (case B 採用) → voice-design v2.0 確定。

## In progress

（なし、2026-05-19 voice-design v2.0.2 改版で voice/ 側前倒し方針確定。次セッションで TODO #1 の T-1 sprint #1 残「発話確認 user 物理確認」消化、または voice/ git init から着手）

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
- `voice/.env` の `VOICE_DEFAULT_SPEAKER=2` 確定

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

### v2.0 新規 V-S1 / V-S2 (Phase 3-2 実装着手後)

- **V-S1**: Discord `/say "おはよう"` 実弾発火で 11-17 秒後に発話 + Discord followup「✓ 発話完了」表示
- **V-S2**: `/status` で format_voice_summary 出力 (24h OK/FAIL/padding skipped/最終発話 text 先頭 20 字) 表示

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

### Phase 2.5 T-D 後半 (2026-06 上旬) との作業順序 (voice-design v2.0.2 §5.3、voice/ 側前倒し反映)

devil T-D-1(d) 構造原則は維持: (1) bot.py 同時 2 方向変更回避 (2) Phase 2.5 健全性 2 週間観察カウントへの影響回避。voice/ 側 (bot.py を触らない部分) はこの 2 根拠と独立。

確定スケジュール (v2.0.2):

- **2026-05 中下旬: voice/ 側実装着手** (v2.0.2 で前倒し)
  - voice/scripts/say.sh / voice/bin/voice-engine-up.sh / voice-engine-ready.sh / voice/systemd/companion-voice-engine.service / voice/ git init
  - 完了基準 (i) 「say.sh CLI 手動 invoke で発話成功」(v2.0 §3) まで到達可
- 2026-06 上旬: Phase 2.5 T-D 後半 (CreditBudgetGuard) を bot で実装、完了
- 2026-06 中旬: T-D 後半完了後 2 週間の Phase 2.5 健全性観察開始
- **2026-06 中下旬: bot/ 側実装着手** (T-D 後半完了後)
  - bot/voice_command.py / voice_status.py / voice_ledger.jsonl / bot.py への slash registration + import 1 行
  - voice/ 側がすでに動作する状態で接続するため衝突軽微、別 commit 必須
- 2026-07 上旬〜中旬: voice Phase 3-2 完了基準 (ii)(iii) 達成 + 運用観察開始
- 2026-07 中下旬〜2026-08 上旬: Phase 4 着手判断

### voice/ 側前倒し採用 (v2.0.2、2026-05-19)

| # | 経緯項目 |
|---|---|
| 1 | 2026-05-19 user 提案「6 月の変更 (=CreditBudgetGuard) 以外を前倒しできないか、そうしないと 1 ヶ月近く何もできない」→ lead 選択肢提示 (A. voice/ 側全部前倒し / B. T-1 sprint 残のみ / C. Phase 3 順序変更 / D. 現状維持) → user「おすすめで」→ A 採用確定 |
| 2 | 前倒し可能性の構造判定: voice/ 側 (bot.py / bot.service を一切触らない部分) は devil T-D-1(d) 構造原則 (bot.py 同時 2 方向回避 + Phase 2.5 健全性 2 週間観察) と独立。両根拠は bot.py / bot.service への変更が前提のため、voice/ ディレクトリ単独実装には適用されない |
| 3 | 新規設計判断ではない位置付け: voice-design v2.0 確定設計 (§1.6 ディレクトリ構成 / §1.8 bot voice_command.py 実装 / §3 完了基準 3 階層) はすべて維持。voice-design v2.0 §5.3 スケジュールのうち voice/ 側着手日のみ前倒し。team 議論なしで lead が user 意向を文書化 |
| 4 | drift 整備の前倒し処理: voice/SETUP.md (jq install 文 / T-1 sprint 完走条件) + voice/README.md (dashboard 駆動 6:30 → bot 駆動 /say) の v1.0 残置 drift を本台帳更新と同時に解消 |
| 5 | 期待効果: 完了基準 (i) を 5 月中に達成、6 月の T-D 後半完了後の bot/ 側実装で完了基準 (ii)(iii) を一気に到達。voice Phase 3-2 全体完了が 2026-07 上旬から早まる可能性 (運用観察 2 週間カウントの開始も早まる、Phase 4 着手判断は変動なし) |

### v2.0 議論で得た workspace/CLAUDE.md 補強候補

team companion-voice-design v2.0 Round 1〜3 議論で得た構造的反省 (Phase 3-2 完了タイミングで CLAUDE.md 改版検討対象):

- teammate Round N cross-review 着手前に「他 teammate の Round N 最新 plan を読み切る」明文化
- 各 plan の改版履歴 section を Round 2 / Round 3 ごとに必ず付ける運用 (cross-review 精度向上)
- ux「自己整合チェック報告」を出す際の比較対象 plan version (Round N) 明示書式
- lead Round 2 SendMessage で teammate に「相手の latest version を読み直してから cross-review」を明示指示する prompt 設計 (今回 lead orchestration ミスの自認)

---

## Done

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
