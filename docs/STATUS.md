# companion-remote 開発台帳（フェーズ外単発ユーティリティ: スマホ専用リモコン PWA）

最終更新: 2026-05-20 (ローカル git のみ (rollback 専用) で先行 git 化 / 設計議論未着手)

## 概要

スマホ (Pixel-6、Tailnet 同居) から Linux Mint 機 (miho-inspiron-3521) を「専用リモコン」として叩くための PWA + 配信サーバ。Discord アプリのアカウント切替制約を回避し、companion 機専用 UI で素早く操作することが目的。

- 用途: 専用リモコン (素早い open → 操作 → close)
- 対象ユーザ: miho 個人のみ (完全個人利用、家族端末・外部公開なし)
- ネットワーク境界: Tailscale 内のみ (Tailnet 外には絶対に出さない)
- 不要なもの: push 通知 / スマホハード機能 / マルチユーザ / 外部配布

## 位置付け

PROJECT.md の Phase 1〜4 ロードマップとは独立した **フェーズ外の単発ユーティリティ** (dashboard と同じ扱い)。Phase 1〜2.5 (土管 + 耐久化) の上に乗り、bot.py / bot.service / voice/ の既存資産には触らない設計目標。

- Phase 2.5 健全性 2 週間観察 (2026-05-19 〜 2026-06-02) と独立に進行可能 (bot.py 改変なし前提)
- voice/ 側 bot/ 実装着手 (2026-06 上旬目処) とも独立 (干渉せず)
- 「ロードマップ本流の Phase 4 着手条件 #2」のカウントには影響させない

## 設計議論

確定設計はまだない。**設計議論 brief**: `~/companion/workspace/redesign/remote-design.md`

議論は agent teams (`companion-remote-design`) で実施予定。役割案・open questions・着手前 user 判断項目はすべて brief 側に集約。

## ディレクトリ構成（着手時に確定、現状はプレースホルダ）

```
remote/
├── docs/STATUS.md         # 本ファイル
└── (議論完了後に拡張)
    ├── server/            # FastAPI または同等の HTTP サーバ
    ├── web/               # PWA 静的アセット (HTML/JS/CSS, manifest, service worker)
    ├── systemd/           # systemd user service (起動常駐)
    ├── .env.example       # トークン等 (.env は .gitignore)
    └── .gitignore
```

git の扱い (2026-05-20 更新): まず **(C) ローカル git のみ (remote なし、rollback 専用)** で先行 git 化済み (`.gitignore` + gitleaks フック + 初回 commit)。設計議論段階の改稿を rollback できる状態にするのが目的。**(B) GitHub バックアップ付きへの昇格** (= `remote add` + `push`) は voice/ パターンに揃え「実装着手と同時、設計議論完了後」に判断する。git 化 3 階層の定義は `~/companion/CLAUDE.md` git 運用方針 / `workspace/PROJECT.md`「git 化の 3 階層」参照。

## TODO

- [ ] 設計議論 (`workspace/redesign/remote-design.md` v0.1 → 確定版)
  - agent team `companion-remote-design` で Architect / UX / Security / Devil's advocate 役割で議論
  - 着手前 user 判断項目 (q-1 ~ open questions) を brief 側に列挙、user 回答を待つ
- [ ] 確定設計後、本台帳に「サブタスク分割」section を追加して実装着手

## In progress

(なし)

## Done

- 2026-05-20 `remote/` をローカル git のみ (remote なし、rollback 専用) で先行 git 化
  - **背景**: companion 配下 git 化を 3 階層に整理 ((C) ローカルのみ新設)。設計議論段階の `docs/STATUS.md` / 今後の設計メモの改稿を rollback できるよう先行導入
  - **やったこと**: `git init -b main` + user 設定 + gitleaks pre-commit フック配置 + `.gitignore` 作成 + `gitleaks dir` で no leaks 確認 + 初回 commit。**GitHub remote は意図的に付けない**
  - (B) GitHub バックアップ付きへの昇格は実装着手時に判断 (上「git の扱い」参照)

## 既知の問題

(なし)

## 運用注記

- **Tailscale funnel は絶対に叩かない** (外部公開コマンド、誤発射防止のため `.claude/settings.json` で deny 済)
- サーバは `127.0.0.1` バインドのみ、外向き口は `tailscale serve` 経由だけ
- スマホ紛失時の revoke 手順は Tailscale 管理画面 + アプリ層トークン無効化 endpoint で対応 (詳細は実装後に追記)
