"""Test package marker.

注意: `unittest discover -s tests` は各テストファイルを top-level module
として import するため、この __init__.py は実行されない (2026-06-12 実測)。
テスト共通のセットアップはここに置かず各テストファイル側に置くこと
(本番 bot.log への混入防止は test_bot.py `_import_bot_with_stub_env` の
handler 除去で対応済み)。
"""
