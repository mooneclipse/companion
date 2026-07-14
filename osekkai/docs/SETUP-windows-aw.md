# SETUP-windows-aw — Windows (m-gamepc) ActivityWatch 導入手順書 [OWNER 作業]

osekkai Phase 1 の活動記録収集 (計画 D-3)。所要 15〜30 分。全 5 ステップ + 最後に Linux 側から到達確認 (これは claude に「AW 到達確認して」と言えばこちらで実施)。

**方針の要点** (計画 v0.2 で承認済み):
- 記録は**平日 19:00〜24:00 のみ** (タスクスケジューラで起動/停止、常時記録しない)
- API は**無認証**なので **Tailscale 内からのみ**到達できるよう Firewall で絞る
- データは PC 内に留まり、Linux 側が夜間に pull する

## 1. インストール

1. https://activitywatch.net/ から Windows 版インストーラ (現行安定版 v0.13.2) をダウンロードして実行
2. インストール後、一度手動起動してタスクトレイに AW アイコンが出ることを確認
3. ブラウザで http://localhost:5600 を開き、Web UI が表示され、しばらく操作していると Activity にデータが出ることを確認

## 2. 自動起動 (常時記録) の無効化

インストーラがログオン時自動起動を設定するため、これを外す (夜間限定はステップ 5 のタスクスケジューラで実現):

1. `Win + R` → `shell:startup` → ActivityWatch のショートカットがあれば削除
2. 見当たらなければ タスクマネージャー → スタートアップ タブ → ActivityWatch を無効化

## 3. 待受アドレスの変更 (Tailscale から到達可に)

1. AW をタスクトレイから完全終了 (Quit)
2. エクスプローラで `%LOCALAPPDATA%\activitywatch\` を開く (= `C:\Users\<ユーザー>\AppData\Local\activitywatch\`)
3. 配下のサーバー設定ファイルを編集する。**バンドルされているサーバー実装によりどちらかが存在する** (両方あれば両方直してよい):
   - `aw-server\aw-server.toml` (Python 版)
   - `aw-server-rust\config.toml` (Rust 版)
4. `[server]` セクションのバインド先を書き換え:

```toml
[server]
address = "0.0.0.0"
```

   - 既存キーが `host = "localhost"` になっていたらそれを `host = "0.0.0.0"` に (実装によりキー名が違う。**既にあるキー名の値だけ変える**のが確実)
5. AW を再起動し、http://localhost:5600 が引き続き開けることを確認

到達確認 (どのファイル/キーが効いたか) は最後にこちらで Linux 側から curl して裏取りするので、ここで完璧にできなくてよい。

## 4. Windows Firewall で Tailscale 内に限定

無認証 API のため、TCP 5600 への着信を Tailscale のアドレス帯だけに絞る。管理者 PowerShell で:

```powershell
New-NetFirewallRule -DisplayName "ActivityWatch (Tailscale only)" `
  -Direction Inbound -Protocol TCP -LocalPort 5600 `
  -RemoteAddress 100.64.0.0/10 -Action Allow
```

初回起動時に Windows が出した「アクセスを許可しますか」ダイアログで許可済みの場合、広い許可ルールができていることがある。確認して無効化:

```powershell
Get-NetFirewallRule | Where-Object DisplayName -Match "activitywatch|aw-server|aw-qt" | Format-Table DisplayName, Enabled, Action
# 上で作った "ActivityWatch (Tailscale only)" 以外の AW 関連 Allow ルールがあれば:
# Disable-NetFirewallRule -DisplayName "<そのルール名>"
```

## 5. タスクスケジューラで夜間限定稼働 (平日 19:00 起動 / 24:00 停止)

タスクスケジューラ (`taskschd.msc`) で 2 つのタスクを作る:

**タスク A: 起動**
- トリガー: 毎週 月〜金 19:00
- 操作: プログラムの開始 → `C:\Program Files\ActivityWatch\aw-qt.exe` (インストール先が違う場合は実物に合わせる)
- 条件: 「AC 電源のときのみ」チェックは外す
- 設定タブ: 「スケジュールされた時刻にタスクを開始できなかった場合、すぐにタスクを実行する」に**チェック** — **これが重要**。19:00 より後に PC を起動した夜 (最頻シナリオのはず) も記録されるようにする
- 全般タブ: 「ユーザーがログオンしているときのみ実行する」のまま (既定)。「ログオンしているかどうかにかかわらず実行」に変えると aw-qt が不可視セッションで動き、watcher が画面を観測できなくなる

**タスク B: 停止**
- トリガー: 毎日 0:00
- 操作: プログラムの開始 → `taskkill` / 引数 `/F /T /IM aw-qt.exe`
- 設定タブ: タスク A と同じく「開始できなかった場合、すぐに実行する」にチェック (0:00 にスリープしていた場合、復帰時に停止がかかる)
- (aw-qt が起動していない日は何もせず終わるだけなので毎日でよい)

作成後の動作確認: タスク A を右クリック → 実行 → トレイに AW が出る → タスク B を実行 → 消える。

## 6. 完了報告

ステップ 1〜5 が済んだら claude に「AW 導入終わった、到達確認して」と伝える。Linux 側から Tailscale 越しに以下を確認する (19:00〜24:00 の窓内で):

- `curl http://100.100.152.68:5600/api/0/info` が応答する
- buckets に `aw-watcher-window_<ホスト名>` / `aw-watcher-afk_<ホスト名>` が存在する

## 補足 (トラブル時)

- 設定ファイルが見つからない → AW を一度起動して終了すると生成される。`%LOCALAPPDATA%\activitywatch\` に無ければ `%APPDATA%\activitywatch\` (Roaming 側) も見る
- Linux から届かない → (a) ステップ 3 のもう一方のファイル/キーを試す、(b) Firewall ルールの適用先プロファイル (プライベート/パブリック) を確認、(c) PC 側 Tailscale が起動しているか確認
- 既知バグ: スリープ復帰後に AW の CPU 使用率が高くなることがある → AW を再起動すれば直る (夜間限定稼働なので遭遇率は低いはず。自動対処は作らない方針)
