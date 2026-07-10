# CLAUDE.md (games, CWD=games 固有)

このファイルは CWD=`~/companion/games/` で claude CLI を起動したときに auto-discovery で読まれる、companion-games 固有の制約。**共通項は上位 `~/companion/CLAUDE.md` を参照**（応答言語 / 口調 / vault 書き込み境界 / OWNER 認可 / git 運用方針）。**対症療法 2 周目ルールも上位 `~/companion/CLAUDE.md`「設計判断・対症療法の上限」を参照**。

開発ワークフローは `~/companion/workspace/.claude/skills/newgame/SKILL.md`（新規ゲーム制作の固定工程）が正本。**例外: Mine Road リメイクは `/newgame` 不使用の仕様駆動**（発散・critic 工程が忠実再現を歪めるため。根拠と工程は `docs/STATUS.md`「Mine Road リメイク」セクション）。本ファイルは「どの工程でも踏み外してはいけない games 固有の暗黙知」を明文化する。台帳の正本は `~/companion/games/docs/STATUS.md`。

## パス別ルール（`.claude/rules/`）

ファイル単位で効く詳細制約は、該当パスのファイルをコンテキストに入れたときだけ自動ロードされる Rules に切り出した（context 節約 + 発見性）。常時ロードはこの CLAUDE.md、パス局所な詳細は各 rule が持つ。

- `server/**` を触るとき → `.claude/rules/delivery-boundary.md`（配信境界: 127.0.0.1 bind / tailscale serve / STATIC allowlist / GAMES_PORT）
- `<game>/web/**` を触るとき → `.claude/rules/game-web.md`（純静的 PWA / 断章 verbatim / 前景視認性 / SW 運用 / VERSION bump）
- `tests/**` を触るとき → `.claude/rules/playtest.md`（Playwright 実機検証 / 画面座標ヒットテスト / 本番ポート 47825 非接触）

## 配信導線（新ゲーム追加時の 3 点）

1. `server/app.py` の `STATIC` dict に新ゲームの prefix エントリを追加（`/<game>/...` 絶対パス、rel は `<game>/web/...`）。既存作の URL は完全不変に保つ。
2. remote 側 `~/companion/remote/web/app.js` の `GAMES` 配列に 1 行追加 + SW cache bump。
3. `tailscale serve` 状態を確認（同一サーバ・同一ポートのため systemd unit は変更不要）。

ゲーム本体（`<game>/web/*`）編集時の VERSION bump は `.claude/rules/game-web.md` に集約。

## 複数ゲーム配信

- 同一サーバ・同一ポートで **prefix 分け**（`/` = 第 1 作、`/<game>/` = 以降）。既存作の URL は完全不変に保つ（ユーザーがホーム追加した本番互換を壊さない）。
- `/` をゲーム選択ギャラリーにする案は **YAGNI で見送り**（3 作目以降で直リンク運用が辛くなったら `/` をギャラリー化し `STATIC` を分割）。

## git

- 2026-07-11 から **`~/companion/` モノレポ配下**（チケット #82）。commit はパス明示（`git add <対象パス>`、`-A`/`.` 禁止）、push は OWNER のみ。運用の正は上位 `~/companion/CLAUDE.md` git 運用方針。
- gitleaks pre-commit hook はモノレポ 1 本（`~/companion/.git/hooks/pre-commit`、git 管理外なので再配置時は要コピー）。
- commit メッセージは既存ログスタイル（`feat(games):` / `docs(games):` / `refactor(games):`）に揃える。Co-Authored-By trailer は付けない。

## 報告・引き継ぎ

引き継ぎ／作業報告に書くコミットハッシュ・未追跡ファイル・件数・PASS／完了状態は、記憶から清書せず**書く直前に `git log --oneline` / `git status` 等の実出力を貼る**（過去に存在しないハッシュ・件数違い・未作成成果物の「作成済み」断定が発生。詳細はメモリ `feedback_fabricated_tool_results.md`）。見ていない値は断定せず「未確認」と明示する。

## 対象ユーザー

miho 個人のみ（完全個人利用、外部公開なし）。スコア / マルチプレイ / 課金は不要。発注趣旨は「要望を聞かず AI が判断して作る」＝感想の解釈・次手の判断は AI 側で確定する（ユーザーは管理を委任済み）。

## 一次資料パス

新規ゲームの判断軸（継承資産・課題）は次から引く。**第 4 作あかり以降は Steam 実プレイ嗜好を主・願望ポエムメモを従**とする（3 作連続ポエム収束の真因＝願望メモ過固定の対策。詳細は STATUS「第 4 作 方向転換」）:

- **主**: `~/companion/games/docs/steam-library-2026-06-02.json`（ユーザー提示の Steam ライブラリ実データ＝行動の証拠。owned 289、`playtime_forever`/`playtime_2weeks`/`rtime_last_played`/collections。これを毎回フレッシュに再分析する＝過去の解釈に引きずられない）
- 従: vault `aidiary/2026-04-11_games-i-want-to-try.md`（願望ポエムメモ。願望であって行動ではない点に注意。詩・静歩きに過収束させない）
- vault `notes/*-review.md`（各作の感想、例 `notes/2026-06-02_michiyuki-review.md`）
- `~/companion/games/docs/STATUS.md` の感想・設計起点メモ・方向転換記録
