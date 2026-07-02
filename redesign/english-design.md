# english-design.md — 英語リスニング学習アプリ「english」設計台帳

チケット #61「英語学習システムの構築。youtubeのアニメや動画をクロップしてみるのはどうだろう」の設計台帳。
photos / remote と同列の **独立サブプロジェクト** (`~/companion/english/`) として作る。

## 改版履歴

- **v0.2 (2026-07-02)**: code-reviewer 指摘反映。修正必須 2 件 — (1) `clips.tokens` 列を追加しトークン化を clips.py の空白 split 1 回で確定 (blank 位置の正解漏れ対策で API は blank 位置 null 置換を明記)、(2) `watch.max_position_s` を分離 (レジューム位置と視聴済み右端の二重意味を解消、巻き戻しでプールが縮む問題)。軽微 — Range は photos 実装流用可 / 出題選定のフォールバック 2 件明文化 / streak 更新は `/api/home` 再取得 / ブリーフのクリップ長を 4〜12 秒に統一・誤記修正。加えて df 実測 (320GB 空き) で 720p 確定
- **v0.1 (2026-07-02)**: 初版。チャット版要件定義を user の追加入力で改訂し、4 分岐 (解答方式 / 分量 / 出題範囲 / 教材調達) を user 確定。全体設計・データモデル・パイプライン・API・フェーズ分けを起こした。UI は `english-ui-brief.md` (claude design 用ブリーフ) に分離。

---

## 0. 目的と確定済み要件

### 0.1 目的

英語圏のゲーム配信・アニメを字幕なしで聴き取れるようになるための、**毎日 2〜3 分の穴埋めリスニングドリル + 好きなアニメの全話視聴ライブラリ**。教材は実際の動画クリップ (TTS 生成音声は使わない)。

### 0.2 user 前提 (2026-07-02 聞き取り)

- Duolingo を毎日継続中 (**1277 日連続、スコア 43**)。本アプリはその **+α** の位置づけ — 1 回は短く済むことが最優先
- 単語もまだ分からないものが多い → 聞き取りはフル書き取りでなく **穴埋め** が適合
- 題材候補: **Peanuts / The Amazing Digital Circus (TADC) / Adventure Time**。YouTube でただ見るのは続かなかった → **このアプリで全話見られる**こと自体が継続動機
- 利用形態: スマホ (Pixel 6)。リモコン PWA のタイルから遷移するが、**photos のように独立したアプリ**
- 画面設計は user が **claude design** で詰める → 本設計からは UI 要件ブリーフ (`english-ui-brief.md`) を渡す
- 設計は Fable 5 が利用できるうちに固め、**Sonnet レベルで実装可能な粒度**まで落とす

### 0.3 user 確定 4 分岐 (2026-07-02、AskUserQuestion)

| # | 分岐 | 確定 |
|---|---|---|
| 1 | ドリル解答方式 | **選択式チップ** (空欄ごとに 4 択チップをタップ)。入力式は v1 |
| 2 | デイリードリル分量 | **クリップ 3 本 ≈ 2〜3 分**。物足りなければ「もう 1 セット」ボタン |
| 3 | 出題範囲 | **視聴済み範囲から** (直近視聴エピソード優先。ネタバレなし・文脈既知で聞き取りに集中) |
| 4 | 教材調達 | **汎用 ingest** (URL/プレイリスト登録 + ローカルファイル持ち込み)。3 作品の公式可用性は**別途 Web 調査タスク** |

### 0.4 チャット版要件からの主な改訂

チャット (claude.ai) で作った要件定義を土台に、以下を改訂した:

1. **ディクテーション (フル書き取り + 差分 3 択判定) → 穴埋め選択式に軽量化**。スマホで 1 回が長くなりすぎるため。「字幕が間違っている」判定は答え合わせ後のワンタップフラグに縮退して残す
2. **多読モード (全話視聴) を v1 → v0 に昇格**。継続動機の本体のため。理解度自己申告はエピソード終了時のワンタップ 4 段階 (スキップ可) に軽量化
3. **採点は緩く / 答え (字幕) は不完全前提 / 進捗可視化 / 段階的に作る** の設計原則はそのまま継承
4. 適応出題・Whisper・チャンネル自動巡回は v1/v2 のまま (先に作らない)

### 0.5 教材可用性の正直な前提 (未調査・要確認)

- **TADC**: Glitch 公式チャンネルで全話無料公開 + 手動字幕あり見込み — 最有力の初期教材
- **Peanuts**: クラシック作品は Apple TV+ 独占の可能性が高く、YouTube 公式はクリップ中心の見込み
- **Adventure Time**: Cartoon Network 公式はクリップのみの見込み。非公式アップロードは字幕品質・takedown の面で不安定
- → アプリ設計は調達と切り離す (0.3 #4)。**可用性調査は別チケットで WebSearch 実施**し、結果を本台帳 §0.5 に追記する

---

## 1. 全体構成 (photos 方式の独立アプリ)

```
Pixel 6 (スマホブラウザ / PWA-lite)
   │ https://<tailnet>:8447          ← tailscale serve (要実測: 空きポート確認)
   ▼
127.0.0.1:47827  server/app.py      ← systemd user service (companion-english)
   ├── 静的 UI (web/)
   ├── JSON API (/api/*)
   └── メディア配信 (/media/*、HTTP Range 対応必須)
        ▲
        │ 読む
data/english.db (SQLite) + media/   ← 夜間/手動バッチ (pipeline/) が書く
        ▲
        │ yt-dlp + ffmpeg
YouTube / ローカルファイル持ち込み (inbox/)
```

- **ポート**: loopback **47827** (47824 remote / 47825 games / 47826 photos の次)。tailscale serve は **8447 候補** — photos ポストモーテム原則に従い、**提示前に `tailscale serve status` を user 実行で実見**してから確定する (443=remote, 8443-8445=games, 8446=photos が既知占有)
- **リモコン連携**: remote PWA にタイルリンク 1 個追加のみ (photos と同型)。それ以外は完全独立
- **TV 連携はしない** (remote の mpv/video 系とは別軌道。非要件 §7)
- ディレクトリ:

```
~/companion/english/
├── server/
│   ├── app.py        # ThreadingHTTPServer: 静的 + API + media (Range)
│   ├── store.py      # SQLite アクセス層 (WAL)
│   └── drill.py      # 出題選定 (ルールベース)
├── pipeline/
│   ├── ingest.py     # sources.json → yt-dlp DL (動画+字幕) → DB episodes
│   ├── subs.py       # VTT/SRT クリーニング → 文単位 cue + プレイヤー用 WebVTT
│   ├── clips.py      # ffmpeg クリップ切り出し + 穴埋め生成 → DB clips
│   ├── sources.json  # 登録 URL/プレイリスト (series 単位)
│   └── wordlists/    # weak_forms.txt / confusions.json (穴埋め対象・誤答肢)
├── web/              # index.html / app.js / style.css / manifest.webmanifest (vanilla、ビルドなし)
├── media/            # .gitignore 対象 (episodes/ clips/ subs/ thumbs/)
├── inbox/            # ローカルファイル持ち込み置き場 (動画 + .srt/.vtt を対で置く)
├── data/english.db   # SQLite (.gitignore)
├── systemd/companion-english.service
└── docs/STATUS.md
```

- **git**: **(C) ローカル git のみ** (remote/games と同判断: 実装コードは rollback が効けば十分)。学習ログ (english.db) はマシン外価値があるため、v1 で既存 USB バックアップ運用 (maintenance usb-backup) への db 追加を検討する
- **認証なし** (photos と同じ tailnet 内前提 + loopback bind が第一防御)

---

## 2. データモデル (SQLite、単一 db)

```sql
CREATE TABLE series (
  id TEXT PRIMARY KEY,           -- slug (例 "tadc")
  title TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE episodes (
  id TEXT PRIMARY KEY,           -- YouTube video id / ローカルは "local-" + ファイル名ハッシュ
  series_id TEXT NOT NULL REFERENCES series(id),
  title TEXT NOT NULL,
  source_url TEXT,               -- ローカル持ち込みは NULL
  duration_s INTEGER NOT NULL,
  video_path TEXT NOT NULL,      -- media/episodes/<id>.mp4
  sub_path TEXT,                 -- media/subs/<id>.vtt (プレイヤー用クリーン済 WebVTT)
  sub_kind TEXT NOT NULL,        -- manual | auto | local | none
  sort_key TEXT NOT NULL,        -- 話数順 (playlist index / ファイル名)
  ingested_at INTEGER NOT NULL
);
CREATE TABLE watch (
  episode_id TEXT PRIMARY KEY REFERENCES episodes(id),
  position_s REAL NOT NULL DEFAULT 0,       -- レジューム位置 (最新値、巻き戻しで減る)
  max_position_s REAL NOT NULL DEFAULT 0,   -- 視聴済み範囲の右端 (max() で単調更新、§4.3 プール判定用)
  completed_at INTEGER,                 -- 90% 到達で完了扱い
  comprehension INTEGER,                -- 終了時ワンタップ 1..4 (スキップ時 NULL)
  updated_at INTEGER NOT NULL
);
CREATE TABLE clips (
  id TEXT PRIMARY KEY,           -- <episode_id>-<start_ms>
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  start_s REAL NOT NULL, end_s REAL NOT NULL,
  video_path TEXT NOT NULL,      -- media/clips/<id>.mp4 (480p 再エンコード)
  text TEXT NOT NULL,            -- クリーン済み原文
  tokens TEXT NOT NULL,          -- JSON 語配列 (空白 split、clips.py で確定保存。blanks.idx はこの配列基準。サーバ側で text から再トークン化しない)
  blanks TEXT NOT NULL,          -- JSON: [{"idx":3,"answer":"gonna","choices":["gonna","going","gone","kinda"]}]
  wpm INTEGER NOT NULL,
  feature_tags TEXT NOT NULL DEFAULT '[]'  -- JSON: ["weak_form","linking",...] (v0 は weak_form のみ)
);
CREATE TABLE attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id TEXT NOT NULL REFERENCES clips(id),
  ts INTEGER NOT NULL,
  results TEXT NOT NULL,         -- JSON: 空欄ごと true/false
  flags TEXT NOT NULL DEFAULT '[]', -- JSON: "sub_suspect"(字幕怪しい) | "unheard"(聞き取れなかった)
  replays INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL
);
CREATE TABLE daily_sets (
  date TEXT PRIMARY KEY,         -- JST "YYYY-MM-DD"
  clip_ids TEXT NOT NULL,        -- JSON 3 本。日内は固定 (リロードで問題が変わらない)
  extra_ids TEXT NOT NULL DEFAULT '[]'  -- 「もう 1 セット」の追加分
);
```

- **streak 定義**: その日の daily_sets の 3 本すべてに attempts がある日 = 達成。連続日数は attempts から都度計算 (JST)
- **孤児対策** (photos §6.1 の轍): ingest は incremental add のみ。episode/clip の削除は手動スクリプトで「DB 行 + media 実体」を集合差分で同時に消す (v0 は削除機能なしでよい、台帳に手順だけ書く)

## 3. パイプライン (pipeline/、v0 は手動実行)

実行順: `ingest.py → subs.py → clips.py` (`run_all.sh` で直列、nice 19 + ionice -c3。HDD/2 コア機で TV 視聴と競合させない)。

### 3.1 ingest.py

- `sources.json`: `[{"series":"tadc","title":"The Amazing Digital Circus","url":"<playlist url>"}, ...]`
- yt-dlp は **remote/dlqueue と同一実体 `~/bin/yt-dlp`・同一フォーマット文字列** (`bestvideo[height<=?720]+bestaudio/best[height<=?720]/best`、AVX1+HDD 自己 DoS 回避の実績値) を流用。720p 上限で確定 (残量 320GB 実測済、§8)
- 字幕: `--write-subs --sub-langs en` 優先、なければ `--write-auto-subs`。どちらを使ったか `sub_kind` に記録。**両方ないエピソードは「視聴専用」として登録** (clips を作らない、ライブラリでは見られる)
- 冪等: DB に同 id があれば skip。失敗は 1 回確定でログに残し、リトライ・stderr 文言分岐をしない (dlqueue 設計契約と同じ)
- ローカル持ち込み: `inbox/` に動画 + 同名 `.srt`/`.vtt` を置いて `ingest.py --inbox --series <slug>` → media へ移動 + 登録

### 3.2 subs.py — 字幕クリーニング

- 自動字幕 VTT のスクロール重複行 (直前 cue と同一文の再掲) を除去
- cue を文単位に結合/分割 (終端 `.?!` と 2.5s 以上のギャップで区切る)
- 出力: (a) プレイヤー用クリーン WebVTT (`media/subs/<id>.vtt`)、(b) clips.py 入力の文リスト (text, start, end)

### 3.3 clips.py — クリップ切り出し + 穴埋め生成

- 対象文: **4〜12 秒 かつ 5〜25 語** の文 (前後 0.3s パディング)。エピソードあたり最大 40 本 (等間隔サンプリング、上限は容量ガード)
- ffmpeg 再エンコード切り出し (正確なカット位置のため。夜間バッチなら本機 CPU で十分):
  `ffmpeg -ss <start> -to <end> -i <ep.mp4> -vf scale=-2:480 -c:v libx264 -preset veryfast -crf 26 -c:a aac -b:a 96k media/clips/<id>.mp4`
- **トークン化は空白 split の 1 方式のみ**。clips.py がここで確定した語配列を `clips.tokens` に保存し、`blanks.idx` はこの配列の添字。サーバ・UI は保存済み tokens を使い、text から再トークン化しない (規則ズレで空欄位置が壊れるのを防ぐ)
- **穴埋め対象の選定 (ルールベース、LLM 不使用)**: 文中の語のうち
  1. `wordlists/weak_forms.txt` に載る語 (gonna, wanna, gotta, kinda, can, can't, been, of, to, for, at, than, them, their, we're, you're, it's, its, ...) を最優先
  2. 次点で頻出 2000 語リスト内の語 (= user が「知らない単語」で詰まらない)
  3. 除外: 文中大文字始まり (固有名詞)、13 文字以上、数字
  - 1 クリップ **1〜3 空欄** (語数 ≤10 は 1、≤18 は 2、それ以上 3。空欄同士は 3 語以上離す)
- **誤答肢 (choices 4 択)**: `wordlists/confusions.json` の音韻混同ペア (can/can't, in/on/and, their/there/they're, of/off, to/too/two, ...) を優先し、不足分は同リスト内頻出語からランダム。正解位置はシャッフル
- 穴埋め候補が 1 つも取れない文はクリップ化しない

## 4. サーバ (server/app.py)

photos の app.py と同系の stdlib `ThreadingHTTPServer`。**HTTP Range は photos/server/app.py に実装済み (L34-82 相当) なのでそのまま流用可** — 新規に書く要素は API 層のみ。

### 4.1 配信

- `/` `/app.js` 等 静的: `Cache-Control: no-cache` (photos §6.3 の轍 = 版すれ違い対策)
- `/media/*`: **Range 対応必須** (`<video>` のシークに必要)。単一レンジのみ対応 (206 + Content-Range、不正は 416)。ファイルは id 命名で不変のため `Cache-Control: public, max-age=604800`
- パス正規化 + media ルート外 reject (realpath で 1 回確定、dlqueue §3.1 と同型)

### 4.2 API

| Method/Path | 内容 |
|---|---|
| GET `/api/home` | `{streak, today:{done,total,completed}, continue:{episode_id,title,position_s,duration_s}\|null, trend:[{date,acc}]×14}` |
| GET `/api/drill/today` | 今日のセット (daily_sets を引き、なければ生成して固定)。クリップごとに `{id, video_url, tokens:[...], blanks:[{idx,choices}]}` — **tokens の blank 位置は null に置換して返す** (原文語のまま返すと正解漏れ)。answer は answer API まで返さない |
| POST `/api/drill/answer` | `{clip_id, answers:[...], flags:[...], replays, duration_ms}` → 採点して attempts 記録、`{results:[bool], text, blanks:[{idx,answer}]}` を返す |
| POST `/api/drill/extra` | 「もう 1 セット」: 3 本追加して extra_ids に固定 |
| GET `/api/library` | series → episodes (+watch 状態) の一覧 |
| GET `/api/episodes/<id>` | 再生用詳細 (`video_url, sub_url, position_s`) |
| POST `/api/watch` | `{episode_id, position_s}` を 15 秒間隔 + pause 時に beacon。position_s は上書き、max_position_s は `max()` 更新。90% 到達で completed_at 設定 |
| POST `/api/comprehension` | `{episode_id, level:1..4}` (エピソード完了時ワンタップ、スキップ可) |

ドリル完了画面の streak 更新表示は `/api/home` を再取得して描画する (完了専用 API は作らない)。

### 4.3 出題選定 (server/drill.py、v0 ルールベース)

1. 対象プール = **視聴済み範囲内**のクリップ (`clip.end_s <= watch.max_position_s` または completed)。プールが空なら全クリップにフォールバック (最初のドリルが空にならない)
2. 3 本の内訳: 直近視聴エピソードから 1 本 + プール全体から 2 本。直近視聴エピソードに適格クリップが 0 本 (視聴専用エピソード等) ならプール全体から 3 本
3. 未出題を優先、なければ最終 attempt が古い順。同一クリップは同日重複させない。全クリップ数が 3 未満ならある分だけでセットを組む (today.total にその本数を返す)
4. 適応選定 (誤答特徴による重み付け) は v1。**v0 に賢さを入れない**

## 5. UI

画面構成・状態・デザイン制約は **`english-ui-brief.md`** (claude design 用ブリーフ、user が直接 claude design に渡せる自己完結文書) に分離。骨子のみ:

- 画面 4 枚: **ホーム** (今日のドリル / つづきを見る / streak + 14 日ミニグラフ) / **ドリル** (出題→答え合わせ→完了の 3 状態) / **ライブラリ** (シリーズ→エピソード) / **プレイヤー** (レジューム + 英語字幕トグル、デフォルト OFF)
- vanilla HTML/CSS/JS・ビルドなし・PWA-lite (manifest + ホーム画面追加。Service Worker は v0 では入れない = photos と同じ、キャッシュ版すれ違い回避)
- claude design の成果 (HTML モック) を受領後、`web/` に組み込むのは実装フェーズ

## 6. フェーズ分け

### v0 (最初に作り切る範囲 — これだけで毎日回る)

1. pipeline 3 スクリプト + wordlists (手動実行、教材は TADC など確実なもの 1 作品から)
2. server (静的 + API + Range) + systemd unit + tailscale serve 公開
3. UI 4 画面 (claude design モック → 組み込み)
4. streak + 正答率 14 日ミニグラフ
5. リモコン PWA にタイル追加
6. **ここで止めて 1〜2 週間、毎日使うか検証** (チャット版原則の継承)

### v1

- 夜間バッチ化 (systemd timer、03:00 + RandomizedDelay。新エピソード自動巡回)
- 入力式解答モード (設定でチップ式と切替)
- 弱点タグ集計 (weak_form / 速度帯別 正答率) + 統計画面、理解度推移
- 誤答ログによる出題重み付け (ルールベース)
- english.db を USB バックアップ運用に追加

### v2

- Whisper (faster-whisper small 以下、CPU) セカンドオピニオン → 字幕との不一致を「音の難所」フラグ
- チャンネル巡回の教材自動補充
- 適応難度 (WPM 徐々に上げる)

## 7. 非要件 (作らない)

- TTS 音声生成 / リアルタイム書き起こし / 厳密採点 (スペル・句読点)
- クラウド依存 (学習ループは全ローカル。LLM は夜間分析のみ可、v1 以降)
- TV 連携・mpv 連携 (remote と別軌道)、複数ユーザー・認証
- クリップの厳密な語アライメント (字幕タイムスタンプ精度で足りる)

## 8. 実装前チェックリスト (T-0 相当、着手時に実測)

- [x] `df -h` でディスク残量実測 — **2026-07-02 実測: 320GB 空き (457GB 中 115GB 使用)**。720p 全話 DL (Adventure Time 級 280 話でも 30〜50GB) は成立。フォーマットは dlqueue と同一の 720p 上限で確定
- [ ] `tailscale serve status` を **user 実行**で 8447 空きを実見 (photos ポストモーテム原則 1)
- [ ] yt-dlp で TADC 1 本実弾: 動画 + 手動字幕 (en) が取れるか、`sub_kind` 判定含め確認
- [ ] `<video>` + Range 配信 + WebVTT `<track>` を Pixel 6 実機ブラウザで縦切り確認 (最初の実装ステップ)
- [ ] 3 作品の公式可用性 Web 調査 (別チケット) → §0.5 に追記

## 9. リスクと設計判断

- **yt-dlp は YouTube 側変更で定期的に壊れる**: dlqueue と同一実体を使うため、更新・破損対応は dlqueue 側の churn 台帳運用に相乗りする (二重管理しない)
- **自動字幕の誤りは仕様**: 最終判断は user (「字幕怪しい」フラグ)。採点は緩い正規化 (小文字化・句読点無視・アポストロフィ正規化) 後の一致
- **穴埋め品質はルールベースの限界がある**: v0 は weak_forms + 頻出語 + 混同ペアで割り切る。品質不満が出たら v1 で夜間 LLM 選定を検討 (対症療法でリストを際限なく増やさない — 2 周目ルール対象)
- **1 回の短さを壊さない**: ホーム→ドリル完了まで タップ数最小 (目標: 起動 1 + 回答 3〜9 + 次へ 3)。機能追加時もこの動線に割り込ませない

---

**関連文書**: `english-ui-brief.md` (UI ブリーフ) / チケット #61 / photos `docs/postmortem.md` (独立アプリの轍) / `redesign/dlqueue-design.md` (yt-dlp 運用実績)
