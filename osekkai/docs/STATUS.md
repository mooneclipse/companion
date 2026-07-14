# osekkai — 夜時間おせっかいシステム 開発台帳

平日 19:00〜24:00 の夜ブロックを対象に、意図 (今夜やりたいこと) → 行動 (PC 活動記録) → 振り返りのループを Telegram で低圧に伴走するシステム。

- **要件正本**: `~/companion/workspace/redesign/osekkai-requirements.md` (§3 は変更不可の合意事項)
- **実装計画正本**: `~/companion/workspace/redesign/osekkai-plan.md` v0.2 (2026-07-15 OWNER 承認済、設計判断 D-1〜D-9)
- **チケット**: #110 (Phase 1 実装) / #111 (OWNER 作業 = AW 導入 + topic 新設、#110 のブロッカー) / #112 (Phase 2 Android) / #113 (Phase 3 中間チェック・締切・フィルタ) / #114 (aw-server Bearer 認証リリース追随 watch)。#108 (要件受領〜計画承認) は 2026-07-15 完了

## 構成 (Phase 1 予定)

```
osekkai/
├── docs/STATUS.md            # この台帳
├── docs/SETUP-windows-aw.md  # [OWNER 作業] Windows ActivityWatch 導入手順書
├── scripts/                  # collector / trigger 判定スクリプト (実装時に作成)
├── systemd/                  # trigger timer 2 本 (実装時に作成)
└── data/                     # activity.db / backlog.json / tonight.json (git 管理外、実装時に .gitignore)
```

実行ログは `~/companion/logs/osekkai/` (repo 外、D-9)。

## 設計判断記録

### 2026-07-15: proactive 3 モードに相乗りしない (チケット #97 非該当の整理)

osekkai の対話は bot の **talk 型 (永続セッション、専用 topic)** で組み、既存 proactive 3 モード (investigate/ticket/remind) の 4 つ目としては追加しない。根拠: 3 モードは毎回新規 uuid の ephemeral session で「報告に OWNER が返信しても、その報告を見ていないセッションが resume される」構造 (bot.py 側に明記)。osekkai は「号令を覚えていて返信を受けて応答する」ことが要件 (§3-2/§3-5) なので構造的に噛み合わない。∴ #97「4 つ目のモード追加時は共通骨格括り出しを先に」のトリガーには**該当しない** (#97 は ephemeral trio の 5 関数トリオ重複が主題で、osekkai はそのコピペを増やさない)。CLAUDE.md 2 周目ルールの作法に基づく事前記録。

### 2026-07-15: ActivityWatch の窓稼働はスタック全体 (aw-qt 起動/停止) を採用

計画 v0.2 D-3 の「手順書作成時に確定」事項。**aw-qt (server + watcher 一式) を Windows タスクスケジューラで平日 19:00 起動 / 24:00 停止**とする。pull の機会は号令 (19 時台)・振り返り (23:30)・前夜分 backfill (翌 19 時台) のすべてが窓内で完結するため、server だけ常駐させても得るものは「日中に pull できる可能性」だけで、要件上日中は対象外 (§3-1)。常駐プロセスを増やさない方を取る。pull 失敗時は N3 + pending リトライで安全劣化 (計画どおり)。

## TODO (Phase 1、計画 §4 の番号)

- [ ] 1. **[OWNER 作業]** Windows (m-gamepc) に ActivityWatch 導入 — 手順書 `docs/SETUP-windows-aw.md` に従う (インストール / address 変更 / Firewall / タスクスケジューラ窓稼働)
- [ ] 2. **[OWNER 作業]** Telegram supergroup に osekkai 用 topic 新設 → thread_id を `bot/.env` の `BOT_THREAD_ID_OSEKKAI` に追加
- [ ] 4. collector: REST pull (query API、前回 pull 済み以降〜現在) + SQLite 蓄積 (蓄積前にタイトル破棄、exe 名+時間+AFK のみ、保持 90 日) + F3 要約器 — **着手条件: TODO 1 完了 (実 aw-server 相手に実装・検証するため)**
- [ ] 5. 意図ストア: backlog.json / tonight.json + flock+atomic write (ytcheck channel_store の型)
- [ ] 6. trigger: 平日 19 時台 (RandomizedDelay) + 23:30 の systemd timer 2 本 + 判定スクリプト (休むフラグ / 号令済み / 平日判定は state 1 read)
- [ ] 7. bot 側: proactive-v1 envelope の kind 追加 + osekkai topic の on_message 分岐 (専用 system prompt、短 timeout 個別指定、手動開始時の号令済みマーク) — **反映後は改変規模に応じた短い様子見 (PROJECT.md 条件 #2 再定義ルール)**
- [ ] 8. 実弾検証: 実際の夜ブロックを 1 周通す。完了条件 = 1 周通過 + OWNER が窮屈と感じないこと

(3. 台帳新設は本ファイルで完了)

## In progress

- (なし — TODO 1・2 の OWNER 作業待ち。4 以降は 1 完了後に着手)

## Done

- **2026-07-15**: Phase 1 着手 (チケット #110)。計画 v0.2 OWNER 承認 → `osekkai/` 台帳新設 + Windows AW 導入手順書 `docs/SETUP-windows-aw.md` 作成。設計判断 2 件 (proactive 非相乗り = #97 非該当、AW 窓稼働はスタック全体) を上記に記録
- **2026-07-14〜15** (チケット #108): 要件受領 (`osekkai-requirements.md`) → §6 前提確認 → §7 調査 (bot 配管 / ytcheck 部品 / ActivityWatch Web 一次情報) → 実装計画 v0.1〜v0.2 → OWNER 承認。経緯は計画正本の改版履歴参照

## 既知の問題

- (なし)

---

**最終更新**: 2026-07-15 (Phase 1 着手、台帳新設)
