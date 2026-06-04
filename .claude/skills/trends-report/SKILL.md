---
name: trends-report
description: 収集済みの AI 関連記事 JSON (new-items.json) を読み、テーマ別にクラスタリングして日本語でスマホでも読める分量の週次トレンドノート (report.md) を書き出す。Web 取得や長時間処理はしない。json を読んで md を書くだけ。companion-maintenance の trends-weekly.sh から claude -p で呼ばれる。
---

# trends-report — AI トレンド週次ノート整形

`scripts/trends-weekly.sh` が収集した記事 JSON を読み、その週の AI 技術トレンドを
日本語で要約した Obsidian ノート 1 枚に整形する。**json を読んで md を書くだけ** の
タスク。Web 取得・外部 API 呼び出し・長時間処理は一切しない。

## 入力 (prompt で渡される)

- **workdir**: 絶対パス。`<workdir>/new-items.json` が置かれている
- **isoweek**: ISO 週ラベル (例 `2026-W23`)
- **出力先**: `<workdir>/report.md`

prompt に上記 3 点が明記される。指定された出力先パスにだけ Write する
(vault への配置は shell が行う。このスキルは vault を触らない)。

## new-items.json の形

```json
{
  "items": [{"source": "...", "title": "...", "url": "...",
             "published": "ISO8601 または空", "summary": "プレーン要約"}],
  "failed_sources": ["収集に失敗したソース名", ...],
  "total_new": 件数
}
```

## 動作

1. `<workdir>/new-items.json` を Read する
2. `items` をテーマごとにクラスタリングする (例: 新モデル/リリース、エージェント・
   ツール、RAG・検索、開発手法・プロンプト、研究・論文、その他 — 記事の実内容に
   合わせて見出しは柔軟に決める。空のテーマ見出しは作らない)
3. 各記事の `title` + `summary` から日本語で 1〜2 行に要約する。`summary` が英語でも
   日本語に直す。憶測で内容を盛らない (summary に書かれていないことは足さない)
4. 指定された出力先 (`<workdir>/report.md`) に下記書式で Write する

## ノート書式

スマホの Obsidian で片手間に読める分量にする。長大にしない。

```markdown
---
tags: [ai-trends]
week: <isoweek>
created: <YYYY-MM-DD>
---

# <isoweek> AIトレンド

## 今週のまとめ

- (全体傾向を 2〜4 個の箇条書き。「今週何があったか / トレンドは何か」が
   一目で分かる粒度。個別記事の列挙ではなく俯瞰)

## 主なトピック

### <テーマ見出し>

- [<タイトル>](<url>) — <1〜2 行の日本語要約> (<ソース名>)
- ...

### <別テーマ見出し>

- ...

他 N 件
```

### 書式ルール

- **featured は最大 12〜15 件程度に絞る**。重要・新規性の高いものを優先して
  選び、残りは「主なトピック」末尾に `他 N 件` と件数だけ記す (全件列挙しない)
- 各記事行は `[タイトル](url) — 要約 (ソース名)` の形
- `## 今週のまとめ` は個別記事の羅列でなく、週全体の傾向を俯瞰した箇条書き
- `failed_sources` が空でなければノート末尾に小さく注記する:
  `> 収集できなかったソース: <カンマ区切り>`
- `<isoweek>` / `<YYYY-MM-DD>` は実値に置換する (created は今日の日付)

## 0 件のとき

`total_new` が 0 (= items が空) のケースは通常 shell 側で処理されこのスキルは
呼ばれない。万一 items が空で呼ばれた場合も、frontmatter + H1 +
`今週は新規の収集記事はありませんでした。` だけの最小ノートを書く
(failed_sources があれば注記も付ける)。エラーにはしない。
