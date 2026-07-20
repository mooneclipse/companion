# マインロード モンスタースプライト生成 (16x16 ドット絵 → x4 = 64x64 PNG)。
# 自作(原作 jp.windbellrrr.app.minerroad の画像は転用しない方針のため)。手持ちの
# Kenney CC0 素材(Roguelike Characters 等)にはモンスター/敵素材が含まれていないことを
# 2026-07-20 調査で確認済み(既存 chars = miner/girl は Kenney、モンスターのみ自作の混在)。
# 画風は既存 chars (Kenney Roguelike Characters 切り出し) に合わせる:
# フラット彩色・黒アウトラインなし・落ち着いた彩度。モンスターは寒色系 (既存の視認性設計)。
#
# 実行: python3 tools/gen-monster-sprites.py web/assets/monsters
# 出力: <outdir>/{bat,slime,slime_half,snake,worm,spider}.png + _preview.png(確認用シート)
from PIL import Image
import sys

# 記号 → 色。'.' = 透明。スプライトごとに使う記号を選ぶ。
PALETTES = {
    "bat": {  # コウモリ: 灰茶の翼 + 耳。
        "w": "#6b5b73",  # 翼 濃
        "W": "#8a7a91",  # 翼 淡
        "b": "#4a3f52",  # 胴
        "e": "#d8d0e0",  # 目/牙
        "r": "#b0485a",  # 口
    },
    "slime": {  # スライム: 青緑ブロブ。
        "s": "#3f8a80",  # 本体
        "S": "#5fb0a2",  # 明部
        "d": "#2e6b64",  # 底の影
        "e": "#e8f4ee",  # ハイライト/目
        "k": "#1f4a45",  # 目玉
    },
    "slime_half": {  # 小スライム: 淡めの小ブロブ。
        "s": "#5a9a8e",
        "S": "#7cbcae",
        "d": "#417d73",
        "e": "#eef8f2",
        "k": "#2a5c54",
    },
    "snake": {  # ヘビ: くすんだ緑のとぐろ + 鎌首。
        "g": "#5c7d3f",  # 胴 濃
        "G": "#7d9c58",  # 胴 明
        "y": "#c9c26a",  # 腹/模様
        "e": "#e8e4d0",  # 目
        "k": "#2f3a22",  # 瞳
        "r": "#b0485a",  # 舌
    },
    "worm": {  # ミミズ: くすんだ桃の節体。
        "p": "#b07a86",  # 本体
        "P": "#cc99a2",  # 明部
        "d": "#8a5a68",  # 節の影
        "e": "#3a2a30",  # 目(点)
    },
    "spider": {  # クモ: 暗紫茶 + 8 脚。
        "b": "#4f3f5a",  # 胴 濃
        "B": "#6d5878",  # 胴 明
        "l": "#3a2f44",  # 脚
        "e": "#d8cc60",  # 目(黄)
        "m": "#8a3a4a",  # 背模様
    },
}

SPRITES = {
    "bat": [
        "................",
        "................",
        "................",
        "..w..........w..",
        "..ww...bb...ww..",
        ".wwww.bbbb.wwww.",
        ".wWWwwbbbbwwWWw.",
        "wwWWwwbebbwwWWww",
        "wwwwwbbbbbbwwwww",
        ".www.bbrrbb.www.",
        "..w..bebbeb..w..",
        "......bbbb......",
        ".......bb.......",
        "................",
        "................",
        "................",
    ],
    "slime": [
        "................",
        "................",
        "................",
        "................",
        "......SSss......",
        "....SSSSssss....",
        "...SSeeSSssss...",
        "...SeeSSssssss..",
        "..SSeSSsssssss..",
        "..SSskssskssss..",
        "..Sssksssksssd..",
        "..ssssssssssdd..",
        "..ssskkkksssdd..",
        "...dddddddddd...",
        "................",
        "................",
    ],
    "slime_half": [
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "......SSss......",
        ".....SSssss.....",
        "....Seessss.....",
        "....SeSsssss....",
        "....Ssksskss....",
        "....ssssssssd...",
        "....sssssssdd...",
        ".....dddddd.....",
        "................",
        "................",
    ],
    "snake": [
        "................",
        "................",
        "....GGg.........",
        "...GGGGg........",
        "...Gekeg........",
        "...GGGGg........",
        "....rGGg........",
        "....r.GGg.......",
        "......GGgg......",
        ".....gGGggg.....",
        "...gGGyyGGgg....",
        "..gGGyyyyGGgg...",
        "..gGyyGGyyGgg...",
        "..ggGGggGGggg...",
        "...gggggggggg...",
        "................",
    ],
    "worm": [
        "................",
        "................",
        "................",
        "................",
        "................",
        "......PPpp......",
        ".....PPpppp.....",
        "....PPpdppppd...",
        "....Pepd..ppd...",
        "....Ppd...ppd...",
        "....ppd...ppd...",
        "...dppd..dppd...",
        "..dpppd.dpppdd..",
        "..ddddd.ddddd...",
        "................",
        "................",
    ],
    "spider": [
        "................",
        "................",
        "................",
        "..l...l..l...l..",
        "..l..ll..ll..l..",
        "..ll.l.BB.l.ll..",
        "...lllBBBBlll...",
        "....lBBmmBBl....",
        "....BBmBBmBB....",
        "...lBBBBBBBBl...",
        "..ll.BebbeB.ll..",
        "..l..lbbbbl..l..",
        "..l.ll....ll.l..",
        "....l......l....",
        "................",
        "................",
    ],
}


def hex_to_rgba(h):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


def build(name, outdir):
    grid = SPRITES[name]
    pal = {k: hex_to_rgba(v) for k, v in PALETTES[name].items()}
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for y, rowstr in enumerate(grid):
        assert len(rowstr) == 16, (name, y, len(rowstr))
        for x, ch in enumerate(rowstr):
            if ch == ".":
                continue
            im.putpixel((x, y), pal[ch])
    big = im.resize((64, 64), Image.NEAREST)
    big.save(f"{outdir}/{name}.png")
    return big


if __name__ == "__main__":
    outdir = sys.argv[1] if len(sys.argv) > 1 else "."
    names = list(SPRITES)
    sheet = Image.new("RGBA", (68 * len(names), 68), (30, 30, 34, 255))
    for i, n in enumerate(names):
        big = build(n, outdir)
        sheet.paste(big, (68 * i + 2, 2), big)
    sheet = sheet.resize((sheet.size[0] * 2, sheet.size[1] * 2), Image.NEAREST)
    sheet.save(f"{outdir}/_preview.png")
    print("ok:", ", ".join(names))
