"""
Google Takeout の登録チャンネルCSVを youtube-channels.json へマージする軽量ツール。

想定ユースケース:
- 姫が Google Takeout で「YouTube および YouTube Music」→「登録チャンネル」をエクスポート
- subscriptions.csv を入手
- このスクリプトで既存 JSON へ差分追記（channel_id で重複排除）

Takeout CSV の標準ヘッダ（2024年以降の仕様）:
    Channel Id, Channel Url, Channel Title

拡張CSV（ジャンル・好き度を姫がCSV上で設定したい場合）もサポート:
    channel_id, name, url, genre, favorite, check_days, note

使い方:
    python merge_takeout.py \\
        --csv /path/to/subscriptions.csv \\
        --out tasks/youtube-channels.json \\
        [--default-genre indie] \\
        [--default-favorite 3] \\
        [--default-check-days 3] \\
        [--dry-run]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import tempfile
from datetime import date, datetime
from pathlib import Path
from typing import Any

# Takeout 標準CSVのヘッダ候補（大文字小文字ゆらぎ対応）
TAKEOUT_ID_KEYS = ("Channel Id", "Channel ID", "channel_id", "channelId")
TAKEOUT_URL_KEYS = ("Channel Url", "Channel URL", "channel_url", "url")
TAKEOUT_TITLE_KEYS = ("Channel Title", "channel_title", "name", "title")

# 許可ジャンル（youtube-channels.json の genres キーと一致させる）
ALLOWED_GENRES = {"corporate_female", "corporate_male", "indie", "english"}

# YouTube の channel_id 正規表現: UC + [A-Za-z0-9_-]{22}
CHANNEL_ID_PATTERN = re.compile(r"^UC[0-9A-Za-z_-]{22}$")


def _pick(row: dict[str, str], keys: tuple[str, ...]) -> str:
    """CSVの行から候補キーのいずれかで値を取り出す。見つからなければ空文字。"""
    for key in keys:
        if key in row and row[key]:
            return row[key].strip()
    return ""


def load_existing_channels(path: Path) -> dict[str, Any]:
    """既存のチャンネルリストJSONを読み込む。"""
    if not path.exists():
        raise FileNotFoundError(f"既存JSONが見つからない: {path}")
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _iter_noncomment_lines(f: Any) -> Any:
    """`#` で始まる行（前後空白は無視）を読み飛ばすイテレータ。

    Python標準 `csv` モジュールは `#` をコメントとして扱わないため、
    テンプレCSVの書式説明行をスキップするための薄いラッパ。
    """
    for line in f:
        if line.lstrip().startswith("#"):
            continue
        yield line


def parse_takeout_csv(
    csv_path: Path,
    default_genre: str,
    default_favorite: int,
    default_check_days: int,
) -> tuple[list[dict[str, Any]], int]:
    """Takeout CSV（標準/拡張どちらも）を読み込んで channel オブジェクト配列に変換。

    Returns:
        (channelオブジェクト配列, 不正ID等でスキップした件数)
    """
    if not csv_path.exists():
        raise FileNotFoundError(f"CSVが見つからない: {csv_path}")

    parsed: list[dict[str, Any]] = []
    invalid_count = 0
    with csv_path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(_iter_noncomment_lines(f))
        for row in reader:
            channel_id = _pick(row, TAKEOUT_ID_KEYS)
            name = _pick(row, TAKEOUT_TITLE_KEYS) or channel_id or "(不明)"
            if not channel_id:
                # channel_id が無い行はスキップ（サイレント: 空行/欠損は想定内）
                continue
            if not CHANNEL_ID_PATTERN.fullmatch(channel_id):
                # UC + 22文字 の形式に合致しないIDは不正として弾く
                print(
                    f"[警告] channel_id の形式が不正なのでスキップ: {name} ({channel_id})",
                    file=sys.stderr,
                )
                invalid_count += 1
                continue
            # 拡張列（任意）
            genre_raw = _pick(row, ("genre",))
            if genre_raw and genre_raw not in ALLOWED_GENRES:
                print(
                    f"[警告] 未定義ジャンル '{genre_raw}' をデフォルト '{default_genre}' に置換: {name}",
                    file=sys.stderr,
                )
                genre = default_genre
            else:
                genre = genre_raw or default_genre
            favorite_raw = _pick(row, ("favorite",))
            try:
                favorite = int(favorite_raw) if favorite_raw else default_favorite
            except ValueError:
                favorite = default_favorite
            favorite = max(1, min(5, favorite))
            check_raw = _pick(row, ("check_days",))
            try:
                check_days = int(check_raw) if check_raw else default_check_days
            except ValueError:
                check_days = default_check_days
            note = _pick(row, ("note",))

            parsed.append({
                "name": name,
                "channel_id": channel_id,
                "check_days": check_days,
                "genre": genre,
                "favorite": favorite,
                "note": note,
            })
    return parsed, invalid_count


def merge(
    existing: dict[str, Any],
    incoming: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[str], list[str]]:
    """
    既存JSONに新規分をマージ。channel_id で重複判定、既存は上書きしない。

    Returns:
        (更新後のJSONオブジェクト, 追加された名前リスト, スキップされた名前リスト)
    """
    existing_channels = existing.get("channels", [])
    # 既存側に channel_id 欠損要素があっても突合を壊さないようフィルタする
    existing_ids = {ch.get("channel_id") for ch in existing_channels if ch.get("channel_id")}

    added: list[str] = []
    skipped: list[str] = []
    new_channels = list(existing_channels)

    for ch in incoming:
        cid = ch["channel_id"]
        if cid in existing_ids:
            skipped.append(ch["name"])
            continue
        new_channels.append(ch)
        existing_ids.add(cid)
        added.append(ch["name"])

    result = dict(existing)
    result["channels"] = new_channels
    if added:
        result["updated"] = date.today().isoformat()
    return result, added, skipped


def write_with_backup(path: Path, data: dict[str, Any]) -> tuple[Path, Path | None]:
    """アトミック書き込み＋タイムスタンプ付きバックアップでJSONを保存する。

    1. 既存ファイルがあれば `path.YYYYMMDD-HHMMSS.bak` にコピー（世代保持）
    2. 同一ディレクトリに一時ファイルを作り json.dump
    3. `os.replace` で原子的に差し替え（POSIXでは atomic rename 保証）

    Returns:
        (書き込まれたパス, 生成されたバックアップパス or None)
    """
    import shutil  # ローカル使用に限定（バックアップ時のみ）

    backup_path: Path | None = None
    if path.exists():
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_path = path.with_name(f"{path.name}.{timestamp}.bak")
        shutil.copy2(path, backup_path)

    # 同一ディレクトリに一時ファイルを作成（os.replace のアトミック性を担保）
    tmp = tempfile.NamedTemporaryFile(
        dir=str(path.parent),
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
        mode="w",
        encoding="utf-8",
    )
    tmp_path = Path(tmp.name)
    try:
        try:
            json.dump(data, tmp, ensure_ascii=False, indent=2)
            tmp.write("\n")
        finally:
            tmp.close()
        os.replace(tmp_path, path)
    except Exception:
        # 書き込み失敗時は一時ファイルを掃除してから例外を伝播
        try:
            if tmp_path.exists():
                os.unlink(tmp_path)
        except OSError:
            pass
        raise
    return path, backup_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Google Takeout の登録チャンネルCSVを youtube-channels.json へマージする"
    )
    parser.add_argument("--csv", required=True, type=Path, help="Takeout subscriptions.csv のパス")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[3] / "tasks" / "youtube-channels.json",
        help="マージ先のJSONパス（省略時はデフォルトの tasks/youtube-channels.json）",
    )
    parser.add_argument(
        "--default-genre",
        default="indie",
        choices=sorted(ALLOWED_GENRES),
        help="ジャンル未指定時のデフォルト",
    )
    parser.add_argument("--default-favorite", type=int, default=3, help="好き度の初期値 (1-5)")
    parser.add_argument("--default-check-days", type=int, default=3, help="巡回日数の初期値")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="ファイルに書き込まず、追加・スキップ件数のみ表示",
    )
    args = parser.parse_args(argv)

    try:
        existing = load_existing_channels(args.out)
    except FileNotFoundError as e:
        print(f"[エラー] {e}", file=sys.stderr)
        return 2

    try:
        incoming, invalid_count = parse_takeout_csv(
            args.csv,
            default_genre=args.default_genre,
            default_favorite=args.default_favorite,
            default_check_days=args.default_check_days,
        )
    except FileNotFoundError as e:
        print(f"[エラー] {e}", file=sys.stderr)
        return 2

    merged, added, skipped = merge(existing, incoming)

    print(f"CSV から {len(incoming)} 件読み込んだよ")
    print(
        f"追加: {len(added)} 件 / 重複スキップ: {len(skipped)} 件 / 不正IDスキップ: {invalid_count} 件"
    )
    if added:
        print("--- 追加されたチャンネル ---")
        for name in added:
            print(f"  + {name}")
    if skipped:
        print("--- 既存のためスキップ ---")
        for name in skipped[:10]:
            print(f"  = {name}")
        if len(skipped) > 10:
            print(f"  ...ほか {len(skipped) - 10} 件")

    if args.dry_run:
        print("[dry-run] ファイルは変更しなかったよ")
        return 0

    if not added:
        print("追加分が無かったので書き込みスキップ")
        return 0

    _, backup_path = write_with_backup(args.out, merged)
    print(f"書き込み完了: {args.out}")
    if backup_path is not None:
        print(f"バックアップ: {backup_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
