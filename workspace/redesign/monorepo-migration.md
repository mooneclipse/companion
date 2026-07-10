# companion モノレポ移行手順書

**status**: Phase 0〜4 実行済み (2026-07-11 深夜、チケット #82) — 残り = OWNER 3 コマンド (初回 push / 旧 4 repo アーカイブ / .migration 削除) + Phase 5 翌日以降検証
**決定記録**: 2026-07-10 OWNER 承認 — ① モノレポ化 GO、② bot-workspace / ytcheck を含める (運用後に問題が出たら OWNER に「外す相談」をする約束)、③ 分割時代の履歴を取り込む
**実行単位**: Phase 0〜3 は 1 セッションで通す (切替を中途で止めない)。Phase 4 は同日中、Phase 5 は翌日以降

**実行記録 (2026-07-11 02:00〜02:20 JST、05:00 窓回避)**:
- Phase 0: 全 (B) repo ahead 0 実測 (maintenance の「ahead 2」は実行時点で push 済みだった)。dirty は games のみ → 切替前に 2 commit で解消 (docs e99e215 / test 86375a3)。pre-status.txt は 0 行 (全 repo clean)
- Phase 1: 12 repo すべて tree hash 一致 OK。spot check で merge 第 2 親から旧履歴 reachable を確認
- Phase 2: 切替完了。pre/post 突合差分は想定 3 点 (.gitignore / CLAUDE.md / persona/) のみ。初回 commit 5e82e39、gitleaks hook 稼働確認済み
- Phase 3: remote add 済み (`git@github.com:mooneclipse/companion.git`、空 repo への SSH 到達確認済み)。**初回 push と旧 4 repo アーカイブは OWNER 未実施**
- Phase 4: 共通 CLAUDE.md (b1bbb63) / workspace CLAUDE.md (fdb7739) / PROJECT.md (5a234c2) / closing SKILL.md (2424739) / 取りこぼし 6 箇所 (501ec11) + memory 5 ファイル同期済み。photos 側は独立 repo に別 commit (07e507b)
- 初回 push 前の証跡: code-reviewer が全履歴 gitleaks スキャン (573 commits / 7.14MB) を実行、検出 2 件はいずれも `web/lib/p5.min.js` の関数名への generic-api-key 誤検知で実 secret なし (screensaver は分割時代 hook 未設置だったため、この全履歴スキャンで初めて全域カバー)

---

## 1. 背景と根拠 (2026-07-10 実測)

- **結合は実在**: docs を除き 24 ファイルが他サブプロジェクトの絶対パスを参照 (dashboard→bot、maintenance→voice/dashboard/vault、remote→bot、bot→remote/vault ほか)。疎結合な独立プロジェクト群ではなく 1 つのシステム
- **git 追跡の実サイズは 12 repo 合計 約 7MB / 313 ファイル**。du で見える巨大さ (voice 3.8G 等) は全部 gitignore 済みの生成物・エンジン・音源で、GitHub push に支障なし
- **結合はすべて `~/companion/X/` の絶対パス参照** (systemd unit / スクリプト)。ディレクトリは 1 つも動かさないので runtime への影響ゼロ。変わるのは git の層だけ
- 従来の「(A) `~/companion/` 直下は git 化しない」(用途の異なる履歴を混ぜない) は本移行で**撤回**。実測により「用途の異なるプロジェクト」ではなく 1 システムだったことが根拠。(B)/(C) の 3 階層区分も廃止し、本手順書が撤回の記録を兼ねる

## 2. 対象マトリクス

| 項目 | 扱い | 理由 |
|---|---|---|
| bot / dashboard / maintenance / voice / remote / web / ytcheck / english / screensaver / games / workspace / bot-workspace | **track (履歴取り込み)** | コード・台帳。全 12 repo |
| `CLAUDE.md` (直下) | **track (新規)** | 共通指示ファイルなのに現在バージョン管理ゼロ |
| `persona/` | **track (新規)** | 台帳 1 ファイル (docs/STATUS.md 68KB) が git ゼロ。rollback 価値あり。外したくなったら `.gitignore` に `/persona/` を足すだけ |
| `vault/` | **境界外 (.gitignore)** | 専用 remote (obsidian-vault) + bot auto-sync の高頻度自動 commit を持つ独立データ repo。現状維持 |
| `photos/` | **境界外 (.gitignore)** | 35G。Takeout 原本から復元可能。ローカル git も現状のまま残す |
| `logs/` | **境界外 (.gitignore)** | runtime データ。そもそも repo でない |

補足 (実測済みの前提):
- branch は english / screensaver のみ `master`、他は `main`
- pre-commit hook (gitleaks) は全 repo 実質同一 (コメント 2 行差のみ)。screensaver のみ未設置 → モノレポ hook 1 本で全域カバーされ解消
- local git config は全 repo 同一 (user.name=mooneclipse / user.email=1870071+mooneclipse@users.noreply.github.com) → モノレポに 1 回設定
- ytcheck の自動 commit (`channel_store.py:_git_commit`) は `git -C <親dir> add/commit -- <絶対パス>` のパス限定方式。移行後は root repo への単独ファイル commit になるだけで巻き込みなし

## 3. Phase 0 — 前提確認 (切替前)

1. **実行時間帯**: 05:00 前後 ±30 分を避ける (ytcheck timer の自動 commit と切替が重ならないように)
2. **旧 GitHub repo の未 push 分を先に push** (切替後は旧 remote 構成が消えるため。OWNER がターミナルで):
   ```bash
   cd ~/companion/maintenance && git push origin main   # 2026-07-10 時点 ahead 2
   ```
   ほかに ahead がないか全 (B) repo を `git -C <dir> rev-list --count origin/main..main` で確認
3. **dirty の扱い**: dirty は切替後も同じ dirty として持ち越されるだけ (必須作業なし)。ただし games の `M CLAUDE.md` のような作業途中分は、分割時代の履歴をきれいに閉じるため切替前 commit を推奨
4. **untracked スナップショット採取** (切替後の突合用):
   ```bash
   mkdir -p ~/companion/.migration
   for d in bot dashboard maintenance voice remote web ytcheck english screensaver games workspace bot-workspace; do
     git -C ~/companion/$d status --porcelain | sed "s|^\(...\)|\1$d/|"
   done > ~/companion/.migration/pre-status.txt
   ```
5. (任意) USB バックアップを直前に 1 回回しておくと rollback の保険が二重になる

## 4. Phase 1 — 履歴合成 (subtree merge、本体無接触)

作業は `~/companion/.migration/mono` で行う。**この Phase では既存 repo に一切触らない** (fetch で読むだけ)。

```bash
cd ~/companion/.migration
git init -b main mono && cd mono
git config user.name mooneclipse
git config user.email 1870071+mooneclipse@users.noreply.github.com
git commit --allow-empty -m "chore: companion モノレポ初期化"

for d in bot dashboard maintenance voice remote web ytcheck english screensaver games workspace bot-workspace; do
  br=main; case $d in english|screensaver) br=master;; esac
  old=$(git -C ~/companion/$d rev-parse --short HEAD)
  git fetch ~/companion/$d "$br"
  git merge -s ours --no-commit --allow-unrelated-histories FETCH_HEAD
  git read-tree --prefix="$d"/ -u FETCH_HEAD
  git commit -m "merge: $d の分割時代の履歴を取り込み (旧 HEAD $old)"
done
```

**検証 (必須、全 12 repo が OK になるまで Phase 2 に進まない)** — サブディレクトリの tree hash が旧 repo HEAD の tree と完全一致することを確認する:

```bash
for d in bot dashboard maintenance voice remote web ytcheck english screensaver games workspace bot-workspace; do
  if [ "$(git rev-parse HEAD:$d)" = "$(git -C ~/companion/$d rev-parse 'HEAD^{tree}')" ]; then
    echo "$d OK"
  else
    echo "$d MISMATCH"
  fi
done
```

あわせて spot check: `git log --oneline $(git rev-parse 'HEAD^2') | head` 等、merge の第 2 親から旧履歴が引けること。

**注意 (誤認防止)**: `git log -- bot/` は merge commit 以降しか出ない。subtree merge の既知の性質で、旧履歴はパス `bot/` を触っていないため history simplification で落ちる (`--follow` でも越えられない)。取り込み失敗ではない — 旧履歴は merge の第 2 親から reachable で GC もされず、`git show <旧hash>` / rollback には使える。これを見て切替セッション中に即興対処しないこと。

## 5. Phase 2 — 切替

ここが唯一の不可逆っぽい工程だが、実際は「旧 `.git` をアーカイブ退避 → 新 `.git` を置く」だけで、rollback 手順 (§9) で完全に戻せる。

**切替中 (下記 1〜3 の間) は Telegram (bot) に触らない** — 旧 `.git` 退避〜新 `.git` 配置の窓で bot 経由セッションが commit を打つと迷子になる。ytcheck timer は Phase 0-1 の時間帯回避でカバー済み。

```bash
# 1) 旧 .git を全部アーカイブ退避 (削除しない)
mkdir -p ~/companion/.archive/split-era-git
for d in bot dashboard maintenance voice remote web ytcheck english screensaver games workspace bot-workspace; do
  mv ~/companion/$d/.git ~/companion/.archive/split-era-git/$d.git
done

# 2) 合成した .git を root に配置
mv ~/companion/.migration/mono/.git ~/companion/.git
cd ~/companion
git config user.name mooneclipse
git config user.email 1870071+mooneclipse@users.noreply.github.com

# 3) gitleaks hook を移植 (最初の commit より前に)
cp ~/companion/.archive/split-era-git/workspace.git/hooks/pre-commit ~/companion/.git/hooks/pre-commit
chmod +x ~/companion/.git/hooks/pre-commit
```

root `.gitignore` を作成 (境界の明文化):

```gitignore
/.archive/
/.migration/
/vault/
/photos/
/logs/
```

確認と初回 commit:

```bash
git status --porcelain > ~/companion/.migration/post-status.txt   # 初回は全ファイル再 stat で時間がかかる
diff ~/companion/.migration/pre-status.txt ~/companion/.migration/post-status.txt
# 差分が「CLAUDE.md / persona/ / .gitignore の 3 点のみ」であることを確認
# (Phase 0 で dirty を残した場合、その M/?? 行は pre 側にも post 側にも同じく出て diff では消える。
#  rename 行 R の第 2 パスに pre 側 prefix が付かない既知の綻びは目視で吸収)
git add .gitignore CLAUDE.md persona
git commit -m "feat: モノレポ切替 — 直下 CLAUDE.md / persona を取り込み、vault・photos・logs を境界外に"
```

**注意**: ここで `git add -A` / `git add .` は使わない (各 repo が従来から持っていた untracked を巻き込む)。以後もモノレポでは commit のパス明示が原則 (§10)。

最後に作業ディレクトリを片付ける: `rm -rf ~/companion/.migration` (ask 承認 1 回、または OWNER 実行)。

## 6. Phase 3 — GitHub 連携 (OWNER 実行)

```bash
# 1) private repo 作成
gh repo create mooneclipse/companion --private

# 2) remote 追加 (これは claude 側でも可: permissions.allow に git remote あり)
cd ~/companion && git remote add origin git@github.com:mooneclipse/companion.git

# 3) 初回 push
git push -u origin main

# 4) 旧 4 repo をアーカイブ (削除しない。obsidian-vault は継続なので対象外)
gh repo archive mooneclipse/companion-bot -y
gh repo archive mooneclipse/companion-dashboard -y
gh repo archive mooneclipse/companion-maintenance -y
gh repo archive mooneclipse/companion-voice -y
```

## 7. Phase 4 — ドキュメント・運用ルール同期 (claude 作業、各 1 commit)

| ファイル | 変更内容 |
|---|---|
| `~/companion/CLAUDE.md` | 「git 運用方針」を全面改稿: 3 階層 (A)(B)(C) → モノレポ + 境界外 3 つ (vault/photos/logs)。gitleaks hook はモノレポ 1 本。push は OWNER が `cd ~/companion && git push origin main` の 1 コマンド |
| `~/companion/workspace/CLAUDE.md` | 「Workspace 直下の git 方針」節を撤去しモノレポ参照に。Task Workflow step 5 の push 判別 ((B)/(C) + `git remote -v`) を「commit 後、push 行 `cd ~/companion && git push origin main` を表示」に単純化 |
| `~/companion/workspace/PROJECT.md` | 「git 化の 3 階層」→「モノレポ構成」に改稿。「サブプロジェクトの git 化手順」(git init + hook コピー) は廃止 — 新規プロジェクトは dir を掘るだけ |
| `workspace/.claude/skills/closing/SKILL.md` | (B)/(C) の `git remote -v` 判別記述を改訂 (repo 棚卸し対象は `~/companion` 1 つ + vault) |
| memory (`feedback_collaboration_judgment.md` ほか) | 「push は (B) remote 付き repo 限定」→ モノレポ前提に更新。closing 時にまとめて |
| 取りこぼし確認 | `grep -rn "3 階層\|ローカル git のみ\|remote なし" ~/companion --include="*.md" --exclude-dir=vault --exclude-dir=logs --exclude-dir=.archive` で旧区分への言及を洗い出して潰す (exclude は読み取りガード回避のため必須) |

## 8. Phase 5 — 移行後検証 (翌日以降)

- [ ] 翌朝 05:00 の ytcheck 自動 commit がモノレポに正しく載る: `git -C ~/companion log --oneline -3 -- ytcheck/`
- [ ] vault auto-sync / bot `/vault_push` が従来どおり動く (vault は独立 repo のまま、無影響のはず)
- [ ] 手元セッションの Task Workflow (レビュー → パス明示 commit) が新 push 行で回る
- [ ] 2〜4 週問題なければ `~/companion/.archive/split-era-git/` を削除 (それまで完全 rollback 可能)。削除は OWNER 承認後

## 9. Rollback 手順 (Phase 5 完了まで有効)

```bash
# モノレポ .git は削除せず退避 (モノレポ期の commit — ytcheck 日次 + セッション作業 — を salvage 可能に残す)
mv ~/companion/.git ~/companion/.archive/mono-failed.git
for d in bot dashboard maintenance voice remote web ytcheck english screensaver games workspace bot-workspace; do
  mv ~/companion/.archive/split-era-git/$d.git ~/companion/$d/.git
done
# GitHub 側: gh repo unarchive で旧 4 repo を復帰、mooneclipse/companion を削除
```

作業ファイルは一切動かしていないので、`.git` の配置を戻すだけで分割時代に完全復帰する。

## 10. 移行後の運用ルール (Phase 4 で CLAUDE.md に転記する内容の原本)

- **push**: claude は実行しない (従来どおり)。commit 完了時に `cd ~/companion && git push origin main` を 1 行表示し OWNER が叩く。頻度は OWNER の任意 (溜まっても push 1 発で全域バックアップされるのがモノレポの利点)
- **commit はパス明示**: `git add <対象パス>` のみ。`git add -A` / `git add .` は他プロジェクトの dirty を巻き込むため禁止 (自動系: ytcheck はパス限定実装済みで適合)
- **同時 commit の index.lock 衝突**: bot session / ytcheck timer / 手元セッションが同一 index を共有するため理論上あり得る。衝突したら片方が fail するだけなのでリトライで対処。**頻発するようなら bot-workspace / ytcheck をモノレポから外すことを OWNER に相談する** (2026-07-10 の約束)
- **新規プロジェクト**: `~/companion/<name>/` を掘るだけ。git init も hook コピーも不要
- **境界外は 3 つだけ**: vault (独立 repo + 専用 remote)、photos (独立ローカル repo)、logs (repo なし)

## 11. フォローアップ (本移行とは独立の別タスク)

- **vault push 自動化** (2026-07-10 OWNER 合意済み): `web/scripts/vault-sync-from-transcript.sh` の commit 成功後に `git push origin main` を追加。push 機構と SSH agent 配線は bot の `/vault_push` (bot.py) で実証済み。keyring ロック時は BatchMode 即 fail + ログ記録の既存挙動を踏襲。実装時は remote server 側の restart 要否も確認 (`reference_remote_server_restart` 参照 — sync スクリプトは web/ 配下だが呼び出し元経路を実装時に確認)

---

**最終更新**: 2026-07-10 (初版 + code-reviewer 指摘反映: §4 spot check を第 2 親経由に修正・`git log -- <dir>` 誤認防止注記、§5 突合を pre/post diff に機械化、§9 rollback を mv 退避に変更、§7 grep の vault/logs 除外、Phase 2 の bot 停止注記。レビューは git 2.34.1 実機 + テスト repo で Phase 1 レシピ再現実行済み)
