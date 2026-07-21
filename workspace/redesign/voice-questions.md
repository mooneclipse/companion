# voice/ (Phase 3-2) ユーザー判断待ち事項

> **⚠️ 歴史的文書 (2026-07-21 注記)**: 本文の確定事項はその後の判断で複数上書きされている — キャラは**玄野武宏 id=11 に変更済み** (2026-06-12 persona 軸 2、四国めたんは撤回)、駆動も dashboard 先行から bot 駆動先行 (voice-design.md v2.0) に転換済み。**ここから現行仕様を読み取らない**。現在地の正は `voice/docs/STATUS.md`。

team `companion-voice-design` 議論で残った user 判断項目をまとめる。明日 user 起床後に上から順に確認 → lead が plan v1.0 統合 + plan_approval_request → team cleanup → Phase 3-2 着手承認、の流れ。

最終 user 確定済 (本セッション中):
- キャラ: **四国めたん** (Voidoll 撤回)
- 完了基準: **案 A T2** (voice-greeting.timer 6:30 自動発火完成、ops/ux v2/architect 合流推奨)
- 駆動: dashboard 駆動先行、bot 駆動 (/say slash command) は Phase 4 punt
- 失敗時 (devil R5 採用): 4 段階保険 (朝即時 socket 失敗時のみ / 9:00 ExecStopPost サマリ / 12:00 昼通知 / bot /status)

team 状態: lead が center of truth 正式通達送付済、全 teammate idle 待機中。

---

## Q1. PROJECT.md L17 の事実誤認訂正、いきなり書き換えてよい?

**背景**: 現状 L17 「Dell Inspiron 3521 (2013), Ivy Bridge 2 コア, RAM 8GB, GPU なし相当」だが、bash 直接確認で実機は以下:
- RAM **3.7Gi total** (PROJECT.md 8GB と乖離、約半分)
- Swap 2.0Gi, used 1.1Gi (既に逼迫)
- CPU i3-3217U 1.8GHz / 4 logical (2 物理 HT) — ここは合致
- **AVX1 only** (AVX2 非サポート)
- Storage **HDD ST500LT012** (ROTA=1, 回転 HDD)
- **docker NOT INSTALLED**

これは voice/ 設計だけでなく Phase 4 / 将来着手者にも影響する center of truth 問題。devil から「PROJECT.md L17 事実誤認」として正式指摘あり。

**訂正案**: `Dell Inspiron 3521 (2013), Ivy Bridge 2 コア (i3-3217U / 4 logical / AVX1 only), RAM 3.7Gi total, Swap 2.0Gi, HDD ST500LT012 (ROTA=1), GPU なし, docker 未インストール`

**選択肢**:
- (a) このまま訂正して OK (推奨)
- (b) 文言修正したい
- (c) Phase 1〜2 設計の RAM 8GB 前提が動くので、影響範囲を別途調査してから訂正したい

---

## Q2. Discord 通知音設定確認 (朝即時 socket 通知の寝起き対処要請可否)

**背景**: failure 時の 4 段階保険のうち「朝即時 socket → Discord 通知チャンネル」が、user の寝起き 5:30-9:00 帯で通知音を鳴らすかどうかが UX 判断に影響。失敗時のみ通知 (頻度 3 ヶ月 1-5 件想定) なので通常は鳴らないが、稀に鳴ったときに寝起き介入要請になるか。

**確認事項**: Discord アプリ通知音は朝 5:30-9:00 帯で:
- (a) Off / DND / サイレント運用 → 朝即時通知 採用 OK
- (b) On で常時鳴る運用 → 朝即時通知不採用、9:00 ExecStopPost サマリ + 12:00 昼通知 + bot /status の 3 段階で十分
- (c) 寝室と居間で運用が違う (Discord アプリ位置による)

ux が「朝即時通知 = 寝起き対処要請」を懸念、user 設定次第で「4 段階保険を 3 段階に縮める」判断分岐。

---

## Q3. Discord bot プロフィール「VOICEVOX:四国めたん」記載作業の承認

**背景**: 四国めたん利用規約 (zunko.jp 一次出典、devil 確認済) で「VOICEVOX:四国めたん」クレジット表記必須。配置案:
- voice/README.md 冒頭 + voice/share/credits.md (repo 内、git 管理) — 必須採用
- **bot Discord プロフィール ("About me" 欄)** — architect 提案、Discord 経由応答音声の媒体クレジットを担う

**確認事項**: Phase 3-2 着手時の作業項目に「user が Discord Developer Portal で bot プロフィールに『VOICEVOX:四国めたん を使用』を記載」を含めて OK か?
- (a) 含めて OK (architect 提案)
- (b) repo 内表記のみで十分、Discord プロフィールは触らない
- (c) Phase 4 で persona/ 着手時にまとめて検討

---

## Q4. dashboard footer 追加 (四国めたんクレジット表記) を Phase 4 punt で OK か?

**背景**: 四国めたん規約のクレジット表記は「気になって見にいった際にわかる程度」(東北勢規約準拠) で緩い。dashboard 画面 footer に「VOICEVOX:四国めたん」極小フォント表示は industrial-refined 美学 (制御室の静けさ / 主役の不在) を最小限損ねるが、可能。

architect 提案: Phase 3-2 では voice/README.md + voice/share/credits.md のみ、dashboard footer 追加は Phase 4 まで persona/ 着手時にキャラ確定後に統合実装。

**確認事項**:
- (a) Phase 4 punt で OK (architect 提案、dashboard 美学観察期間 B24-B27 を妨げない)
- (b) Phase 3-2 で dashboard footer にも追加したい (dashboard.service 変更必要、観察期間リセット)

---

## Q5. B-voice-15 (AVX1 適合) Phase 3-2 着手前 T-1 sprint 承認

**背景**: 実機 AVX1 only (AVX2 なし) で VOICEVOX engine が動くか未確認。Phase 3-2 着手前に T-1 sprint として以下を実施:

- (i) VOICEVOX 公式 7z バイナリを Inspiron 3521 で実行
- (ii) SIGILL (AVX2 命令) で落ちないか / `/version` HTTP 200 が返るか / 「おはよう」短文を `/audio_query` + `/synthesis` で合成し wav が返るか
- (iii) 第一声まで何秒か実測 (推定 33-65 秒、HDD cold start で遅い)

**T-1 sprint NG 時の user 介入経路** (chain 撤回、CLAUDE.md「1 回で確定」原則整合):
- (α) docker install 承認 → 公式 Docker image (cpu-latest) で再着手 (apt install + daemon 100-200MB 常駐コスト)
- (β) Voidoll 諦め路線と統合 → AivisSpeech engine + AivisHub の代替キャラ採用 (四国めたんも諦め、別キャラ再選定)
- (γ) ops が onnxruntime-builder で AVX1 ビルドを自前生成 (1-2h、VOICEVOX 維持 + 四国めたん維持)
- (δ) Phase 3-2 を撤回、Phase 3-3 (STT) に進む

**確認事項**:
- T-1 sprint 実施を Phase 3-2 着手承認の前提として OK か? (a) OK / (b) 別段取り提案あり
- T-1 NG 時の優先順位 (α/β/γ/δ): どの順で試すか? lead 推奨は **α (docker) → γ (native build) → β (AivisSpeech 切替)**

---

## Q6. plan v1.0 統合 + voice-design.md 転記の進め方

**背景**: team 議論で多数の改版 (v0.1〜v0.10) が出た。lead が voice-design.md に最終 plan v1.0 + 議論経緯 section (3 視点併記 + self-correction 2 周回ルール) を転記予定。

**転記後の流れ** (確認):
1. lead が voice-design.md 転記完了 → user 確認 (ここで 1 回 break)
2. plan_approval_request → ops/ux/devil approve plan_approval_response → team cleanup
3. user 最終 Phase 3-2 着手承認 → T-1 sprint (B-voice-15) → 実機検証結果次第で Phase 3-2 実装 or 設計引き直し

**確認事項**:
- (a) 上記流れで OK
- (b) voice-design.md 転記前に lead 整理サマリだけ見たい (転記スキップ)
- (c) team cleanup を先に済ませてから voice-design.md 転記したい

---

## 補足: team 進行状況

| teammate | 状態 |
|---|---|
| architect (blue) | **v0.9 plan 確定提出済** (lead 転記取り込み待ち、v0.7/v0.8 R3++ ライン正式撤回 + R3++ 越権の自己批判記録依頼あり) |
| ux (green) | lead 通達済、立場 ack 待機 (ux v2 ライン採用通達)、現状 idle 通知のみ |
| ops (yellow) | **v0.11 plan 確定提出済** (lead 通達差し替え反映、v0.10 revert + v0.8 base 復帰 + 四国めたん差し替え + Q23 (c) 4 段階保険採用 + devil 5 点追加観点 (a)-(e) 全採用 + Voidoll 規約罠 V-1〜V-4 関連全撤回) |
| devil (purple) | **lead 通達 ack 完了、approve plan_approval_response 準備完了** (request_id 受領後即時発火)、追加要望 1 件: D.2「AskUserQuestion 使用は lead に集約 (teammate 独自発火は中間情報として扱う)」を議論経緯 section に追加 |

**ops v0.11 plan 主要構成** (lead 転記時の参照、user 確認後に lead が voice-design.md に統合):
- voice-greeting.timer: `OnCalendar=*-*-* 06:30:00`, `AccuracySec=10s`, `Persistent=true` 不付き
- voice-greeting.service: `After+Requires=dashboard.service`, `Type=oneshot`, `ExecStartPre=xrandr HDMI-1 connected check`, `ExecStart=morning-greeting.sh`, `TimeoutStartSec=120s`
- companion-voice-engine.service (新規): `Type=simple, Restart=no` (Restart=on-failure は CLAUDE.md「対症療法 2 周目」抵触で不採用), `WorkingDirectory=~/companion/voice/runtime`, `ExecStart=voicevox_engine_0.25.2/run --use_gpu=False --host=127.0.0.1 --port=50021 --speaker=2`
- 配布形態: 選択肢 S (公式 7z 自己展開) を B-voice-15 で 1 回確定、FAIL 時 user 介入経路 (α docker / β AivisSpeech / γ native build)
- morning-greeting.sh 8 ステップ: xrandr gate (ExecStartPre) / Open-Meteo fetch / WMO label resolve + テンプレ組立 / mpv IPC ducking 50% / say.sh 呼び出し / ducking 戻し / state 記録 (0600) + 失敗時 socket 通知 / log append (0600)
- 4 段階保険: (1) 朝即時 socket 失敗時のみ / (2) dashboard.service ExecStopPost に dashboard-stop-voice-summary.sh 追加 (lead 例外承認、9:00 サマリ) / (3) maintenance/scripts/notify-system-report.sh 末尾 5 行追加 (12:00 昼通知 3 連続 FAIL トリガマーク) / (4) bot /status 統合
- B-voice チェックリスト: B-voice-1〜19 採用 (Phase 3-2 実機検証、最優先 B-voice-15 AVX1 適合)、B-voice-20/21 Phase 4 punt (bot 駆動関連)
- bot 駆動 voice-on-demand.service: Phase 4 punt、`%i` エスケープ回避設計は voice/docs/STATUS.md「Phase 4 候補」に記録維持
- キャラ: 四国めたん、speaker_id 暫定 2 (architect §F で公式値確認)、Voidoll(CV:丹下桜) 削除、zunko.jp 規約条文 vault ノート化 (V-4)

**architect v0.9 plan 構成** (lead 転記時の参照、user 確認後に lead が voice-design.md に統合):
- §1.1 エンジン: VOICEVOX + AppImage (or ops 選択肢 S 7z)、V-0a で 1 回確定 + 失敗時 user 介入経路
- §1.2 キャラ: 四国めたん、クレジット voice/README.md + share/credits.md + bot プロフィール (Q3 user 確認)
- §1.3 voice/ = 中間 layer、案 A T2 dashboard 駆動 + bot 駆動 Phase 4 punt
- §1.4 say.sh + flock 1 段 + exit code 6 段階 + notify socket + last-result
- §1.5 ディレクトリ: bin/ scripts/ systemd/ engine/ share/ docs/ .state/ .env/、dashboard.service ExecStopPost 1 行追加 (engine stop)
- §1.6 完了基準 3 階層 (土管 / consumer 動作 案 A T2 / 検証)
- §1.7 V-list: Phase 3-2 必須 V-0a/V-1〜V-3/V-3a/V-5/V-13/V-15 (8 項目)、Phase 4 punt V-2b/V-6/V-9/V-12/V-14
- §1.8 R3++ trigger STATUS 設計判断履歴に記録 (Phase 4 再評価可能性 + 3 朝連続失敗で再設計)
- §1.9 落とし穴 D チェックリスト (Voidoll 残置 / R3++ 採用記述残置 / 案 C / 案 D 改 / V-2b/V-14 / flock 1 段 / 内部矛盾)

明日朝、Q1〜Q6 への user 回答を受けて lead が voice-design.md 転記 + plan_approval_request → team cleanup → Phase 3-2 着手承認 の段取り。

**最終更新**: 2026-05-18 (lead session、user 就寝前)
