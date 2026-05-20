# companion-remote セットアップ手順

スマホ専用リモコン PWA + 配信サーバ。Tailscale 内のみ到達、127.0.0.1 バインド + `tailscale serve`(HTTPS)前段。設計は `~/companion/workspace/redesign/remote-design.md` v1.0。

## 前提

- Tailscale 導入済(`miho-inspiron-3521` / `m-gamepc` / `pixel-6` が同一 tailnet)。
- 本機は auto-login(systemd user service が起動時に立つ)。
- 依存は Python 3 標準ライブラリのみ(venv 不要)。F-2 voice は兄弟 `~/companion/voice/` の `say.sh` を叩く。

## 1. .env 作成

```sh
cd ~/companion/remote
cp .env.example .env
# 必要なら REMOTE_PORT / REMOTE_SAY_SH を編集(デフォルトのままで可)
```

## 2. systemd user service 配置

`~/.config/systemd/user/` から symlink で配置(bot/voice/dashboard と同方式):

```sh
ln -s ~/companion/remote/systemd/companion-remote.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now companion-remote.service
systemctl --user status companion-remote.service
```

127.0.0.1 のみで listen していることを確認(0.0.0.0 / tailnet IP に出ていないこと、§2.1):

```sh
ss -tlnp | grep 47824
```

## 3. tailscale serve(HTTPS 前段, one-time)

`tailscale serve` で 127.0.0.1 のサーバを MagicDNS の HTTPS(443)に前段公開する。**`tailscale funnel` は絶対に使わない**(外部公開、deny 済)。

```sh
# バージョンで引数が変わるので必ず --help / status で確認してから実行
tailscale serve --help
tailscale serve --bg http://127.0.0.1:47824
tailscale serve status
```

→ `https://miho-inspiron-3521.<tailnet>.ts.net/` で到達可能になる(Let's Encrypt 実 CA 証明書、SW の secure context 要件を満たす)。

### serve 実機検証(remote-design §9(d)、初回必須)

- (d-1) ルート `/` がマウントされ index/app.js/manifest/sw.js/icons が配信されるか(SW scope `/` 前提)。
- (d-2) HTTP edge で identity header(`Tailscale-User-Login`)が付与されるか。付くなら将来の認可二段化(H-1 緩和)に使える。付かなければ Bearer + ACL で運用(design §6)。
- (d-3) サーバは IPv4 単独 bind(127.0.0.1)。serve 前段が loopback を `localhost`→`::1` 解決して到達不能なら、`server/app.py` の `HOST` に `::1` bind 追加を検討。
- (d-4) F-2 発話が service 環境で鳴るか(say.sh の paplay/ffmpeg/curl が DISPLAY/PULSE/PATH 充足で動くか)。鳴らなければ service の `Environment=` に PULSE_SERVER 等を追加。

## 4. トークン発行(out-of-band, paste)

```sh
cd ~/companion/remote
python3 server/auth.py issue pixel-6   # stdout に1回だけ平文表示(再表示されない)
python3 server/auth.py list            # 発行済みの label/作成日(平文・ハッシュは出ない)
```

→ 表示されたトークンを pixel-6 のブラウザで `https://<host>.<tailnet>.ts.net/` を開き「トークン設定」欄に paste(localStorage 保存、以後ネットワークを流れるのは Bearer ヘッダのみ)。ホーム画面に追加で PWA インストール。

## 5. 失効・紛失時の revoke(2 系統)

スマホ紛失・トークン漏洩時:

1. **第一手(最上流)**: Tailscale 管理画面で `pixel-6` を device disable。
2. **トークン失効**: SSH で本機にログインし

   ```sh
   cd ~/companion/remote
   python3 server/auth.py revoke-all     # tokens.json を空に
   systemctl --user restart companion-remote.service
   ```

UI 経由のトークン無効化 endpoint は **作らない**(漏洩端末から叩ける循環参照、design N-3)。

## トラブルシュート

- ログ: `journalctl --user -u companion-remote.service -f`
- web/ アセット(index/app.js/style.css 等)を更新したら `web/sw.js` の `CACHE` を 1 つ上げる(cache-first で旧版を掴むのを防ぐ)。
