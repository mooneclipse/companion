# マシン全体メンテナンス計画 (machine-audit)

作成: 2026-06-10
スキャン実施: 2026-06-10 10:00 頃 (sudo なし。root 権限が要る確認項目は S1 に「要 sudo」として残してある)
対象: Linux Mint 21.3 / Dell Inspiron 3521 / RAM 3.7G / SSD 457G (使用 12%)

## 運用ルール

- **1 セッション 1 タスク** (PROJECT.md の運用リズムに合わせる)。「続きお願い」で次のセッションが本ファイルの未完了セッションを上から拾う
- 各セッション完了時に本ファイルの該当セクションへ「✅ 完了 (日付) + 結果 1〜3 行」を追記する
- 破壊的操作 (サービス無効化・パッケージ削除・再起動) は **実行前にユーザー確認**。sudo はユーザー側ターミナルで実行してもらう
- 判断に迷う項目は独断せず 1 行で確認する

---

## スキャン結果サマリ (2026-06-10 観測)

### システム
- kernel: 実行中 5.15.0-179 / インストール済み **5.15.0-181** → **再起動待ち** (uptime 18 日)
- `/var/run/reboot-required` 存在 (空ファイル)
- swap **1.8G / 2.0G 消費** (RAM 3.7G、再起動で解消見込み。常駐: claude セッション 384M、mpv idle 197M ほか)
- failed unit: `casper-md5check.service` (Live ISO 検証用、実機では不要) 1 件のみ
- ディスクは余裕 (457G 中 49G 使用)

### セキュリティ
- **openssl / libssl3 の jammy-security 更新が未適用で滞留** (3.0.2-0ubuntu1.23 → 1.25)。vim 系も同様。unattended-upgrades の許可 origin は Linuxmint 系のみで、Ubuntu jammy-security は mintupdate-automation 任せ。mintupdate automation は毎日 00:18 頃動いていて 6/10 も cups/systemd を更新済みだが openssl が残っている → 滞留原因の特定が要る
- **navidrome が `*:4533` で全インターフェース listen** (tailscale 外の LAN にも露出)。`--musicfolder ~/ミュージック`、systemd system service として常駐
- x11vnc が `[::]:5900` (IPv6 wildcard) で listen 中。既知問題 (`-noipv6` が効かない)。`/etc/iptables/rules.v6` は存在し netfilter-persistent も enabled だが、**中身が root 専用で未確認** → ブロックされているか要 sudo 検証
- tailscale 系 (100.123.48.81 の 443/8443/8444/8445/35122) は tailnet 内のみで問題なし
- companion 系 python (47824/47825/47831/47832/47833) は 127.0.0.1 bind で問題なし
- cups 631 は localhost のみ。avahi (5353)・ModemManager・bluetooth は露出小だが利用実態の精査対象

### 未使用候補 (観測根拠つき)
| 対象 | 観測 | 候補アクション |
|---|---|---|
| `openvpn.service` (enabled) | /etc/openvpn に設定ファイルなし | 無効化 |
| `rsync.service` (enabled) | /etc/rsyncd.conf なし (デーモン未設定) | 無効化 (rsync コマンド自体は残る) |
| `ModemManager.service` | ノート PC、モデム利用なしの想定 | 要確認 → 無効化 |
| cups 一式 | プリンタ登録 0 台 | 利用予定の確認のみ (無効化は保留可) |
| `casper-md5check.service` | failed 常連、Live ISO 用 | 無効化 |
| apt autoremove 候補 | gcc-10-base:i386, mint-backgrounds-vanessa | autoremove |
| `~/discord-0.0.16.deb` | インストール済みの deb 残骸 74M | 削除 |
| `~/mintupgrade-2026-05-05T212939.log` | アップグレード完了済み 1.3M | 削除 |
| `~/mineroad-analysis/` 132M | 用途不明 (companion 外) | **ユーザーに要否確認** |
| autostart: variety / x11vnc / xfce-autostart-wm | x11vnc は VNC 用途で現役 | variety (壁紙) の要否のみ確認 |

### ディスク・キャッシュ (緊急性なし、容量は潤沢)
- `~/.npm` 2.8G (npm キャッシュ) → `npm cache clean` で大半回収可
- `~/.cache/mozilla` 1.1G / `~/.local/share/Trash` 550M
- journal 464M → `SystemMaxUse=` で上限設定の余地
- `~/.cache/ms-playwright` 641M は playtester (games) で現役、**消さない**
- `~/.claude/projects` 136M (ほぼ workspace の transcript) + file-history 17M。`-tmp-*` の検証残骸 3 件あり
- nvm は v24.15.0 の 1 本のみ、npm global も claude-code のみで健全

### claude 設定まわり (現状把握)
- CLAUDE.md は 5 枚 446 行 (workspace 180 / companion 共通 92 / games 71 / vault 61 / bot-workspace 42)
- skills 3 つ (trends-report / newgame / orc)、agents 5 つ (workspace 配下)
- user レベル (`~/.claude/`) に skills / agents なし、settings.json 48 行
- memory 28 エントリ (MEMORY.md 索引)

---

## セッション分割

### S1: セキュリティ修正 (最優先、要 sudo 協働)

ユーザーがターミナルに居るタイミングで実施。

1. `sudo cat /etc/iptables/rules.v6` で x11vnc の `[::]:5900` がブロック済みか確認 (memory: ip6tables で塞ぐ運用のはず)。未ブロックなら ip6tables ルール追加 + netfilter-persistent save
2. `sudo ufw status` でファイアウォール全体像を確認 (ufw 併用か iptables 直か)
3. openssl/libssl3 滞留原因の特定: mintupdate の blacklist / レベル設定を確認 → `sudo apt upgrade openssl libssl3` 等で適用。**今後 Ubuntu security 由来が自動で当たる経路があるかを確定させる** (なければ S5 で監視を仕組み化)
4. navidrome の bind 変更: `ND_ADDRESS` を tailscale IP (100.123.48.81) か 127.0.0.1 + tailscale serve に変更 → スマホからの利用経路を確認してから (要ユーザー確認: navidrome を tailnet 外 (家庭内 LAN) から使っているか?)
5. 仕上げに再起動 → kernel 5.15.0-181 で起動、swap リセット、`ss -tlnp` 再確認、companion 系 user service が全員自動復帰するか点検

✅ 1〜4 完了 (2026-06-10、`machine-audit/s1-security.sh` 一括実行、ログ = `~/companion/logs/maintenance/machine-audit-s1-20260610.log`)。

✅ 5 完了 (2026-06-10 夜): ユーザー帰宅後に物理再起動 (POST の「Battery not detected」警告で停止 → F1 押下、**警告は従来どおり出た** = 現状の BIOS 設定では無人再起動・停電復帰は不可のまま。BIOS の警告スキップ設定の有無確認は S6-6 #7 に持ち越し)。復帰点検はチェックリスト全項目 pass (ip6tables のユーザー側確認含む、結果は下記)。**S1 残務なし、クローズ**。

- 1: `[::]:5900` は `rules.v6` の `-A INPUT -p tcp --dport 5900 -j DROP` (5901 も) でブロック済みだった。tailscale0 は ts-input チェーンで先に ACCEPT される構造 = tailnet 内のみ通す意図どおり。追加ルール不要
- 2: ufw は非アクティブ。本機のファイアウォールは iptables 直 + netfilter-persistent で確定
- 3: openssl/libssl3 3.0.2-0ubuntu1.25 + vim 系、計 7 件適用済み。**滞留原因 = 公開タイミング**: mintupdate automation (毎晩 00:18, `mintupdate-cli upgrade --refresh-cache --yes`, blacklist 空・レベル制限なし) は Ubuntu origin の security 更新を適用できている (6/10 未明に jammy-updates の systemd/cups/rsync 23 件適用の実績)。openssl はそのラン後にリポジトリへ出たもの → **自動経路は存在する、S5 での新規監視は「kept back 検出」程度で足りる**。fwupd/libjcat1/libxmlb2 は依存追加が要る kept back (mintupdate でも当たらない) → S2 で扱う
- 4: navidrome は利用実態なし (ユーザー確認済み) のため bind 変更でなく stop + disable。データは `/var/lib/navidrome` 残置、パッケージ削除の要否は S2 で判断
- HWE 6.8 (S6-3) は **5.15 維持で確定** (ユーザー確認済み、常駐サーバ用途で保守的に)

**再起動後の点検チェックリスト (続きセッションが実施)**。再起動前の稼働状態は `~/companion/logs/maintenance/machine-audit-s1-pre-reboot-20260610.txt` にスナップショット済み (user service 一覧 / timer 6 本 / listen ポート / free / failed units)。復帰点検はこれと突き合わせる:

```
uname -r                          # 5.15.0-181 になっている
ls /var/run/reboot-required       # 消えている (ENOENT が正)
free -h                           # swap 使用が 0 近くにリセット
ss -tlnp                          # 4533 なし / 5900 は 100.123.48.81 + [::] のまま (IPv6 は ip6tables 遮断)
systemctl --user list-units --failed   # companion 系 user service が全員復帰
systemctl list-units --failed          # casper-md5check 以外に failed がない (casper は S2 で無効化)
sudo ip6tables -S INPUT | grep 5900    # DROP ルールが boot 後も載っている (要 sudo、ユーザー側で)
```

**復帰点検結果 (2026-06-10 20:03, uptime 19min)**:

- `uname -r` = 5.15.0-181-generic ✅ (pre は -179)
- `/var/run/reboot-required` 消滅 ✅
- swap 使用 2.0Mi (pre 1.9Gi → リセット) ✅
- `ss -tlnp`: 4533 なし、5900 は 100.123.48.81 + [::] で pre と同形 ✅ (pre にあった 127.0.0.1:47831/47832/47833 は一時プロセスで消滅、47824/47825 = remote/games は復帰)
- user failed units 0、companion 系 4 service (bot / games / remote / video-mpv) 全部 running、timer 6 本健在 ✅
- system failed は casper-md5check のみ ✅ (S2 で無効化予定)
- `sudo ip6tables -S INPUT | grep 5900` → `-A INPUT -p tcp -m tcp --dport 5900 -j DROP` 残存 ✅ (2026-06-10 ユーザー実行、netfilter-persistent の boot 後永続化を確認)

### S2: 未使用サービス・パッケージ整理

上の表の通り。1 つずつ「観測根拠 → 無効化提案 → ユーザー確認 → 実行」。まとめて確認してよい。
- `systemctl disable --now openvpn rsync casper-md5check` (+ModemManager は確認後)
- `sudo apt autoremove`
- home 直下の残骸削除 (discord deb / mintupgrade ログ)、`mineroad-analysis` はユーザー判断
- Trash 550M の空にする確認

✅ 完了 (2026-06-10、`machine-audit/s2-cleanup.sh` 一括実行、ログ = `~/companion/logs/maintenance/machine-audit-s2-20260610.log`、全ステップ rc=0):

- サービス無効化 8 unit: openvpn (設定空)・rsync (デーモン未設定)・ModemManager (モデム利用なし、ユーザー確認済み)・casper-md5check (reset-failed も実施、**failed units 0 に**)・cups 一式 4 unit (プリンタ 0 台、ユーザー確認済み。socket/path も止め socket activation 復活を防止)。事後 8 unit 全部 disabled/inactive、631 の listen 消滅
- `apt autoremove --purge` 2 件 (gcc-10-base:i386, mint-backgrounds-vanessa)
- kept back 3 件適用 (fwupd 1.7.9→2.0.20 / libjcat1 / libxmlb2、新規依存 7 件追加)。**apt list --upgradable 空に**
- navidrome 完全撤去: 手動設置 (apt 管理外) と判明したため直削除 — unit + `/usr/local/bin/navidrome` (58M) + `/var/lib/navidrome` + 専用ユーザー。`~/ミュージック` は無傷
- home 残骸 (sudo 不要分は claude 側で実行): discord deb 74M・mintupgrade ログ 3 件 計 1.3M 削除 (当初 1 件と誤認、code-reviewer が残存 2 件を検出)、Trash 550M→64K (`gio trash --empty`)。ルート使用 11%
- 残務 → S3: fwupd 更新 (autoremove の後に実行したため) で旧依存 `libfwupdplugin5` が orphan 化。S3 の掃除で `sudo apt autoremove --purge` を再走して回収
- **残す判断 (ユーザー確認済み)**: `mineroad-analysis/` 132M (スキャン時「用途不明」だったが実際は 6/8 更新の MINE ROAD APK 解析 + 仕様まとめで現役)、variety (壁紙チェンジャーとして現役稼働中)

### S3: ディスク・ログ衛生

- S2 残務: `sudo apt autoremove --purge` 再走 (fwupd 更新で orphan 化した `libfwupdplugin5` の回収)
- `npm cache clean --force` (2.8G 回収)
- journald に `SystemMaxUse=200M` 設定 (要 sudo、/etc/systemd/journald.conf.d/)
- `~/.claude/projects/-tmp-*` 残骸削除、file-history / 古い transcript の保持方針を決める (claude 自体の cleanupPeriodDays 設定を確認してから手動削除はしない)
- mozilla キャッシュは Firefox 側設定で上限確認 (手動削除は一時的効果しかない)
- `~/companion/logs/maintenance/machine-audit-s1-*.log` は root 所有 (sudo 実行で生成)。整理するなら `sudo chown miho:miho` が先に要る

✅ 完了 (2026-06-10、sudo 分 = `machine-audit/s3-hygiene.sh` 一括実行、ログ = `~/companion/logs/maintenance/machine-audit-s3-20260610.log`、全ステップ rc=0):

- sudo 不要分 (claude 側で実行): npm キャッシュ **2.8G→60K**、claude `-tmp-*` 検証残骸はスキャン時 3 件→残 2 件 (1 件は 30 日自動掃除で消滅済み) を削除 (計 64K)
- journald: `/etc/systemd/journald.conf.d/size.conf` に `SystemMaxUse=200M` → restart + vacuum で **464M→224M** (vacuum はアーカイブのみ対象のためアクティブ分が 200M を僅かに超える、以後 200M 上限でローテート)
- S2 残務の orphan (`libfwupdplugin5`) 回収、autoremove 候補ゼロに
- machine-audit ログ s1〜s3 の 3 件を `chown miho:miho` (実行中の s3 ログも glob に入り miho 所有化)
- mozilla 1.1G: `prefs.js` に固定上限なし = **smart_size 自動管理 (上限 ~1G) が機能しており頭打ち、対応不要で確定**
- transcript / file-history (144M+19M): S6-5 で `cleanupPeriodDays` デフォルト 30 日掃除の有効を確認済みのため手動削除なし (方針確定済み)
- 事後: ルート使用 48G→45G (11%)

### S4: claude 設定・スキル・CLAUDE.md 品質レビュー

コードレビューと同じ要領で 1 ファイルずつ。観点:
- **CLAUDE.md**: 上位/下位の重複記述、古くなった記述 (例: workspace CLAUDE.md の「このリポジトリは空」は games 等の実態とずれ)、auto-discovery の階層設計が今も正しいか
- **skills**: frontmatter (description / when-to-use) が発火条件として機能しているか、newgame と orc の棲み分け記述、trends-report の cwd 依存注意書き
- **agents**: 5 つの description が proactive 起動の判断材料として十分か、tool 制限が実態と合っているか
- **settings.json**: workspace の allow/ask/deny 棚卸し。`/fewer-permission-prompts` スキルで transcript 実績ベースの allowlist 提案を出すのが手早い
- **memory**: 28 エントリの鮮度確認。古い参照 (ファイルパス・設定) が現存するか検証し、死んだものは削除

✅ 完了 (2026-06-10):

- 修正 8 ファイル: workspace/CLAUDE.md (Repository State 実態反映・update-config 死参照除去・Discord→Telegram)、companion/CLAUDE.md + bot-workspace/CLAUDE.md (Telegram cold cut 2026-05-28 済みの実態反映、sessions パス topics 化、subordinate 一覧に games 追加)、games/CLAUDE.md (実機検証は本番 47825 不使用・別ポート明記)、orc SKILL (newgame 棲み分け追記)、trends-report SKILL (cwd 依存注記追加)、game-designer agent (2026-06-03 方向転換反映 = Steam 実データ主・旧美学固定を除去)、code-reviewer agent (サブプロジェクト列挙更新)
- 報告のみ: vault/CLAUDE.md の Windows パス残骸 + initial state 記述 (編集禁止のため)、implementer agent の本文 (並列 sub-agent 起動) と tools (Task なし) の食い違い、settings.json の docker/podman 死に allow (未インストール)
- memory 34 エントリ (索引と実ファイル一致) は参照先全て現存、削除ゼロ。settings.json は変更なし (棚卸しのみ)。S6-5 (cleanupPeriodDays) はオーケストレータ側で完了 (S6-5 セクション参照、明示設定不要で確定)
- code-reviewer 点検: 修正必須なし・軽微 2 件反映 (git 化 (C) リストに games/ 追記 = companion/CLAUDE.md + PROJECT.md、trends-report SKILL のスクリプトパス補記)

### S5: 定常化 (このリズムを維持する仕組み)

- S1-3 で見つかった「自動で当たらない更新」の監視を maintenance repo の既存 timer 群に足すか判断 (例: 週次 system-report に「apt 滞留パッケージ数」を含める — 既に companion-notify-system-report があるので拡張で済む可能性大。**新規 timer を増やす前に既存スクリプトを読む**)
- 改善提案 4 (S6 参照) と同じ方向: daily system-report に「再起動待ちか」「セキュリティ更新の滞留数」「swap 使用率」の 3 行を追加する案をここで一緒に判断
- 本 audit を四半期ごとに再走する運用にするか判断 (PLAN.md を再利用)
- 結果を maintenance/docs/STATUS.md に集約

✅ 完了 (2026-06-10):

- 既存 `scripts/notify-system-report.sh` の拡張で実現、**新規 timer なし** (systemd unit 無変更、daemon-reload 不要)。daily レポートに「apt 滞留: N 件」(常時表示、`LC_ALL=C apt list --upgradable` の `[upgradable from:` 行カウント) と「再起動待ち: あり」(`/var/run/reboot-required` 存在時のみ) を追加。swap 使用率は既存行で既載のため追加なし
- kept back 検出の設計: mintupdate automation (毎晩 00:18 refresh) が当てるはずの更新が残留すると滞留数に出続ける → **同じ件数が何日も続いたら kept back を疑う** 傾向監視。apt update は打たない (root 不要、読むだけ)。apt 自体の失敗は「取得失敗」表示で 0 件と区別 (code-reviewer 提案採用、無音縮退の防止)
- 実弾テスト: skip パス / 本文 6 行生成 (滞留 0 件) / socket 送信 (bot.log `notify forwarded len=128`) / state 再生成、全て確認。レビュー後修正分は単体検証 + `bash -n` (socket 経路は無変更)
- **四半期再走: 採用**。次回 2026-09 頃、STATUS.md TODO に記載。再走時は全体スキャンからやり直して新 PLAN を作成し、本 PLAN.md は手順テンプレ + 前回観測との比較基準として参照する (観測スナップショットが古くなるため再利用ではなく新規作成)

### S6: 改善提案 (修正ではなく「もっと良くする」軸。採否の判断は各セッション内で行う)

2026-06-10 の全体スキャンから出た提案 5 件。1 と 2 は独立セッションの価値あり、3〜5 は既存セッションに相乗りできる。

#### S6-1. RAM 逼迫の解消 (zram + 物理増設) — 独立セッション

- 観測: RAM 3.7G、swapfile (ディスク上 2G) を 1.8G 消費、swappiness=60、zram 未使用。常駐の大物は claude セッション 384M / `mpv --idle` 197M (companion-video-mpv) / variety 58M
- 選択肢 (組み合わせ可):
  1. **zram 導入** (圧縮 RAM swap)。低 RAM 機ほど体感が効く。S1 の再起動とセットが効率的
  2. **物理増設**: Inspiron 3521 は DDR3 世代で 8GB まで増設可のはず。空きスロット・現装着の確認に `sudo dmidecode -t memory` (要 sudo)。中古 DDR3 で費用小・効果最大
  3. **常駐見直し**: mpv idle を必要時起動 (socket activation 等) にできれば約 200M 回収。companion-video-mpv の設計変更になるので bot/dashboard 側 STATUS と整合を取ってから

✅ 完了 (2026-06-10、`s6-1-zram.sh` ユーザー実行 全ステップ rc=0):

- **zram 稼働**: `/dev/zram0` = zstd / 1.9G / prio 100 で [SWAP] 化、`comp_algorithm` は `[zstd]` 選択を実ログで確認。swapfile 2G は prio -2 overflow に降格 (撤去せず)、合計 swap 3.9G の 2 段構成。`zramswap.service` enable 済みで再起動後も有効。ログ = `~/companion/logs/maintenance/machine-audit-s6-1-20260610.log`
- **物理増設の判断材料 (dmidecode 観測)**: スロット 2 本、**JDIMM2 空き**。JDIMM1 = 4GB DDR3L SODIMM 1600MT/s (Hynix HMT451S6AFR8A-PB、1.35V)。Physical Memory Array の最大容量 **16GB (8GB/枚)** — 従来想定「8GB まで」より上限が広い。増設するなら DDR3L-1600 (PC3L-12800S) SODIMM を JDIMM2 に 1 枚追加 (4GB で計 8GB / 8GB で計 12GB)。**購入は当面見送り (2026-06-11 ユーザー判断)** — 古い PC の活用という位置付けで定常使用 1.3G なら zram で足りる見込み。再考トリガは STATUS.md TODO 参照 (swap 傾向悪化 or 重いワークロード追加時)
- **効果の確認方法**: daily system-report に swap 既載。zram 導入後の uptime 蓄積で swap 消費がどう変わるか (旧観測: 18 日で 1.8G) を次回チェック時に比較

着手時の判断記録 (2026-06-10):

- **再観測**: S1 再起動後で swap 12.6M / RAM used 1.3G・available 2.0G。スキャン時の swap 1.8G は uptime 18 日の蓄積で、逼迫は緩やかに再発する性質と確認
- **選択肢 1 (zram) = 採用**。根拠: ディスクは回転 HDD (ST500LT012, ROTA=1) で swapfile が遅い / kernel 5.15.0-181 は zram module + CONFIG_CRYPTO_ZSTD=m で対応済み / zram-tools 0.3.3.1 の実 deb を展開して設定形式 (ALGO/PERCENT/PRIORITY、PERCENT 優先) を裏取り済み。設定 = **zstd / PERCENT=50 (~1.85G) / PRIORITY=100**、既存 /swapfile 2G は prio -2 の overflow として残す。swappiness は 60 据置 (zram 前提の引き上げは効果観測後に判断、対症療法の先回りをしない)
- **選択肢 2 (物理増設) = 判断材料収集まで**。`s6-1-zram.sh` [1/4] の `dmidecode -t memory` でスロット数・現装着・最大容量を観測し、購入はユーザー判断 (Inspiron 3521 は DDR3L SODIMM 世代、中古で費用小)
- **選択肢 3 (mpv 常駐見直し) = 見送り**。現在の mpv idle RSS は 48M (スキャン時 197M は再生後の残留とみられる)。companion-video の設計変更コストに回収見込み ~50-150M は見合わない。zram 導入後の swap 傾向で再浮上したら再検討

#### S6-2. オフディスクバックアップの追加 — 独立セッション

- 観測: timeshift は daily で稼働中だが、保存先 UUID = `50b03ae8...` = **ルートと同じ sda2** (同一ディスク内スナップショット、実測 22G)。ディスク故障では timeshift ごと全損する
- 守られているもの: vault は GitHub backup あり (git 化 B 階層)。**裸なのは ミュージック 531M・写真・dotfiles・/etc 設定類**
- 判断事項: 外付け HDD/USB か別マシンか / ツール (restic / borg / 素 rsync) / 頻度。このマシンは vault マスター機なので保険価値は高い

着手時の判断記録 (2026-06-12):

- **媒体 = KIOXIA USB 64GB (ユーザー購入、/dev/sdb1)**。**FAT32 のまま使う (ユーザー判断)** — 他機器に挿す可能性を残す。restic はリポジトリ内にパーミッション・symlink・所有者を保持するため FAT32 の制約 (POSIX メタデータなし) を吸収できる。pack ファイルは数十 MB で 4GB 上限にも届かない
- **ツール = restic (apt 0.12.1-2ubuntu0.3、ユーザー選択)**。採用理由: デフォルト暗号化 (USB は紛失し得る媒体、/etc・dotfiles に Wi-Fi PSK 等の秘密が乗る) + スナップショット世代管理 + `restic check` の整合性検査
- **頻度 = 手動 (ユーザー選択)**。USB を挿したら `sudo ~/companion/maintenance/scripts/usb-backup.sh` を 1 発。対象データの変化が緩やか (音楽・dotfiles・/etc) なので月 1 目安
- **対象**: `~/ミュージック` (531M) / `~/music` / `~/bin` / `~/.config` (discord 295M 除外) / `~/.bashrc` / `~/.profile` / `~/.claude` (projects・file-history・cache・paste-cache 除外、memory/sounds/hooks/settings は含む) / `/etc` (31M、全量読みのため root 実行)。写真は実測ほぼ無し (ピクチャ 4K) のため対象パスに固有エントリなし
- **保持 = `forget --group-by host --keep-last 12 --prune`**。`--group-by host` は対象パス変更時に旧パス組の世代が永久残置されるのを防ぐ (code-reviewer 指摘採用)。restic 0.12.1 の `--group-by` 存在は公式 docs (restic.readthedocs.io v0.12.1) で裏取り済み
- **パスワード = `~/.config/restic/usb-password` (0600) + ユーザーのオフマシン控えの 2 箇所保持**。ディスク全損 + USB だけ残るケースで控えがないと復元不能になるため、オフマシン控えは必須運用

✅ 完了 (2026-06-12、初回実行ログ = `~/companion/logs/maintenance/usb-backup-20260612.log`):

- 初回バックアップ成功: snapshot `8834995f`、2737 files / 624 MiB、init→backup→forget→check 全工程エラーなし
- 復元検証済み: `restic restore --include ~/.bashrc` → 原本と diff 一致
- 運用は STATUS.md TODO 参照 (月 1 目安の手動、挿し忘れ検出の system-report 連携は運用後判断)

#### S6-3. HWE カーネル 6.8 への乗り換え — S1 の再起動ついでに判断

- 観測: 現行 GA 5.15 系。`linux-generic-hwe-22.04` (6.8.0-124) が候補に出ている
- 性能・電力管理の改善はあるが、常駐サーバ的運用なので保守的に 5.15 維持も合理的。**急がない。S1 再起動時に一緒に判断**

#### S6-4. daily system-report の拡張 — S5 に統合済み (上記参照)

#### S6-5. claude transcript の自動掃除 — S4 に相乗り

- 観測: `~/.claude/projects` 136M (ほぼ workspace) + file-history 17M
- 手動削除でなく settings.json の `cleanupPeriodDays` で保持期間を決めて自動化する方向。**設定名と現行デフォルトは S4 で公式ドキュメントを裏取りしてから** 設定する

✅ 完了 (2026-06-10、公式 docs 裏取り = code.claude.com/docs/en/settings.md):

- `cleanupPeriodDays` は現存、**デフォルト 30 日が既に有効** (起動時に 30 日超のセッション transcript + 孤立 subagent worktree を自動削除、最小 1、0 は validation error)。file-history / memory ディレクトリは掃除対象として記載なし
- **判断: 明示設定しない**。デフォルト掃除が既に回っており、136M はディスク 457G の 0.03% で逼迫根拠なし。短縮は `--resume` 可能期間を削るデメリットのみで利得がない。デフォルト同値の明示設定は設定ノイズになるため不採用
- file-history 17M は今回据置 (掃除対象の公式記載なし、手動削除は S3 の保持方針判断に委ねる)

#### S6-6. ノート PC 延命チューニング (省電力・発熱) — 独立セッション

- 前提 (2026-06-10 ユーザー確認): **バッテリーは寿命で取り外し済み、AC 直結のみで稼働**。よって充電上限設定は対象外。論点は待機電力・発熱・電源断耐性の 3 つ
- 作業項目:
  1. **現状計測を先に**: `powertop` で待機消費の内訳、`sensors` でアイドル時の平熱を記録 (daily system-report に CPU 温度が既に載っているので過去分から夏前ベースラインを把握)。チューニング前後の差が言えるようにする
  2. **省電力適用**: `powertop --auto-tune` を一括では当てず、項目ごとに副作用を見ながら適用 (常駐サーバなので USB autosuspend が x11vnc・外付け機器に悪さしないか個別確認)。恒久化は TLP か手書き udev/sysfs のどちらか一方に寄せる (二重管理しない)
  3. **CPU governor 確認**: 常駐負荷は低い (load average 0.2〜0.5) ので powersave/schedutil で十分かを確認
  4. **ディスプレイ消灯**: dashboard 表示時間帯以外の DPMS 消灯設定を確認 (TV 接続運用との両立)
  5. **物理メンテ**: 筐体の埃清掃 (2013 年世代、ファン・ヒートシンク)。夏前推奨
  6. **電源断耐性の確認**: バッテリーなし = UPS なしで停電即落ち。fs は ext4 journaling で基本耐えるが、突然死に弱い書き込み (SQLite を持つ常駐サービス等) がないか一巡確認し、S6-2 (オフディスクバックアップ) の優先度根拠に加える
  7. **BIOS の無人起動設定** (2026-06-10 追加、S1-5 で判明): バッテリー未検出警告で POST が停止し F1 物理押下が要る = リモート再起動・停電復帰が不可。BIOS に警告スキップ (Dell「Warnings and Errors」→ Continue 系) と AC Recovery (通電で自動起動) があれば両方有効化したい。確認・変更は物理操作時。**2026-06-10 S1-5 の再起動でも警告は従来どおり出た** (BIOS 設定は未変更のまま)。次回 BIOS に入る機会に設定の有無を確認する

---

## 進捗

- [x] S1 セキュリティ修正 — 完了 (2026-06-10)。再起動 + 復帰点検 pass、ip6tables DROP の boot 後残存もユーザー確認済み (結果は S1 セクション末尾)。残務なし
- [x] S2 未使用サービス・パッケージ整理 — 完了 (2026-06-10)。8 unit 無効化 / autoremove / kept back 適用 / navidrome 撤去 / home 残骸 + Trash 掃除。mineroad-analysis と variety は残す (結果は S2 セクション)
- [x] S3 ディスク・ログ衛生 — 完了 (2026-06-10)。npm 2.8G 回収 / journald 200M 上限 / orphan 回収 / ログ chown / mozilla は smart_size 自動管理で対応不要 (結果は S3 セクション)
- [x] S4 claude 設定・スキル・CLAUDE.md 品質レビュー — 完了 (2026-06-10)。S6-5 (transcript 自動掃除) も同日完了 — デフォルト 30 日掃除が有効と裏取り、明示設定不要で確定
- [x] S5 定常化 (+S6-4 system-report 拡張) — 完了 (2026-06-10)。system-report に apt 滞留 + 再起動待ちを追加 (新規 timer なし)、四半期再走を採用 (次回 2026-09 頃)
- [x] S6-1 RAM 逼迫解消 — 完了 (2026-06-10)。zram 採用 (zstd / 1.9G / prio 100) 稼働確認済み、JDIMM2 空き + 最大 16GB を観測 (増設購入はユーザー持ち越し)、mpv 常駐見直しは見送り (結果は S6-1 セクション)
- [ ] S6-2 オフディスクバックアップ追加
- [ ] S6-6 ノート PC 延命チューニング (省電力・発熱、バッテリーレス AC 直結前提)
