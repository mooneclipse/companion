# companion-voice セットアップ

VOICEVOX engine (CPU mode) を Inspiron 3521 に展開する手順。確定設計は `~/companion/workspace/redesign/voice-design.md` v2.0 §1.1。

## 前提

- 実機: Dell Inspiron 3521 (Ivy Bridge i3-3217U, AVX1 only, RAM 3.7Gi, HDD ST500LT012)
- Linux Mint 21.3 MATE / docker 未インストール
- 配布形態: 公式 7z 自己展開 (docker daemon 100-200MB 常駐コスト回避、AppImage は voice-design.md 議論で 7z に統合)
- 必要パッケージ (未インストールなら `sudo apt install <name>`、sudo は user 側ターミナルで実行):
  - `p7zip-full` (7z 展開、Linux Mint 21.3 default で同梱済み)
  - `pulseaudio-utils` (`paplay` / `pactl`、Linux Mint 21.3 default で同梱済み)
  - `curl` (Linux Mint 21.3 default で同梱済み)
  - **`jq` は Phase 3-2 では不要** (voice-design.md v2.0 §1.7 で morning-greeting.sh を Phase 4 punt、jq 用途消失)。Phase 4「朝挨拶復活」trigger 達成で morning-greeting.sh を再導入する時点で `sudo apt install jq` を追記

## 手順 (T-1 sprint #1 = B-voice-15 で実弾を走らせる)

1. VOICEVOX engine 公式 releases から **linux-cpu-x64 系 7z (バージョン 0.25.2)** を DL する。配布元は GitHub の VOICEVOX/voicevox_engine リポジトリ releases ページ
   - DL 先: `~/companion/voice/engine/` (`.gitignore` 対象)
   - 0.25.2 は **1 part split archive** (`.7z.001` 1 ファイルのみ、約 1.69 GB、SHA256 は release asset の digest と一致確認可能)。同梱の `.7z.txt` (44 B) は split メタ情報用でファイル名が書かれているだけ (SHA256 ではない)
   - `gh release download 0.25.2 -R VOICEVOX/voicevox_engine -p 'voicevox_engine-linux-cpu-x64-0.25.2.7z*'` でまとめて DL 可能
2. 7z 展開
   ```bash
   cd ~/companion/voice/engine/
   7z x voicevox_engine-linux-cpu-x64-0.25.2.7z.001
   ```
   展開後 **`~/companion/voice/engine/linux-cpu-x64/`** が出来る (公式 7z 内の dir 名は `linux-cpu-x64/`、voice-design.md §1.6 想定の `voicevox_engine_0.25.2/` とは異なる — 実装着手時の systemd unit `WorkingDirectory=` および STATUS.md ディレクトリ構成欄の drift 注記参照)
3. SIGILL / 起動確認 (B-voice-15 AVX1 適合検証)
   ```bash
   cd ~/companion/voice/engine/linux-cpu-x64/
   ./run --host=127.0.0.1 --port=50021 --cpu_num_threads=2 --output_log_utf8 \
     > /tmp/voicevox-stdout.log 2> /tmp/voicevox-stderr.log &
   # 別 terminal で listen 開始まで polling (warm cache なら ~5 秒、cold は実機実測で要計測)
   curl -sS http://127.0.0.1:50021/version
   ```
   - 起動 option 注記:
     - `--use_gpu` は flag (default off で CPU 推論)、`--use_gpu=False` 記法は実 CLI と齟齬で書かない
     - `--speaker=<id>` の起動オプションは **実 CLI に存在しない** (speaker_id は `/audio_query` / `/synthesis` の query param で都度指定する)
     - `--cpu_num_threads=2` は Inspiron 3521 の物理 core 数に合わせる (4 logical は HT 込み、合成では HT 性能逆効果のことがある)
     - `--output_log_utf8` で ログ文字化け回避
   - `/version` が HTTP 200 で body `"0.25.2"` を返せば AVX1 適合 OK (**V-0a pass**)
   - stderr に `INFO voicevox_core::synthesizer: CPUを利用します` が出れば CPU mode 確定
   - SIGILL (Illegal instruction) で落ちた場合は **AVX2 命令を含むビルド** = AVX1 では動かない → voice-design.md §1.1 の user 介入経路 (α docker → γ native build → β AivisSpeech → δ Phase 3-3 先行) へ
4. 短文合成確認 (B-voice-15 完了条件)
   ```bash
   # text= は --data-urlencode で必ず percent-encode する (日本語・記号の取りこぼし防止)
   # -w を併用するときは -o /path/to/file 必須 (redirect > file 併用は -w 出力が body 末尾に混入し JSON parse error を起こす)
   curl -sS -X POST --get \
     --data-urlencode "speaker=2" \
     --data-urlencode "text=おはよう。今日もよろしく" \
     -o /tmp/query.json \
     "http://127.0.0.1:50021/audio_query"
   curl -sS -H "Content-Type: application/json" -X POST -d @/tmp/query.json \
     -o /tmp/out.wav \
     "http://127.0.0.1:50021/synthesis?speaker=2"
   paplay /tmp/out.wav
   ```
   - 発話が聞こえれば B-voice-15 完全 pass
   - 第一声までの秒数は実機実測値が `docs/STATUS.md` の **「実機計測値」section** 参照 (T-1 sprint #1 で warm 合成は短文 6 秒 / 中文 17 秒 / 長文 39 秒 と確定、真の cold start = sudo cache drop 後の合成は T-1 sprint #2 B-voice-1 で別途計測)

## T-1 sprint 完走条件 (v2.0)

voice-design.md v2.0 §2 で V-13 削除 + V-S1/V-S2 追加。`docs/STATUS.md`「実機計測値」section の以下が全 pass で完走:

- T-1 sprint #1 (5/18 大部分 pass、発話確認のみ user 物理確認 pending): V-0a / V-15 / V-2 / V-3 / V-3a
- T-1 sprint #2 (5/18-19 完了): V-1 pass / ~~V-13~~ v2.0 で削除
- v2.0 新規 V-S1 / V-S2 (Phase 3-2 実装着手後): `/say` 実弾発火 + `/status` voice summary

V-5 (BGM 同時再生 + ducking) は Phase 4 punt。

## FAIL 時の user 介入経路 (voice-design.md §1.1)

| 優先 | 経路 | 内容 |
|---|---|---|
| α | docker install 承認 | apt install docker-ce + 公式 Docker image (cpu-latest) で再着手 |
| γ | native build | onnxruntime-builder で `-march=ivybridge` AVX1 ビルドを自前生成 (1-2h) |
| β | 別エンジン切替 | AivisSpeech engine + AivisHub の別キャラ採用 (四国めたんも諦め、user 再合意フェーズ) |
| δ | Phase 3-3 先行 | Phase 3-2 を撤回、Phase 3-3 STT に進む (最終手段) |

CLAUDE.md「失敗時の回復は state 引き or ユーザー介入のいずれか」原則準拠 — chain 自動化 (α 失敗で γ 自動試行 等) はしない。各経路は user 再承認の上で個別 sprint として実施する。
