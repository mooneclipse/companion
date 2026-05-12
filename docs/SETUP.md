# dashboard セットアップ手順書（人間がやる作業）

このファイルは「コードはコミット済み」の状態から「毎朝 5:30 に自動で動く」までを通すための作業手順。
上から順にやる。設計の背景・各検証項目の詳細は `STATUS.md` を参照。

⚠ 5〜7 は **TV が点く・音が出る**。深夜にやると寝てる人が起きる。日中にやること。

---

## 1. 音楽を入れる

```
~/music/morning/    ← ここに朝かけたい曲（mp3/flac/ogg/opus/m4a/aac/wav）を入れる
~/music/afternoon/  ← 将来 timer を足したとき用（今は空でよい）
~/music/evening/
~/music/night/
```

- `morning/` が空のままだと、起動はするが mpv はスキップされる（journal に warn が出るだけ。エラーにはならない）。
- サブフォルダは見ない（`morning/` 直下のファイルだけ）。

## 2. ゴミの日と地域を設定する

`~/companion/dashboard/web/dashboard-config.js` を編集。今は**全部ダミー値**なので、名古屋市中村区の自分の地区の実際の収集日に書き換える。

- 曜日番号は `0=日 1=月 2=火 3=水 4=木 5=金 6=土`（JavaScript の規則）。
- `weekly: [曜日, ...]` = 毎週その曜日。`nth: [[第何週, 曜日], ...]` = その月の第n曜日（第n週が無い月はスキップ）。両方併用可。
- `weather.lat` / `weather.lon` も中村区の自分の場所に寄せていい（今は名古屋駅周辺の概算）。緯度経度は Google マップで右クリック→座標、で出る。
- ※ 自治体カレンダーの年末年始振替などは取り込まない設計（その期間だけ表示がズレる）。

編集したら Firefox で `file:///home/miho/companion/dashboard/web/index.html` を開いて、ゴミ欄が「あす(◯)」「次: …」と妥当に出るか目視確認。

## 3. （任意）linger を有効化

```bash
# 別ターミナルで（sudo は Bash ツールから打てないので）
loginctl enable-linger miho
```

auto-login で常時セッションがあるので無くても動くが、セッションが何かの拍子に切れても timer が生き続ける保険。やってもやらなくてもいい。

## 4. systemd ユニットの確認（まだ enable しない）

ユニットは `~/.config/systemd/user/` に symlink 済み・`daemon-reload` 済み。確認だけ：

```bash
systemctl --user cat dashboard.service dashboard-start.timer dashboard-stop.service dashboard-stop.timer
systemctl --user list-timers --all | grep -i dashboard   # まだ何も出ないのが正しい（enable してないので）
```

## 5. 手動で起動テスト（日中・TV を見られる状態で）

```bash
systemctl --user start dashboard.service
journalctl --user -u dashboard.service -f      # 別ペインでログを見る
```

これで確認すること（= STATUS.md の B1-B14 の実地版）：

- [ ] **TV にダッシュボードが全画面で出るか**（HDMI-1 側。ノート本体パネルではなく）。chrome（タブバー等）が隠れているか。「全画面モードです」の警告オーバーレイが残っていないか。← 出ない/本体パネルに出る場合は `journalctl` を見て、`firefox window not found within timeout` や wmctrl 行を確認。STATUS.md の B4 / 「対症療法 2 周目ルール」節を読む（=ここで小手先のリトライ追加はせず設計を見直す）
- [ ] **音が TV から出るか**、音量は 50% 相当か（前夜に何をしていても 50% になる）。`pactl get-sink-volume @DEFAULT_SINK@` で sink が 50%、`pactl list sink-inputs | grep -i volume` で mpv ストリームが 100% か。← ズレてたら STATUS.md の B1（module-stream-restore）
- [ ] **時計が動くか**（秒は出ない。`HH:MM` と日付）。
- [ ] **天気が出るか**（アイコン＋現在気温＋今日 ↑↓＋降水%）。「取得できません」なら、Firefox を開いて DevTools のコンソールで `file://` から `api.open-meteo.com` への fetch が CORS で弾かれていないか確認（= B5）。弾かれていたら STATUS.md の「B5 NG 時の contingency」（helper に `/weather` プロキシを足す）を実装する作業が発生する。
- [ ] **ゴミの日**が config どおりに出ているか。
- [ ] **now playing** — `morning/` に曲を入れていれば曲名が薄く出る。空なら出ない（それで正常）。

問題なければ停止：

```bash
systemctl --user stop dashboard.service
```

これで確認すること：

- [ ] firefox・mpv が完全に消えたか：`systemd-cgls --user | grep -iE 'firefox|mpv|nowplaying'` で何も残らない。`pgrep -af dashboard-mpv` も空。
- [ ] **自分が普段使っている Firefox（別ウィンドウ）が巻き込まれて閉じていないか**（専用プロファイルなので閉じないはずだが念のため）。
- [ ] TV はデスクトップ壁紙が見える状態に戻る（これで正常。TV を消したりスリープしたりはしない＝Navidrome 等は動き続ける）。

## 6. timer を有効化（毎朝 5:30 / 毎朝 9:00）

5 で問題なければ：

```bash
systemctl --user enable --now dashboard-start.timer dashboard-stop.timer
systemctl --user list-timers --all | grep -i dashboard   # dashboard-start が次 05:30、dashboard-stop が次 09:00 と出る
```

（`dashboard.service` と `dashboard-stop.service` は timer の `Unit=` で駆動されるので enable 不要。）

これで翌朝 5:30 に自動起動、9:00 に自動終了する。やめたくなったら `systemctl --user disable --now dashboard-start.timer dashboard-stop.timer`。

## 7. 翌朝の確認

- [ ] 5:30 にちゃんと点いたか（数秒以内。`AccuracySec=1s`）。
- [ ] 9:00 にちゃんと消えたか。
- [ ] 月をまたいだ後にゴミの「第n曜日」が正しく繰り上がるか（数日後にまた見る。= B16）。

---

## GitHub へ push する場合

ローカル commit は済んでいる（`git -C ~/companion/dashboard log` で確認）。push するなら：

```bash
# repo 名は他の companion サブプロジェクトに合わせるなら companion-dashboard
gh repo create mooneclipse/companion-dashboard --private --source=. --remote=origin --push
# gh を使わないなら GitHub の Web で private repo を作ってから:
#   git -C ~/companion/dashboard remote add origin git@github.com:mooneclipse/companion-dashboard.git
#   git -C ~/companion/dashboard push -u origin main
```

※ `git push` は `.claude/settings.json` で `ask` なので 1 回承認が要る（誤操作の最終ゲート）。
※ `.git/hooks/pre-commit`（gitleaks）は git clone についてこないので、別マシンで clone したら `cp ~/companion/workspace/.githooks-template/pre-commit .git/hooks/ && chmod +x .git/hooks/pre-commit` を再実行する。

---

## こまったとき

- TV じゃなく本体パネルに出る / 全画面にならない → `journalctl --user -u dashboard.service` の wmctrl 周りの行。STATUS.md の B4。**ここで `dashboard-start.sh` の wmctrl リトライ回数を増やしたり sleep を足したりしない**（`~/companion/CLAUDE.md` の「対症療法 2 周目ルール」）。flaky なら設計を引き直す。
- 音が出ない / 音量が変 → `pactl` で sink と mpv stream の音量を確認。STATUS.md の B1。
- 何も起きない（5:30 に点かない）→ `systemctl --user list-timers` で timer が active か、`systemctl --user status dashboard.service` で `ExecStartPre` の X-readiness で落ちていないか（`X11 socket ... not present`）。
- ログは `journalctl --user -u dashboard.service`（別ログファイルは無い）。
