# companion-maintenance 開発台帳

最終更新: 2026-06-19 (proactive step5 を日次上限 → 週ローリング上限に置換 — 過去 168h で PROACTIVE_WEEKLY_MAX=8、発火 epoch 列を script 側 state proactive_fire_epochs で持ち read-once カウント + handoff 成功時に prune。step7 可変ケイデンスと噛み合わせ波の振幅を週総量で管理。詳細は Done 同日 / 直前 entry = step7 の活性度変調)

## 設計メモ

- Linux 機自身の OS / リソース面倒、および相棒が依存する外部サービス (Claude 稼働状況) を相棒経由で見るための保守スクリプト群
- 定期実行は **systemd user timer**（bot と同じ user セッション文脈で動かし、`$XDG_RUNTIME_DIR/companion-bot.sock` に直接書き込む）
- 通知経路: bot 側の Unix socket listener (`$XDG_RUNTIME_DIR/companion-bot.sock`) に nc / socat で本文を流し込む。bot 本体の責務は土管に閉じる
- timer の発火時刻は OS 側 `apt-daily-upgrade.timer`（朝 6 時前後）の **2〜3 時間後** に揃える方針（unattended-upgrades 完了後のログを安定して拾うため）
- 主要パス:
  - `~/companion/maintenance/scripts/` … 実体スクリプト
  - `~/companion/maintenance/systemd/` … user timer/service 設定（`~/.config/systemd/user/` から symlink で配置）
  - `~/companion/maintenance/.state/` … 二重通知抑止用の state ファイル（git 管理外）
  - ログ: `~/companion/logs/maintenance/` 配下にタスク別 log

## TODO

- machine-audit: マシン全体メンテナンス (計画 = `machine-audit/PLAN.md`)。S1〜S5 + S6-1 + S6-2 完了済み。残は S6-6 延命チューニング
- usb-backup 運用: USB を挿したら `sudo ~/companion/maintenance/scripts/usb-backup.sh` を手動 1 発、**月 1 目安**。**普段 USB は外しておき、daily system-report の滞留 nudge (30 日超) が来たら挿して実行する運用に確定** (2026-06-15、下記 Done 参照)。挿し忘れ検出は実装済み
- RAM 物理増設: **当面見送り (2026-06-11 ユーザー判断)**。古い PC の活用という位置付けで、定常使用 1.3G 程度なら zram で足りる見込み。再考トリガ = (a) daily system-report の swap が zram 導入後も膨らみ続ける、(b) ブラウザ操作等の重いワークロードをこの機に足すと決めたとき。増設する場合の情報は観測済み: JDIMM2 空き・最大 16GB (8GB/枚)・DDR3L-1600 SODIMM (詳細 = `machine-audit/PLAN.md` S6-1)
- machine-audit 四半期再走 (S5 で採用): **次回 2026-09 頃**。全体スキャンからやり直して新 PLAN を作成、現 `machine-audit/PLAN.md` は手順テンプレ + 前回観測との比較基準として参照

※ Obsidian vault 同期は **PROJECT.md Phase 3 に移管**（Web 検索 → md 蓄積と接続するため）。本 repo の管轄になるかは Phase 3 着手時に判断。

## In progress

（なし）

## Review pending

（なし）

## Done

- 2026-06-19 proactive: step5 を日次上限 → 週ローリング上限に置換 (OWNER 確定、直前の可変ケイデンスと噛み合わせ)
  - **動機**: 直前タスクで step7 に活性度連動の確率変調を入れた (乗ってる日↑/静かな日↓) が、step5 の硬い日次上限 `PROACTIVE_DAILY_MAX=2` が天井になり乗ってる日の山を頭打ちにして波の振幅を潰していた。OWNER が方向を「週で総量管理」に確定 (2026-06-19)
  - **方式**: step5 を「過去 168h (7 日) ローリングウィンドウ内の発火回数 < `PROACTIVE_WEEKLY_MAX`」に置換。発火履歴は **script 側 state の `proactive_fire_epochs`** (発火 epoch のカンマ区切り列) で 1 本だけ持ち、判定時に 1 回読んで `now - 168h` 以降の epoch を数える。handoff 成功時に `now_epoch` を 1 つ足し 168h 超を prune してから書き戻す (単調肥大しない)
  - **新 env**: `PROACTIVE_WEEKLY_MAX=8` (調整可)。旧 `PROACTIVE_DAILY_MAX` / `last_proactive_date` / `proactive_count` は廃止 (step5 読み・末尾書き戻しから除去)
  - **カウント源 1 本 (2 周目ルール)**: bot 側 ledger (`proactive_ledger.jsonl`) は読まない。既存設計は「socket handoff 成功 = 1 回消費」で、ledger を読むと handoff カウントと実送信カウントの 2 源混在 = 二重計上 = カウント源の積み増しに当たるため。週ローリングも従来どおり script 側 handoff 履歴 1 本でカウントし state を 1 回引いて確定
  - **依存確認**: `last_proactive_date` / `proactive_count` の他経路依存を grep。bot.py `write_snooze_until` は **総なめ保持** (全キー読み込み → snooze_until のみ上書き → 全行書き戻し) で旧キーに**依存していない** = script が書かなくなれば自然に持ち越されなくなる。test_bot.py の保持テストは「任意キーを保持する」性質テストで旧キーを例に使うだけ → 新キー `proactive_fire_epochs` でも同じ総なめで素通り。bot.py / timer 以外の変更不要 (timer はコメントのみ更新)
  - **bootstrap-safe**: epochs キー無し / 空 / parse 不能 / 旧形式 state (proactive_count のみ残骸) → すべて 0 回扱い (発火可) に正規化 (「state が引けない」を履歴ゼロの 1 状態に倒す、interests.load_interests と同じ思想)。step7 (活性度変調) は一切触らず役割分担を保つ (静かな日を作るのは活性度確率、乗ってる日の連発総量を抑えるのが週上限)。silence 4h (step4) も維持
  - **errexit 安全 (step7 と同じ轍を踏まない)**: カウント側 `|| recent_fire_count=""` → `[[ -z ]]` → 0、handoff prune 側 `|| new_fire_epochs=""` → `[[ -z ]]` → now_epoch のみ記録 (handoff 成功済みの発火を週カウントから漏らさず二重発火を断つ)。両ガードが `set -euo pipefail` 下で python3 rc127 でも貫通することを実測
  - **検証 (実測)**: bash -n OK。隔離 HOME での end-to-end 実機実行 — (i) 168h に 8 件 → step5 skip (state 不変)、(ii) 7 件 → step5 通過、(iii) 古 192h 前 1 件 + 新 7 件 → 古は窓外で count=7 通過、(iv) epochs キー無し (旧 proactive_count のみ) / 空 → 通過、(v) handoff 成功 → state に now epoch 追加 + 192h 前 prune (新 4 件 + now=5 件)・snooze_until / last_dormant_date / dormant_last 非破壊保持・socket に正しい payload 到達・log に weekly_count=5/8。errexit ガードは python3 rc127 で直接実証
- 2026-06-19 proactive: 不在の可変ケイデンス = step7 の固定確率を関心 index 活性度で変調 (persona 軸 4 拡張 (2)、bot repo と対)
  - **動機**: 自発発話が「ほぼ毎日 1〜2 回」の固定ケイデンスで不在感が薄い。数日静か / 乗ってる日の波を作る (persona STATUS 軸 4 拡張、方針 A = 活性度連動・確定済)
  - **方式**: `PROACTIVE_PROBABILITY` を base とし、`bot/sessions/companion_interests.json` の活性度 a∈[0,1] で `P_eff = FLOOR + (CEIL - FLOOR) * a` に変調 (CEIL=base に張る = 上限を越えない)。a は `bot/interests.py` を inline python3 で import し canonical な decay + 新 `activity_score` で算出 (decay を script 側で別解釈にしない、DRY)。interests.py は stdlib のみで system python3 で import 可。判定順 1〜6 不変、変えたのは step7 の確率値の出し方のみ
  - **新 env**: `PROACTIVE_CADENCE_FRESHNESS_DAYS=5` (活性度の新鮮さ窓、bot.py 滲ませ TTL=14 と別概念) / `PROACTIVE_PROBABILITY_FLOOR=0.25` / `PROACTIVE_PROBABILITY_CEIL=$PROACTIVE_PROBABILITY`。FLOOR=base で変調幅 0 = 従来固定に回帰 (戻せる経路)
  - **bootstrap-safe**: index 未生成 / 空 (threads 0 本) → base 維持 (潰すと永久に bootstrap 不能 = 「state 無し」の従来挙動への正規化)。threads ありで全 decay → FLOOR (静かな日)。import / 算出失敗 → base へ正規化
  - **2 周目ルール整合**: 波の生成は read-once index の決定的純関数 (per-tick 乱数は step7 最終ロール 1 個のみ、静寂をランダム生成しない)。確率の数値を場当たりにいじらず算出元を state に逃がした。state file 書き戻しに新キーは足さない (実効確率は毎 tick 算出する派生値)
  - **検証**: bash -n OK、本番 python3 で import 疎通確認 (nonexistent/hot/corrupt index → 0.7/0.7/base)、変調マッピング再現確認。bot 側 activity_score は bot 212 tests で担保
- 2026-06-17 claude-status: Claude サービス稼働状況の変化を #maintenance へ通知 (新規)
  - **動機**: status.claude.com (旧 status.anthropic.com、302 で改称) の障害 / 復旧を手動で見に行かず受動受信したい (OWNER 要望)
  - **方式**: 別 bot を立てず既存 bot の socket 通知インフラに相乗り。`scripts/notify-claude-status.py` (標準ライブラリのみ) を systemd user timer (`companion-claude-status.{service,timer}`、起動 2 分後 + 5 分間隔) で回し、Atlassian Statuspage API `/api/v2/summary.json` を `curl -4` で取得 (この網は IPv6 100% loss のため IPv4 強制)。socket 送信は notify.sh と同等 (AF_UNIX、送信成功後に state 確定)
  - **監視対象**: 実利用分のみ = claude.ai / Claude API / Claude Code (Console / Cowork / Gov は除外)。component status 変化 + 対象に関わる incident の 新規 / 更新 (status・updated_at) / 解決 を diff 検知。`.state/claude-status.json` に前回状態を持ち、初回は通知せず baseline 記録 (初回通知爆発の回避)
  - **重大度**: impact=major/critical の incident、または component の major_outage 悪化があれば本文先頭に bot の CRITICAL_PREFIX を付け通知音 ON (bot.py L205 / L1676、本文は素通し forward で prefix が残る仕様を利用)
  - **2 周目ルール整合**: 取得失敗・socket 不在は state 据え置きで exit 0 (次 tick 再取得、リトライ loop なし)、送信失敗のみ exit 1。条件分岐は state を持つ側 (.state JSON) を 1 回引いて確定
  - **検証**: 構文 + ロジック (回復 / 悪化 / 更新 / 新規 / 解決 / 変化なし) + 送信経路 (テスト socket で [critical] 本文受信・送信成功後 state 更新) + 送信失敗 / socket 不在の state 据え置き、すべて実機テスト済み。COMPANION_BOT_SOCK env で送信先を差し替えテストし本番 #maintenance を汚さず検証。baseline 確立済み (operational×3 + 既存 incident 2 件)
- 2026-06-15 backup-reminder: バックアップ滞留 nudge を daily system-report に追加 (USB 常時挿し運用の廃止)
  - **背景**: ユーザー判断で「USB は普段外す。ある程度の感覚でバックアップを促してほしい。Linux 機 (USB restic) とフォトをそれぞれ、フォトは年 1 でいい」。S6-2 の TODO だった「挿し忘れ検出を daily report に載せるか」を実装で確定
  - **方式**: CronCreate はセッション限定 + 7 日 expire で月 1 / 年 1 に不適 → 既存の durable な `companion-notify-system-report` (systemd timer、毎日 Telegram) に相乗り。`notify-system-report.sh` の `notify_send` 直前に滞留 nudge ブロックを追加
    - Linux 機 = USB restic。`usb-backup.sh` が成功完了時に `.state/last-usb-backup` へ日付を書く (ログは mount チェック前に生成され成否判定に使えないため専用 state)。**30 日超**で nudge。state は 2026-06-12 (S6-2 初回 snapshot) でシード済み → 次回発火は 2026-07-12
    - Googleフォト = Takeout。`photos/raw/Takeout` の mtime (= 最後に Takeout を展開した日) を信号源に流用 (マーカー手動更新不要、再 Takeout で自動リセット)。**365 日超**で nudge。現 mtime 2026-06-13 → 発火は ~2027-06-13
  - **対称設計の注意**: state 空 / 空白のみだと `date -d` が現在時刻 (=0 日) を返し nudge が永久に出ない (バックアップ催促として最悪の過小報告)。`[[ "$usb_raw" == *[0-9]* ]]` で数字を含む時だけ日付扱い。空 / 空白 / garbage は「記録なし」= nudge 発火側へ倒す。全エッジを実機テストで確認
  - code-reviewer: 修正必須なし、軽微 1 件 (空 state 誤判定) を採用し空白のみまで拡張対応
- 2026-06-15 trends-weekly: claude -p のモデルを sonnet-4-6 に明示固定 (W24 budget 超過の恒久対策)
  - **事象**: 2026-06-13(土) の W24 定期実行が失敗、bot のトレンド通知が届かなかった。timer は正常発火・RSS 収集も成功 (total_new=65) したが、`claude -p` が `--model` 未指定で既定モデル **fable-5 ($10/$50 per 1M)** を引き、`--max-budget-usd 1.0` を **$1.08 で超過** (`error_max_budget_usd`)。設計どおり note 未生成・state 未更新・通知未送信で abort。通知だけ落ちたのではなくジョブ失敗の正しい帰結
  - **真因**: 閾値ではなく「`--model` 未指定で既定モデルの変動を丸ごと受ける構造」。`scripts/trends-weekly.sh:121` 付近に `--model claude-sonnet-4-6` を明示追加し、state を持つ側を 1 回引いて確定 (CLAUDE.md 対症療法 2 周目ルール)。budget $1 は据え置き。commit a87e981
  - **実測 (2026-06-15 手動実走で裏取り)**: sonnet-4-6 固定で成功、`total_cost_usd=$0.3519` (sonnet $0.3512 + 内部 haiku $0.0007)。budget $1 の約 35% で余裕あり (code-reviewer 宿題クリア)。所要 ~3.4分、通知送信済み
  - **注意**: trends-weekly.sh は `date +%G-%V` で「現在の ISO 週」のノートを作る。6/15 実行のため生成物は **W25** (`2026-W25 AIトレンド.md`)、**W24 ラベルは欠番のまま**。ただし fetch は seen-urls (W23 で停止) 以降の未取得記事を冪等に拾うため W24 分の記事も W25 に合流済み、内容の取りこぼしはなし
- 2026-06-12 machine-audit S6-2: オフディスクバックアップ 完了
  - **KIOXIA USB 64GB + restic 0.12.1 (apt) + 手動 1 発** (`scripts/usb-backup.sh`、root 実行、FAT32 のまま)。初回実行成功: snapshot `8834995f`、2737 files / 624 MiB、`restic check` エラーなし、`.bashrc` の restore→diff 一致まで実機検証済み
  - パスワードは `~/.config/restic/usb-password` (0600) + ユーザーのオフマシン控え。判断記録の詳細 = `machine-audit/PLAN.md` S6-2
  - code-reviewer: 修正必須なし、軽微 3 件採用 (`forget --group-by host` / ログ miho 所有化 / デバイス名固定表示の除去)
- 2026-06-10 machine-audit S6-1: RAM 逼迫の解消 完了
  - **zram 採用・稼働確認済み**: zram-tools 0.3.3.1 (実 deb 展開で設定形式裏取り)、zstd / PERCENT=50 (1.9G) / prio 100、swapfile 2G は prio -2 overflow に降格して残置。`s6-1-zram.sh` ユーザー実行 全ステップ rc=0、`comp_algorithm` `[zstd]` 選択・swapon 2 段構成を実ログで確認。swappiness 60 据置 (効果観測前の先回りをしない)
  - **物理増設は判断材料収集まで**: dmidecode で JDIMM2 空き・最大 16GB (8GB/枚)・現装着 4GB DDR3L-1600 (Hynix) を観測、購入はユーザー持ち越し (TODO 参照)。**mpv 常駐見直しは見送り** (idle RSS 48M で設計変更コストに見合わず)
  - code-reviewer: 修正必須なし、軽微 1 件採用 (再実行時の `.dist` 原本保護)。詳細 = `machine-audit/PLAN.md` S6-1
- 2026-06-10 machine-audit S5: 定常化 完了 (machine-audit 修正系 S1〜S5 はこれで全完了、残は S6 改善提案群)
  - `scripts/notify-system-report.sh` 拡張のみで実現、**新規 timer なし** (systemd unit 無変更): daily レポートに「apt 滞留: N 件」(常時表示、kept back 検出 = 同じ件数が何日も続いたら疑う傾向監視、apt update は打たず読むだけ) + 「再起動待ち: あり」(`/var/run/reboot-required` 存在時のみ) を追加。swap は既載のため追加なし
  - 実弾テスト OK: skip パス / 本文 6 行生成 (滞留 0 件・温度 47°C) / socket 送信 (bot.log `notify forwarded len=128`) / state 再生成。code-reviewer: 修正必須なし、軽微 1 件採用 (apt 失敗時に滞留 0 件へ無音縮退する点 → 「取得失敗」表示で区別。成否判定 1 回・リトライなしで 2 周目ルール非抵触)
  - 四半期再走を採用 (次回 2026-09 頃、TODO 参照)。詳細 = `machine-audit/PLAN.md` S5
- 2026-06-10 machine-audit S3: ディスク・ログ衛生 完了
  - claude 側 (sudo 不要分): npm キャッシュ 2.8G→60K、claude `-tmp-*` 検証残骸 2 件削除。mozilla 1.1G は smart_size 自動管理 (上限 ~1G) で頭打ちと確認し対応不要で確定、transcript は S6-5 の cleanupPeriodDays 確認済みのため手動削除なし
  - sudo 分は `machine-audit/s3-hygiene.sh` 一括実行 (全ステップ rc=0): journald `SystemMaxUse=200M` (464M→224M、以後上限ローテート)、S2 残務 orphan `libfwupdplugin5` 回収 (autoremove 候補ゼロに)、machine-audit ログ 3 件 chown。事後ルート使用 45G (11%)。詳細 = `machine-audit/PLAN.md` S3
- 2026-06-10 machine-audit S2: 未使用サービス・パッケージ整理 完了
  - sudo 分は `machine-audit/s2-cleanup.sh` 一括実行 (ユーザー側ターミナル、全ステップ rc=0): サービス 8 unit 無効化 (openvpn / rsync / ModemManager / casper-md5check / cups 一式 — failed units 0 に、631 listen 消滅)、`apt autoremove --purge` 2 件、kept back 3 件適用 (fwupd 2.0.20 系、**apt upgradable 空に**)、navidrome 完全撤去 (手動設置と判明、unit + バイナリ 58M + データ + 専用ユーザー直削除)
  - sudo 不要分は claude 側で実行: discord deb 74M・mintupgrade ログ 3 件 (計 1.3M、code-reviewer が残存 2 件を検出し追加削除)、Trash 550M→64K (`gio trash --empty`、`rm -rf` は deny ルールのため)
  - ユーザー判断で残置: `mineroad-analysis/` 132M (「用途不明」ではなく 6/8 更新の MINE ROAD APK 解析で現役)、variety (壁紙チェンジャー現役)。詳細 = `machine-audit/PLAN.md` S2
- 2026-06-10 machine-audit S1: セキュリティ修正 完了
  - 1〜4 (2026-06-10 昼、`machine-audit/s1-security.sh` 一括実行): openssl/libssl3/vim 系 7 件適用、`[::]:5900` は既存 ip6tables DROP でブロック済み確認、navidrome stop+disable (利用実態なし)、openssl 滞留原因 = 公開タイミングで自動経路は健在と確定。HWE 6.8 は見送り 5.15 維持で確定
  - 5 (2026-06-10 夜、ユーザー帰宅後に物理再起動): 復帰点検チェックリスト全項目 pass — kernel 5.15.0-181 反映、reboot-required 消滅、swap 2.0Mi にリセット (pre 1.9Gi)、4533 なし・5900 形状不変、companion 系 4 service + timer 6 本全復帰、failed は casper-md5check のみ (S2 で無効化予定)。詳細 = `machine-audit/PLAN.md` S1 末尾「復帰点検結果」
  - ip6tables もユーザー側確認済み (2026-06-10): `sudo ip6tables -S INPUT | grep 5900` → DROP 残存、netfilter-persistent の boot 後永続化 OK。**S1 残務なしでクローズ**。POST のバッテリー警告は再起動でも従来どおり出た = 無人再起動は現状不可のまま、BIOS 警告スキップ設定の確認は S6-6 #7 に持ち越し
- 2026-06-10 machine-audit S4: claude 設定・スキル・CLAUDE.md 品質レビュー
  - CLAUDE.md 5 枚 / skills 3 / agents 5 / memory 34 エントリ / workspace settings.json を点検。修正 8 ファイル: workspace・companion・bot-workspace の CLAUDE.md (Telegram cold cut 済み実態反映、Repository State、update-config 死参照)、games/CLAUDE.md (実機検証は本番 47825 不使用を明記)、orc SKILL (newgame 棲み分け)、trends-report SKILL (cwd 依存注記 = 2026-06-04 障害の知識をスキル側にも明文化)、game-designer agent (2026-06-03 方向転換反映)、code-reviewer agent (列挙更新)
  - memory は索引・実ファイル一致 + 参照先全現存で削除ゼロ。settings.json は報告のみ (docker/podman 死に allow)。vault/CLAUDE.md は編集禁止のため報告のみ (Windows パス残骸)。詳細 = `machine-audit/PLAN.md` S4
  - code-reviewer: 修正必須なし、軽微 2 件反映 (git 化 (C) リストへの games/ 追記 = companion/CLAUDE.md + workspace/PROJECT.md、trends-report SKILL のスクリプトパス補記)
  - S6-5 (transcript 自動掃除) も同日完了: 公式 docs (code.claude.com/docs/en/settings.md) 裏取りで `cleanupPeriodDays` デフォルト 30 日掃除が既に有効と確認 → **明示設定不要で確定** (詳細 = PLAN.md S6-5)
- 2026-06-04 fix: systemd 経由で skill `/trends-report` が解決されない問題
  - 症状: `systemctl --user start companion-trends.service` で fetch は成功するが claude -p が `{"result":"Unknown command: /trends-report","num_turns":0}` を返し `abort: report.md が空または未生成` で exit 1。手元の `bash` 直接実行 (cwd=maintenance) では成功していた
  - 原因: claude の project skill (`/trends-report` = `maintenance/.claude/skills/trends-report/SKILL.md`) は cwd 依存で解決される。systemd user service は `WorkingDirectory` 未指定で cwd=$HOME になり `$HOME/.claude/skills/` に skill が無く Unknown command になっていた。起動 cwd という state を固定していなかったのが根本
  - 修正 (主+保険の二重化): (主) `systemd/companion-trends.service` に `WorkingDirectory=/home/miho/companion/maintenance` を追加。(保険) `scripts/trends-weekly.sh` の `REPO` を `readlink -f "$0"` 起点でスクリプト実体の親の親に解決し、claude 呼び出しを `( cd "$REPO" && timeout 600 claude -p ... )` のサブシェルで包んで cwd を固定。CONFIG/STATE/WORKDIR/VAULT_DIR/new_items/report は全て絶対パスなので cd しても他のパス解決は壊れない (確認済み)
  - **service 定義 (WorkingDirectory) を変更したため、symlink 配置済みでも `systemctl --user daemon-reload` を要する** (再 enable は不要、daemon-reload のみで反映)
  - 検証 OK: `bash -n` 構文 OK。`cd / && readlink -f` 起点で REPO=maintenance に解決し skill 実体が REPO 配下にあることを確認。`daemon-reload` 後 `systemctl --user show -p WorkingDirectory` で反映を確認。**systemd 経由 (`systemctl --user start`) 1 回で Result=success / exit 0**、ログに前回失敗 (Unknown command, num_turns:0) と今回成功 (cwd=maintenance, num_turns:3, total_new=33) が並んで残り cwd 固定の効果を確認。vault に `2026-W23 AIトレンド.md` 生成 → state 更新 → 通知送信まで完走。コスト実測 $0.34 (Opus)、検証は systemd 1 回にまとめ二重発生なし
- 2026-06-04 AI トレンド週次収集レポート基盤
  - 週 1 回 systemd user timer で起動 → RSS から AI 関連記事を収集 → 重複排除 → `claude -p` で要約 → Obsidian vault に Markdown ノート 1 枚を書く。放置運用前提 (冪等・部分失敗許容・budget bound)。
  - 構成:
    - `config/trends-sources.yaml` … 手編集する収集ソース設定 (keywords / lookback_days=8 / feeds)。シード feed = Zenn AI・Zenn LLM・Qiita 生成AI (filter:false)。企業ブログは 2026-06-04 に `curl -w "%{http_code}"` で 200 確認したもの (OpenAI News `/news/rss.xml`・Google DeepMind・Hugging Face Blog) のみ採用。Anthropic は公開 RSS 未提供 (404) のためコメントで明示、旧 OpenAI Blog `/blog/rss.xml` は 307 でコメント残置。将来 SQLite 等への差し替え点 (`lib/trends_fetch.py` の `load_config`) を冒頭コメントに明記
    - `lib/trends_fetch.py` … RSS2.0 (channel/item) + Atom (feed/entry) を Python stdlib のみ (+pyyaml) でパース (feedparser 不使用)。UA=Mozilla/5.0・timeout 15s。feed 単位 try/except で部分失敗許容 (失敗ソース名を `failed_sources` に載せる)、HTML タグ除去 + 300 字切り詰め、lookback_days 日付フィルタ (パース不能は採用)、filter:true は keyword 一致のみ採用、seen-urls.json で dedup。**state は読むだけで書き換えない** (冪等性は shell が成功後に更新)。Qiita のような非 ASCII パス URL は path/query を percent-encode して取得
    - `.claude/skills/trends-report/SKILL.md` … `new-items.json` を Read → テーマ別クラスタリングで日本語要約 → `report.md` を Write する skill。featured 最大 12〜15 件 + 残りは「他 N 件」、frontmatter `tags:[ai-trends]`/`week`/`created`、`## 今週のまとめ` (俯瞰) + `## 主なトピック` (テーマ別)。Web 取得・長時間処理なし
    - `scripts/trends-weekly.sh` … オーケストレーション (set -euo pipefail)。CLAUDE_BIN 解決 (node バージョン非ハードコード)、ISO 週ラベル `date +%G-W%V`、対象 vault ノート既存なら no-op の冪等ゲート、0 件時は claude を呼ばず shell が最小ノートを直接書く (budget 節約)、1 件以上は `timeout 600 claude -p "/trends-report ..." --output-format json --permission-mode acceptEdits --allowedTools "Read Write Edit" --max-budget-usd 1.0`。rc 判定は 1 回で確定 (失敗時 state 未更新で exit 1 = 冪等、CLAUDE.md 2 周目ルール準拠で stderr 文言マッチ/場当たりリトライをしない)。vault 配置は shell が一元管理 (claude に vault 権限を渡さない = 書き込み境界遵守)。state 更新は成功後のみ + 26 週より古いエントリを prune (一時ファイル + mv で原子的)。Discord 通知は socket 在席時のみ best-effort (不在/送信失敗でも本体は成功扱い)
    - `systemd/companion-trends.service` (oneshot, `After=companion-bot.service`、Wants/Requires なし) + `.timer` (`OnCalendar=Sat 08:00:00`, `Persistent=true`, `RandomizedDelaySec=15min`)
  - 実弾テスト OK: `python3 lib/trends_fetch.py` で実 RSS から total_new=66・failed_sources 空を確認 (Zenn AI 20 / Zenn LLM 15 / Qiita 4 / OpenAI 20 / HF 7。DeepMind は直近 8 日に新着なしで 0)。dedup は seen 投入で 66→36 に減ることを確認。`bash -n` 構文 OK (shellcheck 未インストール)。実機 dry-run でフル経路成功 (fetch → claude -p → vault に `2026-W23 AIトレンド.md` 生成 → state 66 件記録 → 通知送信)。生成ノートは 4 クラスタ + featured 14 件 + 「他 52 件」で書式どおり。再実行は冪等ゲートで no-op (claude 非再呼出)。0 件分岐の最小ノート生成と failed_sources 注記、26 週 prune を単体検証で確認。claude -p 1 回のコストは実測 $0.40 (Opus)、`--max-budget-usd 1.0` で bound
  - **claude -p 消費は Anthropic subscription の usage limit から引かれる** (2026-06-15 予定の `claude -p` / Agent SDK 月次クレジット枠分離は公式に pause、当面サブスク消費前提)。週 1・要約 1 回・`--max-budget-usd 1.0` で 1 回 bound 済みで影響軽微。bot の ledger.jsonl とは別経路で集計は合流しない (将来クレジット枠が確定したら共有プール扱いを再検討)
  - **timer 有効化はユーザー最終承認**。`~/.config/systemd/user/` から symlink 配置 + enable 手順:
    ```
    ln -s ~/companion/maintenance/systemd/companion-trends.service ~/.config/systemd/user/
    ln -s ~/companion/maintenance/systemd/companion-trends.timer   ~/.config/systemd/user/
    systemctl --user daemon-reload
    systemctl --user enable --now companion-trends.timer
    systemctl --user list-timers companion-trends.timer   # 次回発火確認
    ```
- 2026-05-08 `lib/notify.sh` 共通化
  - `lib/notify.sh` を新設し、`log()` / `state_matches` / `notify_send`（socket 存在チェック + `nc -U -N` 送信 + state 更新 + ログ）を抽出。呼び出し側は `STATE_FILE` / `OUR_LOG` を設定して `source "$(dirname "$0")/../lib/notify.sh"` する形式
  - `scripts/notify-unattended-upgrades.sh`（82→61 行）と `scripts/notify-system-report.sh`（62→44 行）を lib 経由に書き換え。タスク固有の本文構築だけが残る形に
  - 実弾テスト OK: skip パス（state あり）と発火パス（state 退避 → system-report 実行で bot.log に `notify forwarded len=117`）両方確認、state 復元後の skip も再確認
  - code-reviewer: 修正必須なし、軽微提案 2 件反映（ライブラリ冒頭で `${STATE_FILE:?...}` / `${OUR_LOG:?...}` ガード、`STATE_DIR` 廃止して `mkdir -p "$(dirname "$STATE_FILE")"` に揃える）。`exit` をライブラリ内で呼ぶ件は YAGNI で据置、systemd の絶対パス前提コメントは実弾テスト済みのため未追加
- 2026-05-07 通知先を OWNER DM → サーバー通知チャンネルへ切り替え（実装は bot 側、`bot/docs/STATUS.md` 2026-05-07 エントリ参照）。maintenance 配下のスクリプト・systemd unit は無変更（socket protocol が変わらないため）。実弾テストで対象チャンネルへの書き込みを確認、bot.log に `notify forwarded len=32`
- 2026-05-06 ディスク・メモリ・CPU 温度の日次レポート
  - `scripts/notify-system-report.sh`: `df -h /`、`free -h`（Mem / Swap）、`sensors`（Package id 0）を集約し、本文を `$XDG_RUNTIME_DIR/companion-bot.sock` に nc -U で流し込む。state ファイル `maintenance/.state/last-notified-system-report` に当日日付を記録し同日 2 回目以降は skip
  - `systemd/companion-notify-system-report.service`（oneshot）+ `.timer`（OnCalendar=*-*-* 12:00:00, RandomizedDelaySec=10min, Persistent=true）。`~/.config/systemd/user/` から symlink で配置、`enable --now` 済み。次回発火: 2026-05-07 12:06:50 JST
  - 実弾テスト OK: 手動 1 回目で bot ログに `notify forwarded len=116`、2 回目で `skip: already notified today (2026-05-06)`。code-reviewer: 修正必須なし、軽微提案 1 件（swap 行欠損時の末尾空行混入）は `free -h` が swap 無効時も `Swap: 0B 0B 0B` を出力するため実機で発生せず、reference 実装と同構造維持のため未反映
- 2026-05-06 git 化完了。GitHub プライベート repo (`mooneclipse/companion-maintenance`) を作成し `main` を push。pre-commit hook (`gitleaks git --pre-commit --staged --redact --no-banner`) を `.git/hooks/` に配置、初回 commit で gitleaks `no leaks found` 確認済み。`.gitignore` で `.env` / `.state/` / `venv/` / `__pycache__/` 等を除外
- 2026-05-06 OS アップデート通知（unattended-upgrades）
  - `scripts/notify-unattended-upgrades.sh`: `/var/log/unattended-upgrades/unattended-upgrades.log` から最新の「自動アップグレードスクリプトを開始します」以降を切り出し、状態（更新対象なし / 更新完了 / エラー / 不明）と再起動要否（`/var/run/reboot-required` 有無 + `.pkgs` 中身）をまとめ、`$XDG_RUNTIME_DIR/companion-bot.sock` に nc -U で流し込む。state ファイル `maintenance/.state/last-notified-unattended-upgrades` で同一実行の二重通知を抑止
  - `systemd/companion-notify-unattended-upgrades.service` (oneshot) + `.timer` (OnCalendar=*-*-* 09:00:00, RandomizedDelaySec=15min, Persistent=true)。`~/.config/systemd/user/` から symlink で配置、`enable --now` 済み。次回発火: 2026-05-07 09:12:50 JST
  - 実弾テスト OK: 手動実行で bot ログに `notify forwarded len=57`、再実行で `skip: already notified`。code-reviewer: 修正必須なし、軽微指摘 4 件（`|| true` 位置 / service の意図コメント / ロケール前提コメント / ERROR 行 1→3 件）すべて反映済み
  - 実弾テストで判明した追加修正: 「状態: 不明」分岐を削除し、結果マーカー（更新対象なし / 更新完了 / ERROR）が揃っていなければ `skip: result not yet logged` で sock 送信も state 更新もしない方針に変更。原因は `apt-daily.timer`（メタデータ取得用、朝以外にも発火）が unattended-upgrades を呼ぶと判定途中でログが「Initial whitelist」止まりのまま結果マーカー未記入となるパターンがあるため。本物の結果は `apt-daily-upgrade.timer`（朝 6 時前後）の実行で記録される

## 既知の問題

（なし）

## 運用ルール

- タスクの実装が一段落したら、Claude（Code）が subagent でレビューを実行する。観点:
  - 正しさ（仕様どおり / 想定外パターンの考慮 / 失敗時の挙動）
  - セキュリティ（webhook URL 等の秘密情報の扱い、権限境界、root 権限が必要なものは sudoers の最小化）
  - 簡潔さ（不要な抽象・過剰な防御コード・コメントの過多）
  - 既存コード慣習との整合（`bot/` で確立したパターンを踏襲）
- レビュー結果は **Review pending** 欄に追記 → 必要な修正を実施 → 該当タスクを **Done** へ移動
- レビュー量が多くなったら `maintenance/docs/reviews/YYYY-MM-DD-<task>.md` に分割
- 1 タスク完了ごとに「最終更新」日付を更新
- AI トレンド: `config/trends-sources.yaml` に企業ブログ等の feed を追加する際は、`trends_fetch.py` を手動実行して `new-items.json` にその source の `url` が取れているか確認する。`parse_rss` は `<link>` を要素テキストで取るため、Atom の `<link href="...">` 形式や名前空間混在フィードでは link を取りこぼし得る (取れていなければ item が dedup 用 URL 無しで落ちる)
