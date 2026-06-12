# voice-design.md — Phase 3-2 (TTS / voice/) 確定設計 v2.0

companion プロジェクト Phase 3-2 (PROJECT.md L143-188) の `~/companion/voice/` サブプロジェクト確定設計。team `companion-voice-design` v1.0/v1.0.1/v1.0.2 (11 ラウンド議論) + **v2.0 仕切り直し議論 (2026-05-18〜19、Round 1〜3、T-1 sprint #2 V-13 fail を契機とする bot 駆動先行への設計転換)** + user 最終承認で確定。

## 0. 概要 (v2.0)

- **エンジン**: VOICEVOX 0.25.2 (CPU mode、公式 7z 自己展開、T-1 sprint #1 で AVX1 適合 1 回確定済)
- **キャラ**: 四国めたん (speaker_id=2 = T-1 sprint #1 V-15 で実機確認済、機械学習禁止条項なし / キャライメージ損傷条項なし)
- **駆動**: **bot 駆動先行 (`/say` slash command、24h 受付)**、朝自動発火 (旧案 A T2) は punt (Phase 4 trigger)
- **完了基準**: bot `/say` 経由発話完成 + CLI tool 動作 (silence padding 1 秒 必須) + bot /status 統合 + 3 段階保険 failure mode
- **既存への副作用**: bot.py に `cmd_say` (voice_command.py 分離) + `voice_status.py` (新規) + `voice_ledger.jsonl` 追加。**dashboard.service 例外承認は撤回** (dashboard コード変更ゼロ死守原則に復帰)。maintenance/scripts/notify-system-report.sh 末尾 5 行追加 (12:00 昼通知 trigger 再定義)
- **Phase 2.5 T-D 後半 (2026-06 上旬完了予定) との順序**: voice 実装着手は **T-D 後半完了後** に倒す (bot.py 同時 2 方向変更 + Phase 2.5 健全性観察カウント影響回避、devil T-D-1(d) 採用)

## 1. 確定設計

### 1.1 エンジン選定 + 配布形態

VOICEVOX 0.25.2 engine、配布形態は **公式 7z 自己展開**。docker daemon 100-200MB 常駐コスト回避 (実機 RAM 3.7Gi 制約)。

`~/companion/voice/engine/linux-cpu-x64/` に展開 (`.gitignore`)。SETUP.md に展開手順 4 行記載。

**T-1 sprint #1 (2026-05-18) で AVX1 適合確定済**:
- 7z 1.69 GB 展開、`run --host=127.0.0.1 --port=50021 --cpu_num_threads=2 --output_log_utf8` 起動
- SIGILL なし、`INFO voicevox_core::synthesizer: CPUを利用します` log 確認
- `/version` HTTP 200, body `"0.25.2"`
- 詳細実測値は `voice/docs/STATUS.md`「実機計測値」section 参照

FAIL 時 user 介入経路 (T-1 sprint で pass 済のため将来 engine version up / 別環境で fail 再発した場合の備え、chain 自動化禁止):

| 優先 | 経路 | 内容 |
|---|---|---|
| α | docker install 承認 | `apt install docker-ce` + 公式 Docker image (cpu-latest) で再着手 |
| γ | native build | `onnxruntime-builder` で `-march=ivybridge` AVX1 ビルドを自前生成 (1-2h) |
| β | 別エンジン切替 | AivisSpeech engine + AivisHub の別キャラ採用 (user 再合意フェーズ) |
| δ | Phase 3-3 先行 | Phase 3-2 を撤回、Phase 3-3 STT に進む (最終手段) |

### 1.2 キャラ採用 — 四国めたん

- speaker_id=2 (T-1 sprint #1 V-15 で `/speakers` API から実機確認済、`voice/.env` の `VOICE_DEFAULT_SPEAKER=2` で固定)
- `say.sh` 第 2 引数で override 可
- 利用規約: zunko.jp 一次出典 (東北ずん子グループ音源規約準拠)、四国めたん固有罠なし
- **クレジット表記**: companion = 完全個人使用のため記載なし。user 外部公開時 (Discord 公開サーバー / YouTube 配信 / GitHub public repo 等) に検討。本書 §7 にライセンス URL + 短い要約

### 1.3 駆動戦略 — bot 駆動先行 (v2.0)

| 要素 | 仕様 |
|---|---|
| 発火タイミング | **user 能動 (Discord `/say <text>`)、24h 受付** (時間帯制限なし、user 確定 2026-05-18) |
| 不在検出 | **不要** (user が能動的に呼ばない限り発話しない、TV 状態取得手段は問わない = V-13 fail を回避) |
| 音量制御 | dashboard 並行時のみ mpv IPC ducking 検討 (Phase 4 で再評価、Phase 3-2 では実装しない) |
| engine 起動 | **on-demand 都度起動** (say.sh が `systemctl --user start companion-voice-engine.service` を蹴る + `/version` polling、合成完了後 stop)、常駐化は Phase 4 trigger (§4) |
| 第一声まで | **cold start 11-17 秒** (T-1 sprint #2 V-1 実測、drift 6 件目、推定 33-65 秒の 1/3 以下) |
| cold start UX | **案 W-silent**: `defer(thinking=True)` のみ、ephemeral 中間メッセージ追加なし。Discord「考え中…」インジケータで 11-17 秒吸収、90s `wait_for` timeout (M-8 修正済 §1.4) で「壊れた状態」回避 |
| 朝自動発火 | **Phase 3-2 punt** (Phase 4 trigger: TV 状態取得手段の代替が決まったとき、persona/ 着手と一体評価) |

### 1.4 consumer API (say.sh CLI)

```
say.sh "テキスト" [speaker_id=2]
say.sh -h

合成フロー (1 回で確定、リトライ自動化禁止):
  1. /audio_query → query.json (1 回)
  2. /synthesis → synth.wav (1 回)
  3. silence padding (必須): ffmpeg -i synth.wav -af "adelay=1000" padded.wav (1 回、fail-open)
     - 成功時: padded.wav を paplay 投入
     - ffmpeg 失敗時: 元 synth.wav で paplay 投入 + last-result に「padding skipped: <reason>」追記 (exit 0、UX 上は冒頭欠落の認知のみ)
  4. paplay (1 回)

EXIT CODE (1 回で確定、リトライ自動化禁止):
  0  OK (padding 成功 + paplay 成功 / padding skip + paplay 成功どちらも 0)
  1  ENGINE_UNREACHABLE     (curl 接続不可)
  2  ARGS_INVALID           (引数長 > 2000 字含む)
  3  LOCK_TIMEOUT           (flock -w 5 取得失敗)
  4  SYNTHESIS_FAILED       (audio_query / synthesis HTTP error)
  5  AUDIO_PLAYBACK_FAILED  (paplay rc != 0)

副作用 (常時実行、exit code 問わず):
  - voice/.state/last-result-YYYY-MM-DD に「OK | FAIL <reason> @ <ts>」を 1 invoke 1 行で追記
    (O_APPEND、初回 0600 作成。v2.0.3 訂正: 旧「atomic write (上書き)」は §1.5 (3)(4) の
    24h 件数集計と矛盾 = 日毎最終結果しか残らず FAIL ≥ 3 が構造的に発火不能だった)
  - padding 失敗時は last-result に「padding skipped: <ffmpeg stderr 1 行>」追記 (exit 0 のまま、padding は物理現象吸収の保険のため fail-open)
  - exit != 0 時: notify socket ($XDG_RUNTIME_DIR/companion-bot.sock) へ「[voice] FAIL <reason> (exit N)」送信 (CLI 直接呼び出し / 手動デバッグ時の保険として残置、bot 経由は bot.py が exit code を直接受けて followup で返すため運用頻度低下)
    socket 失敗時は last-result に「socket unreachable」追記
```

**引数長 multi-tier ガード (v2.0 → 2026-05-20 軸 5 M-8 で bot.py 100 字 / wait_for 90s に修正)**:

| 層 | 上限 | 根拠 |
|---|---|---|
| bot.py `/say` text 引数 | **100 字** クリップ警告 + cmd_say `wait_for(90s)` | M-8 修正前は 200 字 + wait_for(60s) だったが、voice/docs/STATUS.md V-2 実機計測 (warm RTF 0.463 秒/字、長文 85 字 39.35 秒) を再計算すると **200 字 = 92.6 秒 + cold 11-17 秒 = 103-110 秒 で wait_for(60s) 圧倒的超過**。100 字 = warm 46s + cold 17s = 63s で wait_for(90s) 内に余裕 27s。bot.py 側で 100 超を打ったら ephemeral 警告返答 (silent truncate でなく明示報告、CLAUDE.md 沈黙でなく報告原則) |
| say.sh CLI 直接 | **2000 字** exit 2 ARGS_INVALID | Discord 入力 2000 字上限と整合、CLI 直接呼び出しは bot wait 制約外で長文許容、2000 超は明示エラー (Round 3 衝突 2 lead 裁定維持、軸 5 でも防護柵対象) |

**境界変更時の判定基準 (2026-05-20 軸 5 M-8 + devil M-3 統合追加)**:

- **数値変更のみ** (例: bot.py 100 → 150 字 / wait_for 90s → 120s) は 2 周目該当 (CLAUDE.md「リトライ回数 / タイムアウト閾値 / バッファサイズ等の数値だけを動かす修正」)
- **境界変更が必要になった場合の判定**: テキスト構造の見直し (要約 / 複数文分割) が筋、数値だけ動かさない
- **実機検証 (Round 4 punt)**: bot/ 側着手後 (2026-06 中下旬以降) に voice_ledger.jsonl で cmd_say rc=99 (TIMEOUT) 発火率 1% 超 → M-8 100 字を 80 字に再修正 or wait_for 90s を 120s に再修正の判断材料 (K-16)

**silence padding 1 秒 (必須)**: HDMI sink wake-up latency ≥ 1秒 対策。T-1 sprint #1 実機検証 (2026-05-18 20:07-20:09 JST) で元 wav は「今日もよろしく」のみ聞こえ、ffmpeg `adelay=1000` padded wav で全文聞こえることを user 物理確認済。`paplay --latency-msec=1500` は sink wake-up に効かない検証済。詳細実測値・対応表は `voice/docs/STATUS.md`「実機計測値」section 参照。

flock 1 段 (engine 起動 race のみ)。Phase 4 で consumer 同時 invoke 競合発生時に 2 段化判断 trigger を STATUS.md に記録。

### 1.5 failure mode — 3 段階保険 (v2.0、v1.0.2 4 段階から再構成)

| # | 経路 | timing | 内容 |
|---|---|---|---|
| (1) | bot interaction.followup | 即時、success/failure 両方 | bot.py cmd_say が say.sh exit code を受けて即時 followup で「✓ 発話完了」 or 「✗ FAIL <reason> (exit N)」を Discord に返す。user 能動発話の応答なので success 時も「OK」を返す (`/quota` 等と同様、UX ノイズなし) |
| (2) | ~~9:00 ExecStopPost サマリ~~ | **撤回** | dashboard.service 例外承認も同時撤回 (lead 例外承認の根拠が崩れた)、PROJECT.md 元来の「dashboard コード変更ゼロ死守」原則に復帰 |
| (3) | 12:00 昼通知 trigger 再定義 | maintenance system-report 相乗り | `maintenance/scripts/notify-system-report.sh` 末尾 5 行追加。trigger:<br>- 過去 24h 内 voice FAIL ≥ 3 件<br>- 過去 24h 内 padding skipped ≥ 5 件 (devil 致命指摘 #4、padding skipped は exit 0 で followup に乗らない事象を可視化)<br>集計元は `voice/.state/last-result-YYYY-MM-DD` (専用 state 持たず、CLAUDE.md「state を持つ側を引いて 1 回で決める」原則) |
| (4) | bot `/status` 統合 (Phase 4 punt 撤回 + 前倒し) | user 任意 | `bot/voice_status.py` 新規 (Phase 2.5 T-D `quota.py` パターン継承)。`format_voice_summary()` を bot.py cmd_status 既存表示の末尾に append。voice (直近 24h) OK 件数 / FAIL 内訳 / padding skipped 件数 / 最終発話 (text 先頭 20 字) を表示。Phase 4 で persona/ キャラ確定時に出力フォーマット再評価 (関数シグネチャは Phase 3-2 で固定) |

`|| true` 沈黙吸収は **不採用** (CLAUDE.md「失敗時の回復は state 引き or ユーザー介入のいずれか」原則)。

### 1.6 ディレクトリ構成

```
voice/
├── bin/
│   ├── voice-engine-up.sh        # 7z 展開済 run バイナリ exec
│   └── voice-engine-ready.sh     # /version 200 polling 30s benign give-up
├── scripts/
│   └── say.sh                    # consumer API (exit code 6 段階 + flock 1 段 + notify socket + last-result + 引数長 multi-tier)
│                                 # ※ morning-greeting.sh は作らない (Phase 4 punt)
├── systemd/
│   └── companion-voice-engine.service   # Type=simple, Restart=no, WorkingDirectory=engine/linux-cpu-x64/
│                                        # ExecStart=run --host=127.0.0.1 --port=50021 --cpu_num_threads=2 --output_log_utf8
│                                        # ※ voice-greeting.service / .timer は作らない (Phase 4 punt)
├── engine/linux-cpu-x64/                # 公式 7z 展開 (.gitignore)
├── docs/STATUS.md                       # 台帳 (設計判断履歴 + V-list + 実機計測値 + ライセンス参照 + Phase 4 trigger + 観察ルール)
├── .state/                              # last-result-YYYY-MM-DD、0600 (.gitignore)
├── .env                                 # VOICE_DEFAULT_SPEAKER=2 等 (.gitignore)
├── .gitignore                           # engine/, .state/, .env
├── README.md                            # 用途・起動方法 (bot 経由が主、CLI 手動デバッグ可)
└── SETUP.md                             # 公式 7z DL + 展開手順 4 行 + jq install (Linux Mint default 未インストール、Phase 4 morning-greeting 復活時の依存)
```

**bot/ 配下の変更 (Phase 3-2 で実装、voice/ と並行)**:

```
bot/
├── bot.py                    # cmd_status に format_voice_summary() append、voice_command import + slash registration (1 行 + 1 ブロックのみ)
├── voice_command.py          # 新規 (devil 致命指摘 #3 採用、Phase 2.5 T-B/T-D 責務分解パターン継承)
│                             # async def cmd_say(text: str) -> tuple[int, str]:
│                             #     asyncio.create_subprocess_exec(SAY_SH, text) + wait_for(90s、M-8 修正済 §1.4) + zombie 回収
│                             #     /play cmd_play パターン継承、claude_lock 外で交錯なし
├── voice_status.py           # 新規 (Phase 4 punt 撤回、failure mode (4))
│                             # def format_voice_summary() -> str:
│                             #     voice/.state/last-result-* (今日 + 昨日) + voice_ledger.jsonl を読んで集計
├── voice_ledger.jsonl        # 新規 (append-only、quota.py パターン継承)
│                             # /say invoke 1 件 1 行: {"ts": "...", "text_prefix": "...", "rc": 0, "duration_ms": 12345}
│                             # Phase 4 trigger 数値判定 (§1.9) + format_voice_summary 集計元
├── quota.py                  # unchanged
├── claude_runner.py          # unchanged
├── sessions.py               # unchanged
├── companion-bot.service     # unchanged (voice 関連 env 追加なし)
└── .env / .env.example       # voice 関連 env は voice/.env 側に集約、bot 経由は SAY_SH path hardcode
```

**bot-workspace/.claude/settings.json**: bot.py 内 `asyncio.create_subprocess_exec` は claude permissions の制限外、追加なし。

**dashboard/ 配下 — 変更なし**: v1.0.2 で「dashboard.service ExecStopPost 1 行追加 (lead 例外承認)」だった部分は **撤回**。dashboard 本体 + service unit は触らない (PROJECT.md 元来の「dashboard コード変更ゼロ死守」原則に復帰)。

**maintenance/ 配下**: `maintenance/scripts/notify-system-report.sh` 末尾 5 行追加 (12:00 昼通知 trigger 再定義、failure mode (3))。

### 1.6.1 engine 起動オプション (T-1 sprint #1 `run --help` から確定、v1.0.1 継承)

```
companion-voice-engine.service
  ExecStart=$VOICE_HOME/engine/linux-cpu-x64/run \
    --host=127.0.0.1 \
    --port=50021 \
    --cpu_num_threads=2 \
    --output_log_utf8
```

| option | v1.0.1 確定 | 根拠 |
|---|---|---|
| `--use_gpu` | **付けない** (default off で CPU 推論) | flag 形式、`=False` 記法は実 CLI に存在しない |
| `--speaker=<id>` | **削除** | 起動オプション不在、speaker_id は `/audio_query` / `/synthesis` の query param で都度指定 |
| `--cpu_num_threads` | `--cpu_num_threads=2` | Inspiron 3521 物理 core 数 (i3-3217U 2C/4T、HT は合成では性能逆効果のことあり) |
| `--output_log_utf8` | 付けて UTF-8 ログ固定 | 環境依存の自動判定回避、Linux Mint 21.3 ja_JP.UTF-8 で安全側 |
| `--host` / `--port` | `127.0.0.1` / `50021` | 変更なし |

`WorkingDirectory=engine/linux-cpu-x64/` (= 7z 展開後の実 dir 名)。

### 1.6.2 前提 OS パッケージ

Phase 3-2 (v2.0 = bot 駆動先行) では `jq` 依存が消える (morning-greeting.sh を作らないため、jq を使うのは Phase 4 復活時)。Phase 3-2 着手時の OS パッケージ要件:

- `p7zip-full` (engine 7z 展開、Linux Mint 21.3 default で同梱) ※確認推奨
- `pulseaudio-utils` (paplay / pactl、default で同梱)
- `curl` (default で同梱)
- `ffmpeg` (silence padding 1 秒、default で未インストール → SETUP.md に `sudo apt install ffmpeg` 明記)

**jq は Phase 4 punt** (morning-greeting.sh 復活時に SETUP.md に追記、Phase 4 着手時の依存)。

### 1.7 ~~morning-greeting.sh 8 ステップ~~ — **削除 (Phase 4 punt)**

v1.0.2 §1.7 の `morning-greeting.sh` 8 ステップ実装は **Phase 3-2 で作らない**。Phase 4 trigger (TV 状態取得手段の代替が決まる、persona/ 着手と一体評価) で復活検討時に再設計。

Phase 4 復活時の参考: v1.0.2 §1.7 の 8 ステップ (Open-Meteo fetch / mpv IPC ducking / say.sh invoke / WMO ラベル変換) は git 履歴から復元可能 (本書 v1.0.2 を base に再採用判断)。

### 1.8 bot voice_command.py 実装 (案 A: bot.py 直接 subprocess)

architect §1.3 案 A + devil §1.1(b) voice_command.py 分離採用:

```python
# bot/voice_command.py (Phase 2.5 T-D の cmd_play パターン継承)
import asyncio
from pathlib import Path

SAY_SH = Path.home() / "companion/voice/scripts/say.sh"

async def cmd_say(text: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        str(SAY_SH), text,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        # 2026-05-20 軸 5 M-8 で 60s → 90s に修正済 (§1.4 参照)
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=90.0)
    except asyncio.TimeoutError:
        proc.kill(); await proc.wait()
        return 99, "[voice] TIMEOUT (90s)"
    return proc.returncode, _format_say_result(proc.returncode, stderr)

def _format_say_result(rc: int, stderr: bytes) -> str:
    if rc == 0: return "✓ 発話完了"
    reasons = {1: "ENGINE_UNREACHABLE", 2: "ARGS_INVALID", 3: "LOCK_TIMEOUT",
               4: "SYNTHESIS_FAILED", 5: "AUDIO_PLAYBACK_FAILED"}
    return f"✗ FAIL {reasons.get(rc, 'UNKNOWN')} (exit {rc})"
```

```python
# bot/bot.py (slash command 登録、既存の cmd_play パターン継承)
import voice_command  # ← 1 行追加

@client.tree.command(name="say")
@app_commands.describe(text="読み上げるテキスト (最大 100 字、超過時は ephemeral 警告)")  # 2026-05-20 軸 5 M-8 で 200 → 100 字に修正済 (§1.4 参照)
async def slash_say(interaction: discord.Interaction, text: str):
    if interaction.user.id != OWNER_ID:
        await interaction.response.send_message("not authorized", ephemeral=True); return
    if len(text) > 100:
        await interaction.response.send_message(
            f"text 長すぎ ({len(text)}/100 字)、100 字以内にしてください", ephemeral=True
        ); return
    await interaction.response.defer(thinking=True)  # 案 W-silent、ephemeral 追加なし
    rc, msg = await voice_command.cmd_say(text)
    await interaction.followup.send(msg)
    # voice_ledger.jsonl 追記 (Phase 4 trigger 集計元)
    voice_command.append_ledger(text, rc)
```

実装制約:
- **lock**: voice 経路は `claude_lock` 外、`asyncio.Lock` 追加不要 (devil T-D-1(c) 否決、architect Round 2 §1.4.2)。say.sh 内 flock 1 段で十分
- **claude_runner との交錯**: なし (subprocess 別経路、bot 起動以外で共有なし)
- **bot.py 本体への変更**: import 1 行 + slash registration 1 ブロックのみ (PR の diff 最小化、Phase 2.5 T-D 後半との作業 conflict 軽微)

### 1.9 Phase 4 trigger 再定義 (v2.0 新設、architect §7.1 + ux §3.5 統合)

旧 R3++ trigger (「3 朝連続自動発火失敗」) は Phase 3-2 で朝自動発火そのものを punt するため **削除**。v2.0 新 trigger:

#### voice 機能の Phase 4 着手判断 (PROJECT.md L194-209 #1/#2 接続)

| PROJECT.md 着手条件 | v2.0 数値ガイドライン (2026-05-20 軸 5 M-10 で 4 項目再構成) | 計測方法 |
|---|---|---|
| #1「Phase 3 能力が日常運用に組み込まれている、2 週間以上継続」 | **bot `/say` invoke が 14 日間で 10 回以上 + 週単位 5 回以上の波が 2 週間継続** | `voice_ledger.jsonl` 集計 (Phase 2.5 T-D `quota.py` ledger パターン継承) |
| #2「直近 2 週間で想定外の停止・誤動作・修正必須なし」 | bot.service NRestarts=0 + bot.log ERROR/WARN/Traceback 0 件 + voice FAIL < 10% (last-result 集計) | journalctl --user + voice/.state/last-result-* 集計 |
| #3「user 自身が『土台が落ち着いた、Phase 4 へ進む』と明示宣言」 | 主観判定、最終ゲート (数値は #1/#2 の客観根拠、user 自己宣言が最終) | user 明示宣言 |

**M-10 Phase 4 trigger 集計仕様 (2026-05-20 軸 5 集約、devil M-10 + architect L2-1 + ux UX-S3 統合)**:

- (i) **集計対象範囲**: bot 駆動 `/say` invoke のみ (`voice_ledger.jsonl`)。voice/ CLI 直接 invoke (手元 terminal 経由 `voice/scripts/say.sh "..."`) は `voice/.state/last-result-YYYY-MM-DD` 経由で §1.10 縮退判断材料として参照、Phase 4 trigger 集計には含めない (CLI 直接前提の判定で persona/ キャラ確定後の自発発話 trigger 設計が崩れるのを防ぐ)
- (ii) **起算日**: bot/ 側 voice 実装完了 (= 完了基準 (ii)(iii) 達成 = bot 経由 /say invoke の実弾運用開始日、§5.3 スケジュールで 2026-06 中下旬目処) 起点。voice/ 側完了 (2026-05-19、完了基準 (i) 達成) のみでは起算しない
- (iii) **再キャリブレーション運用ルール**: 起算日後 2 週間 (= 2026-07 上旬目処) の `voice_ledger.jsonl` 実測値で「週 N 回ペース × M 週継続」の N/M 値を再決定 (ux UX-S3 指摘「週 5 回 = user 自然運用 Phase 3-1 週 1.4 回ペースの 3-4 倍」検証必須)。N/M 値の再決定は `voice/docs/STATUS.md`「観察ルール」に記録、本書 §1.9 表の「14 日間で 10 回以上 + 週 5 回 × 2 週間継続」数値は実測値で更新
- (iv) **縮退判断ゲート**: bot/ 側完了 + 1 週間 で `voice_ledger.jsonl` 1 日平均 invoke 1 回未満 → §1.10 縮退判断経路通過必須 (Phase 3-3 STT 前倒し or Phase 3-2 縮退 or 早期 Phase 4 着手 = キャラ性付与の三択)

#### Phase 4 trigger 候補 (v2.0、各項目別)

| 項目 | trigger 条件 |
|---|---|
| **朝自動発火 (morning-greeting.sh / voice-greeting.{service,timer} 復活)** | TV 状態取得手段の代替 (cec-client / PulseAudio sink / TV IP API / dashboard.service Requires のみ / 諦め) のうち 1 件が user 承認 + persona/ 着手と一体評価 |
| **bot `/say` 自然文発火 (案 H、`@renbot おはよう` パターン)** | persona/ キャラ確定 + voice /say 運用頻度 1 日 5 回以上を 1 週間継続 |
| **テキスト口調仕込み (`/say おはよう` → 「おはよう。今日もよろしくね」加工)** | persona/ キャラ確定 (Phase 3-2 では実装しない、devil 致命指摘 #2 採用 = キャラ性後のせ原則違反回避) |
| **engine 常駐化 (RAM 268MB 持続、cold start 排除)** | bot 駆動 /say invoke が 1 日平均 5 回超を 1 週間継続 (voice_ledger.jsonl 集計) |
| **engine idle 30 分 stop (常駐後の自動 idle 停止)** | engine 常駐化採用後の運用観察で常駐コスト顕在化時 |
| **voice-on-demand.service 経由 (bot.py 直接 subprocess から systemd 経由に移行)** | consumer 2 件目 (例: persona/ キャラ確定後の自発発話 trigger) が出た段で再評価 |
| **AivisSpeech 並行 RTF 実測 + ACML/CC0 キャラ評価** | persona/ キャラ続投 vs 切替判断 |

#### 素声運用期間上限 (devil T-D-3 採用、2026-05-20 軸 5 M-9 で起算日明示)

- **上限 2 ヶ月** (= bot 経由 /say invoke の実弾運用開始日 = 完了基準 (ii)(iii) 達成 = 2026-06 中下旬目処)、user 主観で延長可
- **起算日の明確化 (M-9)**: voice/ 側完了 (2026-05-19、完了基準 (i) 達成 = `say.sh` CLI 単独動作のみ) のみでは起算しない。Phase 3-2 完了の主目的が bot 駆動先行のため、CLI 直接 invoke のみで 2 ヶ月過ぎても素声運用上限とはみなさない
- 期間内に Phase 4 着手 #1/#2 を満たさない場合: STATUS.md「観察ルール」で状況確認、case「素声運用が日常に組み込まれない」と判明したら Phase 3-2 縮退判断 (bot /say 撤去 / Phase 3-3 STT 前倒し検討)

#### Phase 3-2 実装の Phase 4 改修総量 (architect §7.2)

| Phase 3-2 実装項目 | Phase 4 改修見込み |
|---|---|
| voice/scripts/say.sh | 0% (CLI 契約継承、persona/ で speaker_id 切替時のみ env 変更) |
| bot/voice_command.py cmd_say | 5% (persona/ キャラ確定で text 前処理関数 hook を追加する可能性) |
| bot/voice_status.py format_voice_summary | 20% (persona/ キャラ口調混ぜ表示、関数シグネチャは固定) |
| bot/voice_ledger.jsonl 集計ロジック | 0% (ledger 形式は変えない) |
| systemd companion-voice-engine.service | 0% (engine 仕様継承) |
| morning-greeting.sh (Phase 4 で復活) | 100% 新規実装 |

**Phase 3-2 実装の Phase 4 改修総量 ~15%** (devil §1.3(c) 許容範囲 50% を大幅クリア)、捨て駒リスク低。

### 1.10 Phase 4 着手前の縮退判断経路 (devil T-D-4 採用)

Phase 3-2 完了直後 1 週間試運用で:

- bot /say invoke が 1 日 1 回未満 (user 自然な利用にならない) → Phase 3-3 STT 前倒し検討 or Phase 3-2 縮退 (CLI 動作のみで完了基準を満たし、bot /say 撤去)
- user 主観で「Discord text 返事で十分、TTS 不要」判定 → 上記同様

縮退判断結果は STATUS.md「観察ルール」に記録、Phase 4 着手時の主観評価材料。

## 2. Phase 3-2 着手前 T-1 sprint (v2.0 完了)

T-1 sprint #1 (2026-05-18) + #2 (2026-05-18〜19) で完了:

| 項目 | 対応 V-* | 結果 |
|---|---|---|
| B-voice-15 AVX1 適合 | V-0a | **pass** (T-1 sprint #1) |
| /version 200 | - | pass (T-1 sprint #1) |
| 四国めたん speaker_id | V-15 | id=2 確定 (T-1 sprint #1) |
| 合成 RTF warm | V-2 | 短 2.94 / 中 2.29 / 長 2.13 (T-1 sprint #1) |
| RAM 占有 warm | V-3 | RSS 268MB (T-1 sprint #1) |
| PulseAudio HDMI 出力 | V-3a | pass (T-1 sprint #1) |
| 発話確認 + silence padding 1 秒必須化 | V-0a 補足 | pass (T-1 sprint #1) |
| **engine 真の cold start** | **V-1** | **11.34/11.52/17.48 秒 (T-1 sprint #2、drift 6)** |
| ~~HDMI EDID 物理電源 ON/OFF 区別~~ | ~~V-13~~ | **削除 (TV hot standby で fail、user 確定で case B 採用 = 朝自動発火 punt)** |
| BGM 同時再生 + mpv IPC ducking | V-5 | Phase 4 punt (朝自動発火復活時に実機計測) |

Phase 3-2 実装着手時の追加検証:

| 項目 | 対応 V-* | 内容 |
|---|---|---|
| bot `/say` 実弾発話 | **V-S1 (新規)** | Discord `/say "おはよう"` 実行で 11-17 秒後に発話 + Discord followup「✓ 発話完了」表示 |
| bot `/status` voice 集計表示 | **V-S2 (新規)** | `/status` で format_voice_summary 出力 (24h OK/FAIL/padding skipped/最終発話 text 先頭 20 字) 表示 |

検証用テキスト:
- 短文 (10字): `"おはよう。今日もよろしく"`
- 中文 (30字): `"おはよう。今日の天気は晴れ。最高 22 度、最低 14 度です"`
- 長文 (80字): `"おはよう。今日の天気は晴れ時々曇り。最高気温は 22 度、最低気温は 14 度です。降水確率は午前 10 パーセント、午後 30 パーセントです。傘の準備をすると安心です"`

## 3. Phase 3-2 完了基準 (3 階層、v2.0)

| 階層 | 基準 |
|---|---|
| **必須 (土管動作)** | `say.sh "テキスト"` CLI 手動 invoke で発話 / exit code 6 段階契約通り / `.state/last-result` 更新 / `companion-voice-engine.service` 起動 + `/version` 200 |
| **consumer 動作 (bot 駆動)** | bot `/say` 経由発話成功 (V-S1 実弾) + bot `/status` に voice 集計表示 (V-S2 実弾) + voice_ledger.jsonl 追記確認 |
| **検証** | V-0a/V-1/V-2/V-3/V-3a/V-15 + V-S1/V-S2 全 pass、STATUS.md「実機計測値」section 記録 |

## 4. Phase 4 punt 項目 (Phase 3-2 で実装しない、v2.0)

| 項目 | Phase 4 trigger | 備考 |
|---|---|---|
| **朝自動発火 (morning-greeting.sh / voice-greeting.{service,timer} / wmo-label.sh)** | TV 状態取得手段の代替確定 + persona/ 着手と一体評価 | v1.0.2 案 A T2 を全面 punt、§1.9 trigger 候補参照 |
| **自然文発火 (案 H、`@renbot おはよう` パターン)** | persona/ キャラ確定 + voice /say 運用頻度 1 日 5 回以上を 1 週間継続 | ux Round 1 §1.2 推奨、voice-design v2.0 §1.9 trigger |
| **テキスト口調仕込み (バリエーション加工)** | persona/ キャラ確定 | devil 致命指摘 #2 採用、Phase 3-2 で実装するとキャラ性後のせ原則違反 |
| **engine 常駐化 (RAM 268MB 持続)** | bot /say invoke 1 日 5 回超 × 1 週間継続 | devil 致命指摘 #5 数値化、voice_ledger.jsonl 集計で発火判定 |
| **engine idle 30 分 stop** | engine 常駐化採用後の運用観察で常駐コスト顕在化時 | architect §1.1 alt 検討 |
| **voice-on-demand.service 経由** | consumer 2 件目 (persona/ 自発発話等) で再評価 | architect §1.3 案 C punt 維持 |
| **dashboard footer クレジット表示** | 外部公開検討 + persona/ キャラ確定 | v1.0.2 から継承 |
| **voice-sink-check.sh 共通ヘルパー** | consumer 3 箇所目で抽出 (YAGNI) | v1.0.2 から継承 |
| **ducking 共通化 (voice-ducking.sh)** | caller 2 件目で抽出 (maintenance lib/notify.sh パターン) | v1.0.2 から継承 |
| **AivisSpeech 並行 RTF 実測 + ACML/CC0 キャラ評価** | persona/ キャラ続投 vs 切替判断 | v1.0.2 から継承 |
| **V-2b (同時 synthesis)** | consumer 同時 invoke 段で測定 | v1.0.2 から継承 |
| **完全文事前生成キャッシュ** | cold start 体感悪化観察時 | v1.0.2 から継承、cold 11-17 秒なら現状不要 |
| **flock 2 段化** | consumer 増加で同時 invoke 競合発生時 | v1.0.2 から継承 |

## 5. 設計判断履歴 (v2.0、case B 採用根拠 + R3++ trigger 再定義)

### 5.1 case B (朝自動発火 punt + bot 駆動先行) 採用根拠

CLAUDE.md「設計判断・対症療法の上限」原則照らし合わせ、case A (xrandr 置換 = cec-client / PulseAudio sink / TV IP API / dashboard.service Requires のみ / 諦め) の検証を **試さず** case B (全撤回) を採用した経緯を以下に書面化 (devil §4.7 lead 責務 #1 / case A 検証外し 5 項目反映):

| # | 経緯項目 |
|---|---|
| 1 | 2026-05-18 T-1 sprint #2 V-13 fail 確定 (リモコン TV 電源 OFF でも HDMI-1 connected 維持、TV side hot standby で EDID 信号維持確認) → user 提案「自動で鳴らす設計をやめて、いったんその時間帯に Discord から声をかけたときのみに絞る」 → lead 追加 Q 2 件確認 (時間帯 = 24h 受付、朝挨拶 UX = 完全 punt) で case B 採用が user 確定 |
| 2 | CLAUDE.md「2 周目の定義」原則遵守確認: V-13 fail は 1 周目の漏れ。case A (TV 状態取得手段置換) は「stderr 文言マッチ / フォールバック分岐 / 数値変更」に該当せず 2 周目ではなく**設計引き直し許容方向**だが、user 意向で「設計概念ごと撤回」(case B) の方向に倒したため、case A 検証は適用免除 |
| 3 | case A 検証を試さなかった機会損失: 5 案 (cec-client / PulseAudio sink / TV メーカー IP API / dashboard.service Requires のみ / 諦め) のうち実機検証は 0 件、これらは Phase 4「morning-greeting 復活」trigger で再検証候補として残置 (§4) |
| 4 | R3++ 構造論との関係: v1.0.2 §5 旧 trigger (3 朝連続自動発火失敗) は朝自動発火そのものを punt するため形骸化 → v2.0 で削除、新 trigger に置換 (§5.2) |
| 5 | 将来 Phase 4 で朝挨拶復活判断時の手段選択肢: case A 5 案を Phase 4 punt 項目として残置 (§4 朝自動発火 trigger)、user 再評価で復活判断 |

**lead 単独責任の書面化**: 本 §5.1 は team companion-voice-design Round 2 で devil §4.7 / §4.8 が提案した「case A 検証外し根拠の STATUS.md 書面化責務」を v2.0 で果たした記録。voice/docs/STATUS.md「設計判断履歴」section にも転記。

### 5.2 R3++ trigger v2.0 (旧 trigger 削除 + 新 trigger 置換)

旧 trigger (voice-design.md v1.0.2 §5「3 朝連続自動発火失敗」) は朝自動発火そのものを Phase 3-2 で punt するため削除。新 trigger:

- **voice 駆動 FAIL 累積率**: 過去 1 ヶ月の voice /say invoke のうち FAIL (exit != 0) 累積 10% 超 → 設計仕切り直しサイン (新 trigger A)
- **朝挨拶復活 case**: §4 朝自動発火 punt 項目の Phase 4 trigger 候補 (cec-client / PulseAudio sink / TV IP API / Requires のみ / 諦め) のうち 1 件で実機検証 pass → 朝自動発火復活判断 (新 trigger B)
- **case A 構造論の future 保存**: devil §1.5(a)「TV 状態取得代替検証 1-2 件試す責務」は Phase 4「朝挨拶復活」trigger 検証で果たす (Phase 3-2 着手段では適用免除)

### 5.3 Phase 2.5 T-D 後半 (2026-06 上旬) との作業順序 (devil T-D-1(d) 採用、v2.0.2 で voice/ 側前倒し)

bot/docs/STATUS.md TODO「T-D 後半 (CreditBudgetGuard 実装、2026-06 上旬予定)」と voice Phase 3-2 (bot.py に voice_command.py + voice_status.py 追加) が同時期 2026-06 上旬で **bot.py を 2 方向から触る並走リスク**。

**devil T-D-1(d) 構造原則 (維持)**:
- (1) bot.py 同時 2 方向変更 (CreditBudgetGuard と voice_command.py) の回避
- (2) Phase 2.5 T-D 後半完了後 2 週間の Phase 2.5 健全性観察カウントへの影響回避

**確定スケジュール (v2.0.2、2026-05-19 user 提案で voice/ 側のみ前倒し)**:

- **2026-05 中下旬: voice/ 側 (bot.py を触らない部分) 実装着手** (v2.0.2 で前倒し)
  - 対象: `voice/scripts/say.sh` / `voice/bin/voice-engine-up.sh` / `voice/bin/voice-engine-ready.sh` / `voice/systemd/companion-voice-engine.service` / voice/ git init
  - 前倒し根拠: voice/ 単独実装は bot.py を一切触らない → 構造原則 (1)(2) と独立。bot サービスに変更を加えないため Phase 2.5 健全性カウントにも無関係
  - 完了基準 (i) 「say.sh CLI 手動 invoke で発話成功」(v2.0 §3) まで到達可
- 2026-06 上旬: Phase 2.5 T-D 後半 (CreditBudgetGuard) を bot で実装、完了
- 2026-06 中旬: T-D 後半完了後 2 週間の Phase 2.5 健全性観察開始
- **2026-06 中下旬: bot/ 側 voice 実装着手** (T-D 後半完了後)
  - 対象: `bot/voice_command.py` / `bot/voice_status.py` / `bot/voice_ledger.jsonl` / `bot/bot.py` への slash registration 1 行 (v2.0 §1.8)
  - bot.py を触る部分のみここに残置。voice/ 側がすでに動作する状態で接続するため衝突軽微、別 commit 必須
- 2026-07 上旬〜中旬: voice Phase 3-2 完了基準 (ii)(iii) 達成 + 運用観察開始
- 2026-07 中下旬〜2026-08 上旬: Phase 4 着手判断 (PROJECT.md L194-209 #1/#2/#3)

このスケジュールは PROJECT.md L130-135 「サブタスク依存順序原則」と整合。voice/ 側前倒しは devil T-D-1(d) の構造原則を破らない運用上の前倒しで、新規設計判断ではない (2026-05-19 user 提案 → lead 確認で台帳化)。

**maintenance/ 触る部分の追記タイミング明示 (2026-05-20 軸 5 M-11 追加、architect M2-2 採用)**: §10 次フェーズへの引き渡し「5. maintenance/scripts/notify-system-report.sh 末尾 5 行追加 (§1.5 (3) 12:00 trigger)」は **bot/ 側着手 (2026-06 中下旬) と同時 commit で実施**、voice/ 側前倒し (2026-05 中下旬) では maintenance に触らない。理由: 12:00 昼通知 trigger は voice_ledger.jsonl が出来てから (= bot/ 側着手後) でないと集計対象が空。voice/ 側前倒しで maintenance も触ると、bot 経由 voice_ledger.jsonl 集計と maintenance trigger 集計の起点が 1 ヶ月先行ずれを起こす (devil T-D-1(d) 構造原則の隙間運用回避)。

## 6. PROJECT.md L17 訂正 (v1.0 から残置、v2.0 でも有効)

`Dell Inspiron 3521 (2013), Ivy Bridge 2 コア (i3-3217U 1.8GHz / 4 logical / AVX1 only), RAM 3.7Gi total, Swap 2.0Gi, Storage HDD ST500LT012 (ROTA=1), GPU なし, docker 未インストール`

これは voice/ 設計 + Phase 4 + 将来着手者の center of truth 修復。

## 7. ライセンス参照 (v1.0 から残置、v2.0 でも有効)

**VOICEVOX 全体規約**: <https://voicevox.hiroshiba.jp/term/>
- 商用 / 非商用 OK、エンジン使用無料

**四国めたん 個別規約**: <https://zunko.jp/con_ongen_kiyaku.html> (東北ずん子グループ音源規約準拠)
- 商用 / 非商用 OK、機械学習禁止条項なし、キャライメージ損傷禁止条項なし
- クレジット表記要件: 「気になって見にいった際にわかる程度」(緩い)
- companion 利用形態: **完全個人使用、外部公開なし** → クレジット表記対象が存在しない、実質義務なし

**将来の外部公開検討時** (Discord 公開サーバー投稿 / YouTube 配信 / GitHub public repo 等): 上記規約 URL を再確認し、媒体に応じてクレジット記載判断。

## 8. 議論経緯

### 8.1 v1.0/v1.0.1/v1.0.2 議論経緯 (historical record、2026-05-14〜18)

team `companion-voice-design` v1.0 で 11 ラウンドの議論 (architect / ux / ops / devil + lead) で案 A T2 + 四国めたん確定 (詳細は v1.0.2 §8 参照)。

主な確定事項:
- §8.1 devil 視点: 落とし穴 B 3 回続発 + reflection 6 + 新攻撃 5 = 11 項目構造的着地
- §8.2 ux 視点: 4 周回 self-correction + AskUserQuestion 越権の反省
- §8.3 ops 視点: 3 周目認知 + 独断 revert 打たず方針
- §8.4 新規構造規律: self-correction 2 周回ルール + AskUserQuestion 使用は lead に集約
- §8.5 workspace/CLAUDE.md §B/§C/§F 補強事例 (lock-in)

### 8.2 v2.0 議論経緯 (2026-05-18〜19、Round 1〜3)

team `companion-voice-design` 再起動で 3 teammate (architect / ux / devil) を spawn、Round 1〜3 で voice-design v2.0 確定。

#### Round 1 (各 role independent initial position)

- architect: 朝自動発火完全 punt / bot.py 直接 subprocess 案 A / on-demand 都度 engine / dashboard ExecStopPost 撤回 / failure mode 4 → 3 段階再構成
- ux: 案 S (slash `/say`) default 推奨 / 案 W-imm 即返事 ephemeral / 案 B-user (能動経路) 主 / 5 件の lead 経由 user 追加 Q 候補
- devil: 8 罠 T-D-1〜T-D-8 + 採用前検証項目、致命罠 T-D-5(a) = TV 状態取得代替 1-2 件試行責務 (case A vs case B)

#### Round 2 (cross-review + 反証応答)

- lead が user に追加 Q 2 件確認: 時間帯 24h 受付 / 朝挨拶 UX 完全 punt → devil 致命罠 T-D-5(a) 否決
- 各 teammate が他 plan を cross-review、自分の plan を改版
- architect Round 2: voice_command.py 分離採用 (devil 採用) / lock 排他否決 / Phase 2.5 T-D 後半順序採用 / Phase 4 trigger 具体形採用 / 素声運用 2 ヶ月 + 改修総量 ~15% / W-imm 採用 / 引数長 bot 200 + CLI 2000
- ux Round 2: W-imm → W-silent 転換 (devil §1.7(d) 2 段返信煩雑性受容) / 引数長 bot 200 + CLI 300 (architect Round 1 参照ミス、cross-review version 不一致) / Phase 4 trigger 数値化 (週 5 回 × 2 週間 + voice_ledger.jsonl) / テキスト口調仕込み Phase 4 punt 確定
- devil Round 2: 罠致命度更新 (T-D-1 中→高 / T-D-3 中→高 / T-D-4 中→低 / T-D-5 削除) / 致命級指摘 5 件 (Phase 2.5 T-D 後半順序 / テキスト口調仕込み後のせ原則違反 / voice_command.py 分離 / 9:00 サマリ撤回代償 = padding skipped trigger 化 / engine 常駐数値化) / lead 責務 8 項目

#### Round 3 (lead 単独集約)

衝突 2 件発見・裁定:
- 衝突 1 (cold start UX W-imm vs W-silent): **W-silent 採用** (ux Round 2 = devil 反証を受けた最新議論進展、simple)
- 衝突 2 (say.sh CLI 引数長 300 vs 2000): **2000 字採用** (architect Round 2 が最新、CLI 直接呼び出しは bot wait 制約外で長文許容、ux 側 cross-review version 不一致による情報タイムラグ)

devil 致命級指摘 5 件すべて v2.0 反映:
1. Phase 2.5 T-D 後半順序 → §5.3
2. テキスト口調仕込み Phase 4 punt → §4
3. voice_command.py 分離 → §1.8
4. padding skipped trigger 化 (24h ≥ 5 件 12:00 通知) → §1.5 (3)
5. engine 常駐数値化 (1 日 5 回 × 1 週間継続) → §1.9 / §4

### 8.3 v2.0 議論で得た workspace/CLAUDE.md 補強候補

ux Round 2 自己反省 3 件 + lead orchestration ミス 1 件:

- teammate Round N cross-review 着手前に「他 teammate の Round N 最新 plan を読み切る」明文化
- 各 plan の改版履歴 section を Round 2 / Round 3 ごとに必ず付ける運用 (cross-review 精度向上)
- ux「自己整合チェック報告」を出す際の比較対象 plan version (Round N) 明示書式
- lead Round 2 SendMessage で teammate に「相手の latest version を読み直してから cross-review」を明示指示する prompt 設計

これらは workspace/CLAUDE.md「Agent Teams 運用方針 / 落とし穴 B-2」として **2026-05-19 反映済** (Phase 3-2 完了タイミングを待たず前倒し、bot/voice いずれも触らない独立作業として処理)。

## 9. 改版履歴

- 2026-05-18 v1.0 lead 転記、team 11 ラウンド議論最終形 + user 最終承認
- 2026-05-18 v1.0.1 T-1 sprint #1 実測フィードバック反映 (engine 起動オプション確定 / jq install / 展開 dir 名訂正)
- 2026-05-18 v1.0.2 T-1 sprint #1 HDMI sink wake-up latency 発見反映 (silence padding 1 秒 必須化)
- **2026-05-19 v2.0** T-1 sprint #2 V-13 fail を契機とする設計仕切り直し (朝自動発火 punt → bot 駆動先行)
  - 根拠: T-1 sprint #2 V-13 fail (TV hot standby で xrandr EDID 維持 = gate 機能せず確定) + V-1 cold start drift 6 件目 (11-17 秒、推定 33-65 秒の 1/3 以下)
  - team `companion-voice-design` v2.0 議論 (Round 1〜3、architect / ux / devil + lead 集約)
  - 主要変更:
    - §0 駆動: dashboard 駆動先行 (案 A T2 6:30 自動発火) → bot 駆動先行 (`/say` slash 24h 受付)
    - §1.3 駆動戦略 全面書き直し (bot 駆動 + on-demand engine + cold start UX 案 W-silent)
    - §1.4 引数長 multi-tier 追加 (bot.py /say 200 字 + say.sh CLI 2000 字、衝突 2 lead 裁定)
    - §1.5 failure mode 4 → 3 段階 (9:00 サマリ撤回 = dashboard ExecStopPost 例外承認も撤回、12:00 trigger 再定義 + padding skipped trigger 追加、bot /status 統合前倒し)
    - §1.6 ディレクトリ構成 (morning-greeting.sh / voice-greeting.{service,timer} / wmo-label.sh 削除、bot/ 側に voice_command.py + voice_status.py + voice_ledger.jsonl 追加)
    - §1.7 morning-greeting.sh 8 ステップ削除 (Phase 4 punt)
    - §1.8 bot voice_command.py 実装新設 (案 A bot.py 直接 subprocess + voice_command.py 分離、devil T-D-1(b) 採用)
    - §1.9 Phase 4 trigger 再定義新設 (週 5 回 × 2 週間 + voice_ledger.jsonl 数値化、素声運用 2 ヶ月上限 + 改修総量 ~15%)
    - §1.10 Phase 4 着手前縮退判断経路新設 (devil T-D-4 採用)
    - §2 T-1 sprint V-13 削除、V-S1/V-S2 新規追加
    - §3 完了基準 bot /say 経由発話 + bot /status 統合
    - §4 Phase 4 punt 項目大幅更新 (朝自動発火復活 / 自然文発火 / テキスト口調仕込み / engine 常駐数値化等)
    - §5.1 case B 採用根拠 5 項目書面化 (devil §4.7 lead 責務 #1 採用)
    - §5.2 R3++ trigger v2.0 (旧 trigger 削除 + 新 trigger 置換)
    - §5.3 Phase 2.5 T-D 後半順序確定 (devil T-D-1(d) 採用)
    - §8.2 v2.0 議論経緯 append (Round 1〜3 lead 集約)
    - §8.3 workspace/CLAUDE.md 補強候補追加
- 2026-05-19 v2.0.1 §8.3 status 更新: workspace/CLAUDE.md「落とし穴 B-2」として反映済 (Phase 3-2 完了タイミングを待たず前倒し、独立作業として bot/voice 触らず処理)
- **2026-06-12 v2.0.3** voice bot 統合実装 (Phase 4、persona 軸 2 gate 開通) に伴う実装反映 3 点:
  - §1.4 last-result を「atomic write (上書き)」→「1 invoke 1 行追記」に訂正。code-reviewer が §1.5 (3)(4) の 24h 件数集計との内部矛盾 (上書きでは日毎最終結果しか残らず FAIL ≥ 3 / padding skipped ≥ 5 が発火不能) を検出、say.sh を追記化 (案 A)。案 B (bot ledger のみ集計) は CLI invoke + padding skipped が漏れ failure mode (3) を実質無効化するため不採用
  - §1.8 の Discord 前提コード (defer / ephemeral / followup) は Telegram 読み替えで実装 (typing chat action / 通常 reply)。engine on-demand start/stop (§1.3) は say.sh でなく bot/voice_command.py 側に配置 (検証済み say.sh の合成責務を変えない)。これに伴い「asyncio.Lock 追加不要」(§1.8 実装制約) は条件が崩れ (stop が say.sh 内 flock の外に出た)、bot 層で cmd_say を asyncio.Lock 直列化
  - voice_ledger.jsonl は §1.6 図の bot/ 直下でなく bot/sessions/ 配下 (gitignore 済み、quota ledger 同居 = 「quota.py パターン継承」優先)
- **2026-05-19 v2.0.2** §5.3 スケジュール書き換え: voice/ 側 (bot.py を触らない部分: say.sh / bin/ / systemd/companion-voice-engine.service / voice/ git init) を 2026-05 中下旬から前倒し着手、bot/ 側 (voice_command.py / voice_status.py / voice_ledger.jsonl / bot.py への slash registration) のみ Phase 2.5 T-D 後半完了後 = 2026-06 中下旬を維持
  - 経緯: 2026-05-19 user 提案「6 月の変更 (=CreditBudgetGuard) 以外を前倒しできないか」→ A 案 (voice/ 側全部前倒し) 採用
  - 根拠: devil T-D-1(d) 構造原則 (bot.py 同時 2 方向回避 + Phase 2.5 健全性 2 週間観察) は voice/ 側単独実装と独立。voice/ は bot.py / bot.service を一切触らないため両根拠と無関係
  - 新規設計判断ではない: voice-design v2.0 確定設計 (§1.6 ディレクトリ構成 / §1.8 bot voice_command.py 実装 / §3 完了基準 3 階層) はすべて維持。スケジュール上の前倒しのみ
  - 期待効果: voice Phase 3-2 完了基準 (i) 「say.sh CLI 手動 invoke で発話成功」を 5 月中に達成、6 月の T-D 後半完了後の bot/ 側実装で完了基準 (ii)(iii) を一気に到達できる

## 10. 次フェーズへの引き渡し (v2.0)

Phase 3-2 着手は別セッションで lead 主導:

1. **Phase 2.5 T-D 後半 (CreditBudgetGuard) 完了確認** (2026-06 上旬予定、bot/docs/STATUS.md 参照)
2. **T-D 後半完了 + 2 週間の Phase 2.5 健全性観察開始**
3. **voice/ 実装着手** (T-D 後半完了後、2026-06 中下旬目処、§5.3 順序確定参照):
   - `~/companion/voice/` を git init (PROJECT.md L46-59 のサブプロジェクト git 化手順)
   - voice/scripts/say.sh 実装 (exit code 6 段階 + flock 1 段 + notify socket + last-result + 引数長 multi-tier + silence padding 1 秒)
   - voice/systemd/companion-voice-engine.service 作成 (§1.6.1 確定形)
   - 各 unit を `~/.config/systemd/user/` に symlink 配置
4. **bot/ 実装着手** (voice/ と並行、別 commit):
   - bot/voice_command.py 新規 (§1.8)
   - bot/voice_status.py 新規 (§1.5 (4) + 1.9 ledger 集計)
   - bot/voice_ledger.jsonl 新規 (append-only、Phase 4 trigger 集計元)
   - bot/bot.py に slash registration + import 1 行追加 (Phase 2.5 T-D 後半完了後の commit)
5. **maintenance/scripts/notify-system-report.sh 末尾 5 行追加** (§1.5 (3) 12:00 trigger)
6. **完了基準 3 階層** (§3) を全て満たした時点で Phase 3-2 完了、PROJECT.md L150-152 (Phase 3-1 完了状況) に倣って Done エントリ追記
7. **Phase 4 着手判断** (§1.9): voice_ledger.jsonl 集計で #1 (週 5 回 × 2 週間) + journalctl/voice/.state 集計で #2 (NRestarts=0 + FAIL < 10%) + user 自己宣言 #3 で判定

Phase 4 着手は PROJECT.md L196-203 の着手発火条件 (1) (2) (3) を満たした時点。Phase 3-2 で確定したキャラ (四国めたん) は Phase 4 で再評価可能 (§4 AivisSpeech 並行 RTF 実測 trigger)。
