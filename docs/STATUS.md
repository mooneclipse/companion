# companion-games 開発台帳（umbrella: 全部 AI で作るゲーム / 第 1 作「みちゆき」）

最終更新: 2026-06-02 (v1 実機プレイのユーザー感想を受領・反映。下記「v1 ユーザー感想と次への反映」section に教訓を記録。次セッションは v1 調整 + 第 2 作の方向づけへ)

## セッション引き継ぎ（2026-06-02、次セッションは別セッション想定）

- **現状**: みちゆき v1 は実機(Pixel-6 Chrome/Edge)で opening → 長押し歩行 → 景色遷移 → ending「着いた」まで踏破確認済み。歩けない真因(overlay)・視認性(静止に見えた)・キャッシュ事故(SW)を解決済み。git クリーン、`companion-games.service` active+enabled。
- **ユーザー感想 受領済み**(vault `notes/2026-06-02_michiyuki-review.md`)。下記「v1 ユーザー感想と次への反映」に内容と教訓を記録。次セッションは (a) v1 微調整(歩行者の視認性をわずかに上げる / 歩行速度・断章タイミング・景色の流れ・フォントのバランス) と (b) 第 2 作の方向づけ(「読むだけ」を超える関与の設計) に入る。
- **配信 URL(現状 3 本とも生きている、tailscale serve --bg で永続)**:
  - `https://miho-inspiron-3521.tail5e989b.ts.net:8444/` … 本番(クリーン origin、ユーザーが踏破したのはここ)
  - `:8445/?debug=1` … HUD 付きデバッグ
  - `:8443/` … 最初の origin(旧 SW キャッシュが端末に残りうる。killer SW で自浄)
- **片付け候補(本番 URL 確定後に実施)**:
  - tailscale serve を本番 1 本(推奨 8444)へ整理し、`tailscale serve --https=8443 off` / `--https=8445 off` で 8443・8445 を落とす。ユーザーがどの URL をホーム追加したか確認してから。
  - `?debug` HUD(app.js 末尾)の除去 or 恒久デバッグ資産として明示保持の判断。
  - オフライン再プレイ(Service Worker)の再導入可否(現在は killer で無効化中)。

## v1 ユーザー感想と次への反映（2026-06-02）

一次資料: vault `notes/2026-06-02_michiyuki-review.md`（ユーザー手書き、fleeting）。本プロジェクトは「要望を聞かず AI が判断して作る」趣旨のため、感想の解釈と次手の判断は AI 側で確定する（ユーザーに確認したところ「あなたが全部管理するので判断して」と委任を再確認）。

### ユーザーが良かったと挙げた点（= 第 2 作以降も継承する資産）

- **CSS/canvas のみで移りゆく景色が美しい**。色彩の時間変化（夜明け→夜の 6 キーフレーム補間）はこのシリーズの核として刺さっている。→ 「色と光の時間変化で世界を語る」は継続の柱。
- **テキストが雰囲気に合っている**。断章の文体は当たり。verbatim 静的データ方針（実装側で創作しない）も含めて継続。
- **「昔」のパートに“にょりさん”の雰囲気があって良い**。過去・郷愁の手触りが効いている。→ 第 2 作でも「時間の層／喪失と懐かしさ」のモチーフは強み。

### ユーザーが課題と挙げた点（= 次への教訓）

1. **「読むだけ」ではゲームとして厳しい**。「私を楽しませる」コンセプトは伝わったが、読み物（長押しで進むだけ）は“たまに”なら良くても“ずっとこれ”だと持たない、との評。
   - **教訓（第 2 作の方向づけ）**: 静けさ・スコア無し・失敗無しの美学は維持しつつ、**プレイヤーの選択や操作が世界に作用する余地**を一段入れる。例: 分岐する道／触れると反応する地形・光／拾う・残す等の小さな相互作用／探索で景色が変わる。Journey の「歩く以上の関わり（飛ぶ・呼応・他者）」が参照点。みちゆきは「一本道を読む」一極だったのを、次は「歩く + 世界が応える」へ。
   - v1 自体は“静かな読み物”として完成形でよい（ジャンルとして成立）。第 2 作で振れ幅を変える、という棲み分け。

2. **背景と歩行者の色が同化してほとんど見えなかった**（「意図したものなら OK」と留保付き）。
   - **判断（AI 確定）**: v1 で歩行者の視認性を**わずかに上げる**。理由 — 歩行者はプレイヤー唯一の分身で自己投影の対象。静かな体験でも「自分がそこにいる」感覚は要る（Journey の赤い衣が常時視認できるのと同じ役割）。ただし「景色が主役・人は気配」の方針は保持し、**強い縁取りではなく明度差／薄い縁取りを少し付ける程度**に留める。「ほとんど見えない」→「言われれば気づく」を目標。完全に目立たせない。
   - 実装メモ: `app.js` の歩行者シルエット描画は背景色に対して固定的に暗い塗り。progress に沿って空・地面色が大きく動く（特に夜帯）ため、背景明度に応じて歩行者の明度を相対的にずらす（暗背景では少し明るく、明背景では少し暗く）か、ごく細い半透明の縁を 1px 入れると同化を避けられる。コントラスト比は WCAG までは要らない、視線で追える最低限。

### 第 2 作（次弾）の設計起点メモ

- 継承: 色と光の時間変化 / 雰囲気重視の断章文体 / 静けさ・スコア無し・失敗無し / 純静的 PWA（ランタイムで claude 呼ばない budget-guard 回避）/ 127.0.0.1 bind + tailscale serve 境界。
- 変える: 「読むだけ」→「歩く + 世界が応える」。小さな相互作用を一つ核に据える。
- 視認性の原則を最初から: 前景（プレイヤー／触れる対象）は背景の明度変化に追従して常にコントラストを確保する設計を初手から入れる（v1 では後から気づいた）。

## 概要

「スマホで遊べるゲームを全部 AI で作る」umbrella プロジェクト。ユーザー(SE, 完全個人利用)が「自分にいっさい要望を聞かず、自分が楽しめるゲームを AI が勝手に作る」という趣旨で発注。嗜好の一次資料は vault `aidiary/2026-04-11_games-i-want-to-try.md`(広大な世界をただ歩く / 地形だけで語る / Journey・Shadow of the Colossus のような静かで「終わりが惜しい」体験 / 「ないものに触れる」)。

第 1 作 **みちゆき** はこれに寄せた静かな横歩きゲーム。スコア無し・失敗無し、長押しで歩き、progress 0→1 の道中で空と地面の色が夜明け→夜へ移ろい、断章(石碑)を読みながら終端へ向かう。

- 対象ユーザ: miho 個人のみ(完全個人利用、外部公開なし)
- 配信形態: スマホ(Tailnet 同居)から開く静的 PWA
- 不要なもの: スコア / マルチプレイ / 課金 / 音(v1 は無音)

## 位置付け

`workspace/PROJECT.md` の Phase 1〜4 ロードマップとは独立した **フェーズ外の独立プロジェクト**(remote / dashboard と同じ扱い)。umbrella「全部 AI で作るゲーム」の第 1 作。

## ネットワーク境界

companion-remote の流儀を踏襲。

- サーバ(`server/app.py`)は **127.0.0.1 のみに bind**(0.0.0.0 / tailnet IP 厳禁)。
- 外向きは **`tailscale serve`(HTTPS 前段リバースプロキシ)経由のみ**。Tailnet 内からしか到達しない。
- 認証は tailscale 境界に委ねる(単一ユーザー、API 無し)。`/healthz` のみ無認証の生存確認。
- ポートは env `GAMES_PORT`(デフォルト 47825、remote の 47824 と衝突しない別番号)。

## 設計判断: ランタイムで claude を呼ばない（budget-guard 境界回避）

ゲームはランタイムで claude / 外部 API を**一切呼ばない純静的 PWA**。断章テキストは**ビルド時に AI 生成した静的データ**(`michiyuki/web/fragments.js`)で、配信時は素朴なファイルサーブに徹する。これにより budget-guard 境界に踏み込まない。唯一の外部依存は和文フォントの Google Fonts CDN(`<link>`)で、取得失敗時は CSS の serif フォールバックで成立する(CSP で `fonts.googleapis.com` / `fonts.gstatic.com` のみ許可)。

## 設計判断: 開発フェーズは Service Worker を使わない（2 周目回避）

v1 初版で shell precache の cache-first SW(`michiyuki-v1`)を入れたが、実機(Pixel-6 Chrome)で「タップ・長押ししても画面が変わらない」事象。Chromium(Playwright)で配信中の現コードを SW 抜きで検証すると **PASS**(opening 表示 → タップ dismiss → 長押しで progress 前進、実行時エラー 0)。∴ コードは正常で、原因は **SW が壊れた中間状態の古い shell を cache-first で返し続けていた**こと。

対処として CACHE 名 bump(`v1`→`v2`)を一度打ったが、これは「同じ境界(SW キャッシュ整合)への 2 周目の条件いじり」(`~/companion/CLAUDE.md` 2 周目ルール)。3 度目を打たず一段引いて設計を見直し、**複雑性の源である SW 自体を開発フェーズから外す**判断に切り替えた:

- `sw.js` を **killer SW** に置換: 全キャッシュ削除 → 自身を `unregister` → 制御中ページを reload。fetch ハンドラを置かず、ブラウザ既定のネット直取得に戻す。ブラウザは navigation 時に byte 差分でこの新 sw.js を取得し旧 SW を置換するため、ユーザー端末は再アクセスで自動的に SW 無し状態へ収束する。
- `app.js` の SW 登録を廃止し、既存登録・キャッシュの掃除コードに置換。
- オフライン再プレイ(SW の本来目的)は tailscale 接続前提の本作では今は不要な装飾。**v1 のプレイ感が固まってから再導入**(下記 TODO)。

## 実機で歩けなかった真因(overlay)と視認性 — 2026-06-02

実機(Pixel-6 Chrome/Edge)で「タイトルはタップで消えるが、その後押しても歩かない」。HUD(`?debug`)で実機の生イベントを観測し確定:

- **真因**: opening を閉じる際 `overlay.hidden = true` にしていたが、UA の `[hidden]{display:none}` は詳細度が低く、`.overlay{display:flex}`(クラス指定)に負けて**消えていなかった**。透明な overlay が `inset:0` で画面全体を覆ったまま `pointer-events` を受け、canvas へ pointerdown が届かず `walking` が立たなかった(HUD で pointerdown は window capture では増えるが walking=false のまま、を実観測)。`.overlay[hidden]{display:none !important}` で打ち消し + フェードアウト中(`.overlay:not(.visible)`)は `pointer-events:none` で canvas へ透過。
- **検証ミスの教訓**: 初版 Playwright は長押しを **canvas へ直接 dispatch** していたため overlay を飛び越え PASS していた。座標へのヒットテスト(`page.mouse` を画面座標へ)に直し、最前面要素判定を実機同様に通すよう修正。`elementFromPoint` が `scene` を返すことも assert。
- **視認性**: 歩いても景色がほぼ流れず静止に見えた(3 秒で画面変化 0.66%)。scrollSpeed を約 5 倍(遠 700/中 1800/近 4500)、`FULL_WALK_SECONDS` 210→150、歩行者 bob 増。→ 3 秒で **15%** 変化、最初の文章まで約 15 秒。Playwright スクショを目視確認。
- **canvas に `touch-action:none`** も明示(body だけでなく canvas 自身に必要。長押しがジェスチャに消費されるのを防ぐ保険)。

## 実機検証基盤（Playwright + Chromium）

「実機相当のデバッガを通してから報告する」運用要求に対応。`tests/debug-michiyuki.mjs` が Chromium(headless)で配信中の本体を開き、**画面座標へのヒットテスト経由で**(canvas へ直接 dispatch しない)実行時エラー / opening dismiss / 長押し前進 / 画面ピクセル変化率を実観測して PASS/FAIL を返す。`devDependencies` に `playwright`、ブラウザ本体は `~/.cache/ms-playwright`(git 外)。実行: `node tests/debug-michiyuki.mjs`(サーバを 47825 で起動した状態で)。

`?debug` 付き URL で起動すると画面左上に HUD(pointerdown/touchstart/click 数 + walking/paused/progress)を表示し、実機の生入力を直接読める(本番=クエリ無しでは一切動かない)。実機で挙動が分かれたときの一次情報取得に使う。

## ディレクトリ構成

```
games/
├── docs/STATUS.md
├── michiyuki/web/
│   ├── index.html       # canvas + 断章オーバーレイ + CSP + フォント link
│   ├── app.js           # ゲーム本体(歩行 / パララックス / 色補間 / 断章 / 入力)
│   ├── fragments.js     # 断章テキスト(verbatim, AI 生成静的データ) + 色キーフレーム
│   ├── style.css        # 静けさ最優先のタイポグラフィ / オーバーレイ
│   ├── manifest.json    # PWA(name みちゆき / standalone / 夜明け色基調)
│   ├── sw.js            # shell precache の service worker(オフライン再プレイ)
│   └── icons/           # icon-192.png / icon-512.png(夜明け色グラデ, PIL 生成)
├── server/app.py        # stdlib http.server, 127.0.0.1 bind, 固定 allowlist 配信
└── systemd/companion-games.service
```

git: **(C) ローカル git のみ(remote なし、rollback 専用)**。GitHub remote は意図的に付けない(マシン外バックアップ不要)。gitleaks pre-commit hook 導入済み。

## 起動手順（SETUP）

```sh
# 1. user service として登録
ln -sf ~/companion/games/systemd/companion-games.service ~/.config/systemd/user/companion-games.service
systemctl --user daemon-reload
systemctl --user enable --now companion-games.service
systemctl --user status companion-games.service   # active 確認

# 2. tailscale serve で HTTPS 前段を張る(Tailnet 内のみ到達)
#    127.0.0.1:47825 を tailnet の HTTPS にぶら下げる。
sudo tailscale serve --bg --https=443 127.0.0.1:47825
tailscale serve status                              # 公開状態確認
# → スマホの Tailnet から https://<machine>.<tailnet>.ts.net/ で「みちゆき」が開く

# ポート変更する場合は ~/companion/games/.env に GAMES_PORT=xxxxx を置く(EnvironmentFile=-)。
```

> gitleaks pre-commit hook は `.git/hooks/` 配下(git 管理外)。この repo を別環境へ clone / 再 init した場合は消えるので、`~/companion/workspace/.githooks-template` か remote/ の hook を再配置すること(remote / web と同じ既知事項)。

## v1 で実装した範囲

### Done
- [x] 配信サーバ(`server/app.py`): 127.0.0.1 bind / 固定 allowlist dict 配信 / ディレクトリリスティング無し / Content-Type 明示 / generic エラー / `/healthz` 無認証生存確認 / `GAMES_PORT` env(default 47825)。
- [x] systemd user unit(`systemd/companion-games.service`): WorkingDirectory=%h/companion/games / Restart=on-failure / WantedBy=default.target。
- [x] ゲーム本体(`michiyuki/web`): canvas 全画面横歩き / 長押し(pointer)前進・→/Space でも前進 / フル踏破 約 3.5 分 / パララックス 3 層(決定論的 sin 和ノイズ) / 歩行者シルエット(bob) / progress に沿った空・地面色の線形補間(6 キーフレーム) / 夜の星 / 断章 8 本(opening + waypoint 6 + ending)を閾値到達でフェードイン・タップ dismiss / ending 後の静かな終端。
- [x] 断章テキストは仕様の verbatim を `fragments.js` に構造化(progress 閾値 + text、ending は改行保持)。実装側で改変・創作しない。
- [x] PWA: manifest.json(みちゆき / standalone / 夜明け色基調) / sw.js(shell precache, オフライン再プレイ) / icons 192・512(PIL で夜明け色グラデ生成)。
- [x] 動作確認: `node --check` で構文 OK、manifest.json JSON 妥当、テストポートで配信(全 allowlist 200 + 正 Content-Type / allowlist 外 404 / リスティング無効 / 127.0.0.1 bind)を確認。
- [x] **実機相当検証(Playwright + Chromium)**: opening 表示 → タップ dismiss → 「押しているあいだ、歩く」表示 → 長押しで progress 前進 → 離して停止、実行時エラー 0 を PASS 確認(`tests/debug-michiyuki.mjs`)。
- [x] 操作導線: 止まっている間「押しているあいだ、歩く」を画面下に表示(初版は操作不明だった)。
- [x] SW 無効化(killer SW + 登録廃止)。上記「設計判断」section 参照。

### TODO（今後の候補）
- [ ] 音: ambient soundscape の追加(v1 は無音。風 / 足音 / 環境音を progress に連動)。**外部から音源を取得する形にする場合は index.html の CSP 更新が必須**(`connect-src` / `media-src` の追加。現状は Google Fonts 2 ドメイン以外の外向きを塞いでいる)。同一オリジン配置(web 配下に同梱)なら CSP 変更不要。
- [ ] 複数ゲーム gallery 化: umbrella の 2 作目以降が出たら `/` をゲーム選択にし、server STATIC を分割。
- [ ] 断章の増補: 道中の waypoint を増やす / 季節・天候バリエーション。
- [ ] 実機目視プレイでのバランス調整(歩行速度 / 断章の出現タイミング / フォント表示)。Playwright で機能は検証済みだが、歩き心地・可読性は人の目で。
- [ ] オフライン再プレイ(Service Worker)の再導入: v1 のプレイ感が固まってから。開発中は上記のとおり無効化している。
