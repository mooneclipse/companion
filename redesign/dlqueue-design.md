# dlqueue-design.md (companion-remote RV-10 事前ダウンロードキュー F-dl 設計)

version: **v1.1 (確定版)** — RV-10 着手時の「軽い設計ラウンド 1 回」(remote STATUS.md 2026-06-12 ロードマップ) の成果物。video-design.md v1.0 の拡張。v1.0 ドラフトに devil レビュー 1 回 (subagent、指摘 17 件 = 致命 1 / 要修正 7 / 軽微 9 ほか確認済 4) を反映して確定。
作成: 2026-06-12
host: companion-remote (remote-design.md v1.0 / video-design.md v1.0)

---

## 0. 目的と非目的

### 目的
外出先から URL をキュー投入 → 自宅機で yt-dlp が 720p 上限でローカル保存 → 帰宅後 PWA の「DL 済みリスト」からローカル即再生。yt-dlp 解決 40〜70s (video-design §2、ネットワーク律速で短縮不可) がローカル再生では消える = **待ち時間短縮の本命**。副次効果: ニコニコは yt-dlp 直 DL なら cookies を yt-dlp 自身が処理するため **RV-9 (mpv ytdl_hook の cookies 未対応 → HLS 403) を迂回**できる見込み → 本機能完了後に RV-9 要否を再判定 (ゆえにニコニコ実 DL スモークは必須、§7)。

### 非目的
- Telegram bot からの投入 (bot.py 改変 = v1-β 系列は Phase 4 後ろ倒し方針。PWA は tailscale serve で外出先からも届くため「外出先から投入」要件は PWA で充足)
- DL 中ジョブのキャンセル (subprocess kill 機構。v1 は完了/失敗を待つ。queued の取り消しは削除で可能)
- 自動リトライ / 自動掃除 (古い順 evict)。失敗・容量超過の回復はすべて user 操作
- プレイリスト一括 DL (`--no-playlist` 維持)、画質選択 UI、DL 進捗パーセント表示 (v1 は queued/downloading/done/failed の 4 状態のみ)
- 再生中の DL 抑止 (再生検知→DL 停止のような cross-control 条件分岐は 2 周目の温床。帯域競合は §2.4 で受容を 1 回確定)

---

## 1. アーキテクチャ

### 1.1 構成 = server 内 worker thread 1 本 + flock state (新 unit なし)

```
PWA --POST /api/dl--> app.py --enqueue--> .state/dlqueue.json (flock, tickets.py 同型)
                                              |
                          dlqueue.py worker thread (daemon, 単一) が queued を 1 件ずつ
                          yt-dlp subprocess (env 隔離) で .state/downloads/ へ保存
                                              |
                          完了/失敗 → state 確定 (flock 下) → flock 解放後に
                          companion-bot.sock へ通知 1 ショット (timeout 付き、失敗握りつぶし)
PWA --POST /api/video/play_local {id}--> id を state から引き path 構築 --> video.play(path)
```

- **worker = app.py 内 daemon thread を採用**。比較:
  - (A) server 内 worker thread ← **採用**
  - (B) 別 systemd unit が queue を監視 (プロセス分離)
  - (C) systemd timer / path unit
  - (B)(C) の利点は「server restart と DL の独立」だが、restart は user 操作のみで稀。中断の損失は「再投入 1 タップ」で許容範囲。unit +1 の運用負荷・queue 監視のポーリング/IPC 複雑化の方が高くつく (YAGNI)。
- **単一 worker = 単一 DL lane**。HDD/AVX1/2.4GHz Wi-Fi 帯域での多重 DL 自己 DoS を構造で防ぐ (mpv 単一 lane = video-design §3.2 と同型)。多重投入はキューに積まれて順次処理。
- worker の待機は `threading.Event` (enqueue で set)。ポーリングループにしない。**worker 起動直後に Event を 1 回 set** し、restart 前から残っている queued を次の投入を待たずに drain する (devil 要修正)。
- **worker 生存規律 (devil 要修正)**: 項目単位の処理全体を broad try/except で包み、未捕捉例外は当該項目を failed (error="internal error") に 1 回確定してループ継続。単一 daemon thread は systemd の監視外 (プロセスは生きたままスレッドだけ死ぬと enqueue 200 + 永久 queued の無音破綻になる) ため、ループを死なせないことが生存の唯一の砦。
- **server stateless 原則 (video-design §1) との関係**: F-video の「再生 state は mpv 所有」は不変。DL キューは本質的に永続 state が必要な別機能で、tickets.json と同じ「.state JSON + flock」パターンに収める (state を持つ側を 1 箇所に確定)。

### 1.2 起動シーケンスと restart 中断の扱い

**順序固定 (devil 要修正)**: `ThreadingHTTPServer の bind 成功 (= 単一インスタンス保証) → recovery → worker thread 開始`。bind 前に recovery を走らせると、手動起動した 2 つ目のプロセス (デバッグ・スモークで現実に起きる) が稼働中サーバの DL 中項目を failed 化 + .part 削除してから bind 失敗で死ぬ、という不整合経路が開く。

**recovery (起動時 1 回、flock 下)**: `downloading` のまま残った項目を **`failed` (error="interrupted by restart") に確定**する。
- 「中断された」は state (downloading 残存 + bind 直後 = worker 未開始) から 1 回で確定できる事実。queued へ自動で戻す = 自動リトライの匂いがするため採らない。回復は PWA の「再試行」(= 同 URL の新規 enqueue) で user 介入 ← `~/companion/CLAUDE.md`「失敗時の回復は state 引き or ユーザー介入のいずれか」準拠。
- **failed 確定時のファイル掃除は経路を問わず一般規則 (devil 要修正)**: restart 中断・rc≠0・timeout・内部例外のいずれでも、該当 id の `dl-<id>.*` (`.part`・中間 `dl-<id>.f137.mp4` 等を含む) を削除する。容量実測 (§3.3) に「UI から見えないゴミ」を算入させない。

### 1.3 state スキーマ (.state/dlqueue.json + .state/dlqueue.lock)

```json
{"next_id": 1, "items": [
  {"id": 1, "url": "<normalize 済み URL>", "title": null, "status": "queued",
   "file": null, "size": null, "error": null, "created": 0, "updated": 0}
]}
```
- status: `queued → downloading → done | failed`。遷移はすべて flock 下の read-modify-write (tickets.py `_locked()` + `_load()` + `_save()` 同型、0o600)。
- **lock fd は取得のたびに毎回 open する (tickets.py 同型) — 契約**。fd をキャッシュする「最適化」をすると同一 open file description 上の flock は再入可能になり、worker thread と HTTP handler thread の排他が無音で消える (devil 確認済み事項の実装注意)。
- **_save は atomic write (`os.replace`)** — tickets.py の O_TRUNC 直書きからの意図的逸脱。kill タイミングで JSON が壊れると _load の空復元により downloads/ の実体 (重い・再取得に数十分かかる) が state から消えて UI から削除不能になる。devil 対案の「起動時に state に無い dl-* を削除する reconcile」は、state 破損 → **実体全削除**という逆向きのより大きい事故を生むため不採用とし、破損自体を atomic write で塞ぐ。
- `file` は **basename のみ** 保存 (`dl-<id>.<ext>`)。ディレクトリは server 側定数。state ファイルを手で書き換えても任意 path 再生にならない (§3.2)。
- `title` は DL 成功後に yt-dlp stdout から確定 (§2.2)。**制御文字 strip + 200 字 cap のサニタイズを通す** (外部サイトが内容を制御する唯一の文字列が state・Telegram 通知へ流れる面。devil 軽微)。失敗時/取得不能時は null のまま (UI・通知は URL 表示で代替)。
- `error` は表面化専用 (stderr 末尾 ~200 字)。**この値で分岐・リトライしない** (エラー分類 enum 禁止ルール準拠)。yt-dlp stderr には downloads の絶対パスや fragment URL が乗り得るが、Bearer 必須・単一ユーザの閲覧面につき容認する (remote ガードレール (v) generic エラー方針との衝突は承知の上の例外。devil 軽微への一筆)。

---

## 2. yt-dlp 直叩き (env 隔離・churn 整合)

### 2.1 既存規律の継承 (video-design §4.2 / §8)

| 項目 | 内容 |
|---|---|
| 実体 | `/home/miho/bin/yt-dlp` 固定 (mpv unit と同一実体・同一版 2026.03.17。env `REMOTE_YTDLP` で上書き可 = テスト用) |
| env 隔離 | voice.py 同型: `HOME`/`PATH` のみ透過、PATH 既定 `/home/miho/bin:/usr/bin:/bin`。PROXY 系・user shell env 非継承 |
| 設定無視 | argv に `--ignore-config --no-playlist` 明示 (mpv 経由の `--ytdl-raw-options` と同等を直叩きでも保証) |
| format | `bestvideo[height<=?720]+bestaudio/best[height<=?720]/best` (mpv unit と同一文字列。720p 上限の根拠も同一 = AVX1+HDD 自己 DoS 回避) |
| **ffmpeg 前提** | `bestvideo+bestaudio` の merge は **ffmpeg バイナリ必須** (実機 /usr/bin/ffmpeg 4.4.2 存在確認済)。streaming 経路には無かった新規 load-bearing 依存 (devil 軽微)。不在 OS へ移植時は再評価 (video-design §3.5 i965-va-driver と同列の「前提」) |
| 自動更新 | `-U` 禁止。known-good ペア台帳 (remote STATUS.md) に「DL 経路でも同一 yt-dlp」を記録。破綻シグナル「全 DL failed」→ reactive 手動差替 (§8 と同一運用) |
| timeout | 1 件 3600s (backstop。超過は failed 1 回確定、リトライなし)。**`start_new_session=True` で起動し timeout/失敗時は `os.killpg` でプロセスグループごと kill** — subprocess.run の timeout は直接の子しか殺さず、merge 中の ffmpeg (yt-dlp の子) が孤児化して CPU/IO を食い続ける穴を塞ぐ (devil 要修正) |
| 判定 | rc==0 のみ成功。stderr パース分岐なし (末尾を error に**記録するだけ**) |

### 2.2 argv (固定テンプレート、URL は normalize 済みのみ)

```
yt-dlp --ignore-config --no-playlist --no-progress -4
       -f "bestvideo[height<=?720]+bestaudio/best[height<=?720]/best"
       -o "<downloads_dir>/dl-<id>.%(ext)s"
       --print after_move:title --no-simulate
       <url>
```
- **`-4` (IPv4 強制、v1.2 で追加)**: この網は IPv6 が 100% loss (RV-8 実測) なのに CDN (delivery.domand.nicovideo.jp = CloudFront 等) が AAAA を返すため、fragment ごとの IPv6 connect timeout (~40s) → IPv4 fallback で実測 2.5KB/s に落ち、長尺が timeout 3600s を超えて failed になっていた (v1.0 実弾の sm9 1135s も同根)。`-4` で 3.35MiB/s (約 90 倍)、失敗していた実 URL (258MB) が 99s で完走 (2026-06-12 実測)。**cookies (ログイン) は速度に無関係** — cookies あり/なしで同速を実測しており、`--cookies-from-browser` は不採用 (ブラウザ cookie 全体を DL のたびに読む結合 + YouTube への cookie 付与はアカウントリスク。ログイン必須動画のニーズが出たらニコニコ限定の cookies 渡しを 1 回設計する)。
- **filepath の確定は stdout に依存しない (devil 要修正)**: rc==0 の後に FS glob `dl-<id>.*` (`.part` 除外) を 1 回引いて確定する (state を持つ側 = FS で確定)。ヒット 0 件 (出力スキップ等) や複数件 (merge 残骸) は failed に 1 回確定。`--print after_move:` の stdout は **title 取得専用に降格** — 空/複数行/改行入り title でも、strip + サニタイズ (§1.3) して 1 行目を使い、取れなければ null (failed にはしない。title は表示用であり成否の真実は rc + FS)。
- 出力ファイル名は **server 採番 id ベース** (`dl-<id>.<ext>`)。タイトル由来のファイル名は使わない (path 長/特殊文字面を開かない)。ext は glob 結果から確定して state に保存。
- merge コンテナは yt-dlp 既定に任せる (mp4/mkv/webm いずれも mpv ローカル再生可。`--merge-output-format` で縛らない = オプションを盛らない)。

### 2.3 allowlist (門は 1 つ) + dedup

- `POST /api/dl` の入口で **urlguard.normalize を必須通過** (F-video play と同一の門、video-design §4.1)。弾けば 400。queue には normalize 済み URL しか入らないため、worker は検証を再実装しない (門を 2 重化して drift させない)。
- **dedup (devil 軽微)**: enqueue 時、同一 normalize 済み URL の `queued`/`downloading` 項目が既にあればそれを返す (新規採番しない。再試行二度押し・二重 DL・二重通知を防ぐ。state を 1 回引くだけで分岐の積み増しではない)。`done`/`failed` との重複は許容 (意図的な再 DL があり得る)。

### 2.4 帯域競合の受容 (devil 要修正への裁定)

Wi-Fi 2.4GHz は RV-8 で fetch 律速 underrun が実測済みの限界回線であり、mpv 再生中に worker が DL を始めると Live の 5 秒周期 stall を悪化させ得る。対応の選択肢は (i) 受容 / (ii) 固定 `--limit-rate` / (iii) 再生検知→DL 抑止。**裁定 = (i) 受容**。理由: 主ユースケース「外出中に DL、帰宅後に視聴」では時間帯が重ならない / (iii) は cross-control 条件分岐で 2 周目の温床 / (ii) は観測前に推測で数値を入れることになる (DL を遅くする副作用は「帰宅前に終わらせたい」目的と逆行)。**実運用で視聴中 stall 悪化が観測されたら、その時に `--limit-rate` を 1 回だけ確定して入れる** (観測 → 1 回確定の順序を崩さない)。本裁定を台帳に記録して 1 回で決める。

---

## 3. 保存先・容量・削除

### 3.1 保存先 = `.state/downloads/` (0o700)

- `.state/` 配下で統一 (state と実体が同居、git 外・バックアップ対象外が既に保証されている)。ディレクトリは初期化時に mode=0o700 で作成。
- **downloads_dir は初期化時に `os.path.realpath` で 1 回確定** (vault.py `VAULT_ROOT` と同じ前例。`server/../.state` の非正規形のまま commonpath すると字句比較で全件 reject = fail-closed 側だが機能不全になる。devil 軽微)。
- ファイルは UMask 由来で 0o600 系 (owner のみ)。

### 3.2 ローカル path 再生の境界 (任意 path 再生にしない — 絶対死守)

`POST /api/video/play_local {id}`:
1. **HTTP から path を一切受けない**。受けるのは int id のみ。
2. flock 下で state を引き、`status=="done"` の項目の `file` (basename) を取得。該当なし/未完了は 404。
3. `file` に `os.sep`・`..`・絶対 path が混じる state 改竄は reject → `os.path.realpath(join(downloads_dir, file))` を取り `os.path.commonpath` で downloads_dir 境界内を確認 (vault.py `_resolve_in_vault` と同じ判定。symlink 差し替えへの防御層)。
4. ファイル実在を確認 (消えていれば 404) → `video.play(<abs path>)` (loadfile replace。**verb whitelist 無改変**、mpv はローカル絶対 path を ytdl_hook 非経由で直再生 = RV-9 の cookie 問題を構造ごと迂回)。

### 3.3 容量上限 = 20 GiB の二重ガード (自動掃除なし)

- **enqueue 時ガード**: flock 下で downloads/ の実ファイル合計サイズを実測し、20 GiB 以上なら新規投入を **507 Insufficient Storage で拒否** (掃除してから入れ直す)。
- **worker 着手直前ガード (devil 致命への対応)**: enqueue 時ガードだけでは「19 GiB 時に N 件連続投入 → 全件通過 → 順次 DL で際限なく積み上げ」が成立する (ガードが「すでに落としたバイト」しか縛らない)。worker が各項目の DL 着手直前に同じ実測を 1 回引き、≥20 GiB なら当該項目を **failed (error="over capacity") に 1 回確定**して次へ。これで超過は最大 1 本分 (DL 中の 1 件) に正しく束縛される。未知の動画サイズの推定値は持ち込まない (両ガードとも実測のみ)。
- **自動掃除 (古い順 evict) は不採用**: 観る前に黙って消えるのは不意打ちで、evict ポリシーは数値いじり・条件追加の温床。掃除は PWA の削除ボタン (user 操作) のみ。
- `POST /api/dl/delete {id}`: `done`/`failed`/`queued` を削除可 (エントリ + `dl-<id>.*` 実ファイル)。`downloading` は 409 (worker と競合させない。v1 はキャンセル機構を持たない)。queued の削除 = 投入取り消し。worker の取り出し (queued→downloading 遷移) と削除は同じ flock で直列化されるため競合しない。
- 上限値 20 GiB は 1 回確定 (720p ≒ 1〜2 GiB/h で 10 本超は溜められる、HDD 389G 空きに対し保守的)。変更は user 判断で 1 回だけ動かす (刻まない)。

---

## 4. API (全て Bearer 必須)

| endpoint | 動作 | エラー写像 |
|---|---|---|
| `POST /api/dl {url}` | normalize → dedup → enqueue → 200 (項目 dict) | 400 url rejected / 507 容量上限 |
| `GET /api/dl` | 全項目 (created 降順) + 使用量 `{items, usage_bytes, limit_bytes}` | — |
| `POST /api/dl/delete {id}` | エントリ + ファイル削除 | 400 id 不正 / 404 該当なし / 409 downloading |
| `POST /api/video/play_local {id}` | §3.2 → video.play | 400 / 404 / 503 / 502 (既存 _video_result 写像) |

- ルートは app.py ROUTES に明示追加 (既存流儀)。POST body は既存 `_read_json` / cap 64KB 内。
- 404/409/507 の切り分けはすべて state を引いた構造で確定 (文言マッチなし)。

## 5. 通知 (Telegram、bot.py 無改変)

- DL 完了/失敗時に worker が `$XDG_RUNTIME_DIR/companion-bot.sock` (bot 既存 notify socket) へ平文 1 ショット送信 (say.sh `notify_socket()` と同型を Python で)。
  - 例: `[dl] 完了: <title>` / title=null 時は `[dl] 完了: <url 先頭 80 字>` / `[dl] 失敗: <url 先頭 80 字>` (文面は title null でも崩れない形に確定。devil 軽微)
- **実行位置の契約 (devil 要修正)**: `state 確定 (flock 下) → flock 解放 → settimeout 付き送信 (失敗握りつぶし)` の順序を固定。flock 保持のまま socket 送信すると、bot socket が「存在するが応答しない」状態で全 /api/dl endpoint + worker がハングする (say.sh の `nc -U -N` timeout なしの前例を Python 移植で踏まない)。
- socket 不在/送信失敗は**握りつぶし** (リトライなし。通知はベストエフォート、状態の真実は PWA の DL リスト)。bot.py は受信側無改変。`[dl] ` prefix が先頭に付くため bot 側 startswith 判定 (`[[proactive-v1]]` / `[critical]`) への注入は成立しない (devil 検証済み)。

## 6. PWA

- **video 画面内に「事前DL」折りたたみセクション同居** (todo-history と同型の判断: 主要動線は既存の即時再生、DL リストは従。別タイルにしない)。
- 中身: URL 入力 (既存 #video-url を流用せず専用欄 — 即時再生と投入先の取り違えを防ぐ) + 「DLに追加」ボタン + DL リスト (status 別表示: queued / downloading / done=タップで play_local / failed=error 表示 + 再試行=同 URL 新規 enqueue)。各項目に削除ボタン。使用量表示 (`usage/limit`)。
- 取得タイミング: セクションを開いた時 + 開いている間のみ 15s ポーリング (todo の既存周期に合わせる。進捗 % は出さないので高頻度不要)。
- play_local 成功時は既存の動画 transport 画面へ遷移 (state ポーリングは既存機構をそのまま使う。ローカル再生は resolving がほぼ一瞬で playing になるだけで状態機械は不変)。**mpv の media-title はファイル名 (`dl-7.mp4`) になるため、PWA 側で play_local 直後の表示 title を state の title で上書きする** (devil 軽微。`loadfile` に force-media-title を足す案は verb whitelist 変更になるため不採用)。
- createElement のみ (innerHTML 不使用継続)、CSP 変更なし。SW CACHE **remote-v21→v22** bump。

## 7. テスト

- `tests/test_dlqueue.py` (隔離 temp state + fake yt-dlp スクリプト):
  - enqueue: 採番 / dedup (queued 同一 URL で既存返し) / 容量上限 507 境界
  - 遷移: queued→downloading→done/failed の flock RMW / recovery = downloading 残骸の failed 確定 + `dl-<id>.*` 掃除 (§1.2)
  - worker: rc≠0 → failed + 掃除 / glob 0 件 → failed / title サニタイズ / 着手直前の容量ガード (§3.3)
  - delete: queued/done/failed 可・downloading 409・ファイル削除実施
  - play_local 境界: 該当なし 404 / 未完了 404 / `file` に区切り文字・`..`・絶対 path を仕込んだ state 改竄の reject / symlink 脱出 reject
- 既存 60 件の退行なし。loopback HTTP 往復は隔離 state で実観測 (本番 .state 非接触)。
- 実弾スモーク (commit 前): **YouTube 短尺 1 本 + ニコニコ sm9 の実 DL → play_local → mpv playing 到達を IPC で確認。ニコニコは必須** (RV-9 迂回 = 本設計の採用理由の一角であり、domand の cookies 付き HLS 実取得は DL 時にしか踏まない。`-J` rc=0 までしか実証されていない。devil 軽微を格上げ)。

## 8. 採用しない / 罠リスト

- 別 systemd unit / timer (§1.1、YAGNI)
- DL 中キャンセル (§0 非目的。subprocess 管理の複雑化に見合わない)
- 自動リトライ / queued への自動復帰 (§1.2、回復は user 介入)
- 自動掃除 evict (§3.3、不意打ち + 数値いじりの温床)
- 再生検知→DL 抑止 / 観測前の `--limit-rate` (§2.4、受容を 1 回確定。観測後に 1 回だけ再判定)
- タイトル由来ファイル名 (§2.2、path 注入面)
- `--merge-output-format` 等のオプション盛り (§2.2)
- stdout からの filepath 確定 (§2.2、FS glob で確定。stdout は title 専用)
- HTTP から path 受け (§3.2、id のみ)
- bot.py 改変 (投入経路・通知とも無改変で成立)
- 起動時 reconcile での孤児 `dl-*` 削除 (§1.3、state 破損 → 実体全削除の逆事故。atomic write で破損自体を塞ぐ)
- lock fd のキャッシュ (§1.3、flock のスレッド間排他が無音で消える)

## 改版履歴
- v1.0 ドラフト (2026-06-12): RV-10 着手時の軽い設計ラウンド成果物として起草。
- v1.1 確定 (2026-06-12): devil レビュー (subagent 1 回) 反映。致命 1 = 容量ガードの worker 着手直前二重化 (§3.3)。要修正 7 = worker 生存規律 + 起動時 Event set (§1.1) / bind→recovery→worker の順序固定 (§1.2) / failed 時掃除の一般規則化 (§1.2) / filepath の FS glob 確定 (§2.2) / killpg (§2.1) / 通知の flock 外実行 + timeout (§5) / 帯域競合の受容裁定 (§2.4)。軽微 9 のうち採用 8 (downloads_dir realpath / title サニタイズ / ffmpeg 前提 / error 漏洩容認の一筆 / dedup / play_local 表示 title / ニコニコスモーク必須化 / 通知文面)、1 件は対案変更 (孤児 reconcile 削除 → atomic write 採用、§1.3 に理由)。
- v1.2 (2026-06-12): yt-dlp argv に `-4` 追加 (§2.2)。実運用初日の DL 失敗 (timeout 3600s) の真因 = 網の IPv6 死亡 × CDN AAAA による fragment 毎接続 timeout。cookies-from-browser (ticket #18 案) は cookies あり/なし同速の実測で前提が崩れ不採用、根拠を §2.2 に記録。
