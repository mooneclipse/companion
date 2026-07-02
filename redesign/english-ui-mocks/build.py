#!/usr/bin/env python3
"""english UI モック生成: 7 画面 x 3 バリエーション -> dist/*.html

自己完結 HTML (フォントは Google Fonts、CSS はインライン)。
共通マークアップ + BASE CSS (レイアウト骨格) + バリエーション CSS (トークン/性格) の 3 層。
出典ブリーフ: redesign/english-ui-brief.md
"""
import pathlib

OUT = pathlib.Path(__file__).parent / "dist"

# ---------------------------------------------------------------- sparkline
VALS = [67, 100, 33, 67, 100, 67, 33, 67, 67, 100, 67, 100, 67, 100]  # 直近14日 正答率
AVG = round(sum(VALS) / len(VALS))  # 74


def spark_bars():
    rects = []
    for i, v in enumerate(VALS):
        h = round(v * 0.38)
        cls = "bar today" if i == len(VALS) - 1 else "bar"
        rects.append(f'<rect class="{cls}" x="{i*10}" y="{40-h}" width="6" height="{h}" rx="1.5"/>')
    return f'<svg class="spark spark-bars" viewBox="0 0 136 40" aria-label="直近14日の正答率">{"".join(rects)}</svg>'


def spark_dots():
    dots = []
    for i, v in enumerate(VALS):
        cy = round(40 - v * 0.38, 1)
        cls = "dot today" if i == len(VALS) - 1 else "dot"
        dots.append(f'<circle class="{cls}" cx="{i*10+3}" cy="{cy}" r="2.4"/>')
    return f'<svg class="spark spark-dots" viewBox="0 0 136 40" aria-label="直近14日の正答率">{"".join(dots)}</svg>'


GRAPH = f'''<section class="graph-card card">
  <div class="graph-head"><span class="graph-label">正答率 · 直近 14 日</span><span class="graph-value">平均 {AVG}%</span></div>
  {spark_bars()}{spark_dots()}
</section>'''

# ---------------------------------------------------------------- 共通部品
HEADER = '''<header class="top">
  <div class="brand">耳ならし<span class="brand-sub">English Listening</span></div>
  <div class="streak" aria-label="連続12日"><span class="streak-num">12</span><span class="streak-label">日連続</span></div>
</header>'''

HEADER_EMPTY = '''<header class="top">
  <div class="brand">耳ならし<span class="brand-sub">English Listening</span></div>
</header>'''

CLIP = '''<div class="clip">
  <div class="clip-frame"><span class="play-ico"></span><span class="clip-time">00:04:12–00:04:19</span></div>
  <div class="clip-under"><span class="clip-hint">タップでもう一度聞く</span><span class="cue-meta">EP1 Pilot</span></div>
</div>'''

DRILL_TOP = '''<header class="drill-top">
  <button class="icon-btn" aria-label="やめる">×</button>
  <div class="drill-progress"><span class="dots"><i class="done"></i><i class="cur"></i><i></i></span><span class="num">2 / 3</span></div>
  <div class="speed-toggle"><button class="on">1.0x</button><button>0.75x</button></div>
</header>'''

# ---------------------------------------------------------------- ページ定義
PAGES = [
    ("01-home", "ホーム", "ホーム", f'''{HEADER}
<main>
  <section class="hero card">
    <p class="eyebrow">7月2日 (木)</p>
    <h1 class="hero-title">今日のドリル</h1>
    <p class="hero-meta">クリップ 3 本 · 約 2 分 · The Amazing Digital Circus</p>
    <button class="btn-primary">はじめる</button>
  </section>
  {GRAPH}
  <section class="resume-card card">
    <p class="eyebrow">つづきを見る</p>
    <div class="resume-row">
      <div class="thumb"><span>EP2</span></div>
      <div class="resume-info">
        <p class="resume-series">The Amazing Digital Circus</p>
        <p class="resume-title">Candy Carrier Chaos!</p>
        <div class="progress"><div class="progress-fill" style="width:62%"></div></div>
        <p class="resume-left">残り 5 分</p>
      </div>
    </div>
  </section>
  <a class="lib-link" href="#">ライブラリ — すべてのエピソード<span class="arrow">→</span></a>
</main>'''),

    ("02-home-empty", "ホーム", "ホーム (空状態)", f'''{HEADER_EMPTY}
<main>
  <section class="hero card empty">
    <h1 class="hero-title">教材がまだありません</h1>
    <p class="empty-copy">動画を取り込むと、ここに毎日 2〜3 分の<br>聞き取りドリルが並びます。</p>
    <button class="btn-primary">ライブラリへ</button>
  </section>
</main>'''),

    ("03-drill-question", "ドリル", "ドリル — 出題", f'''{DRILL_TOP}
{CLIP}
<div class="cloze">
  <p class="sentence">You’ve got to <span class="blank filled">look</span> on the <span class="blank current">&nbsp;</span> side!</p>
</div>
<div class="answer-area">
  <div class="chips">
    <button class="chip">bright</button><button class="chip">right</button>
    <button class="chip">light</button><button class="chip">night</button>
  </div>
  <button class="btn-check" disabled>答え合わせ</button>
</div>'''),

    ("04-drill-answer", "ドリル", "ドリル — 答え合わせ", f'''{DRILL_TOP}
{CLIP}
<div class="cloze">
  <p class="sentence">You’ve got to <span class="word ok">look</span> on the <span class="word ng">right<span class="fix">bright</span></span> side!</p>
</div>
<div class="answer-area">
  <div class="flags">
    <button class="flag">字幕が怪しい</button><button class="flag">聞き取れなかった</button>
  </div>
  <button class="btn-replay">もう一度聞く</button>
  <button class="btn-next">次へ</button>
</div>'''),

    ("05-drill-done", "ドリル", "ドリル — 完了", '''<main class="done">
  <section class="done-hero">
    <p class="eyebrow">今日のドリル · 完了</p>
    <p class="done-score"><span class="done-num">2</span><span class="done-frac">/ 3 正解</span></p>
    <p class="streak-update">連続 <span class="from">12</span><span class="arrow">→</span><span class="to">13</span> 日</p>
  </section>
  <div class="done-actions">
    <button class="btn-primary">ホームへ</button>
    <button class="btn-ghost">もう 1 セット</button>
    <a class="lib-link" href="#">つづきを見る — EP2 Candy Carrier Chaos!<span class="arrow">→</span></a>
  </div>
</main>'''),

    ("06-library", "ライブラリ", "ライブラリ", f'''{HEADER}
<main>
  <h1 class="page-title">ライブラリ</h1>
  <section class="series">
    <div class="series-head"><h2>The Amazing Digital Circus</h2><span class="series-meta">7 話</span></div>
    <div class="ep-row">
      <div class="ep-card"><div class="ep-thumb"><span>EP1</span></div><p class="ep-title">Pilot</p><p class="ep-state done">✓ 視聴済</p></div>
      <div class="ep-card"><div class="ep-thumb"><span>EP2</span></div><p class="ep-title">Candy Carrier Chaos!</p><div class="progress"><div class="progress-fill" style="width:62%"></div></div></div>
      <div class="ep-card"><div class="ep-thumb"><span>EP3</span></div><p class="ep-title">The Mystery of Mildenhall Manor</p><p class="ep-state">未視聴</p></div>
      <div class="ep-card"><div class="ep-thumb"><span>EP4</span></div><p class="ep-title">Fast Food Masquerade</p><p class="ep-state watchonly">視聴のみ</p></div>
    </div>
  </section>
  <section class="series">
    <div class="series-head"><h2>Bee and PuppyCat</h2><span class="series-meta">10 話</span></div>
    <div class="ep-row">
      <div class="ep-card"><div class="ep-thumb"><span>EP1</span></div><p class="ep-title">Food / Farm</p><p class="ep-state done">✓ 視聴済</p></div>
      <div class="ep-card"><div class="ep-thumb"><span>EP2</span></div><p class="ep-title">Beach / Cats</p><div class="progress"><div class="progress-fill" style="width:34%"></div></div></div>
      <div class="ep-card"><div class="ep-thumb"><span>EP3</span></div><p class="ep-title">Birthday</p><p class="ep-state">未視聴</p></div>
      <div class="ep-card"><div class="ep-thumb"><span>EP4</span></div><p class="ep-title">Dogs</p><p class="ep-state watchonly">視聴のみ</p></div>
    </div>
  </section>
  <section class="series pending">
    <div class="series-head"><h2>Bravest Warriors</h2><span class="series-meta">取込予定</span></div>
    <p class="pending-note">3 本目の教材候補。取り込むとここに並びます。</p>
  </section>
</main>'''),

    ("07-player", "プレイヤー", "プレイヤー", '''<div class="player">
  <div class="player-frame"><span class="pause-ico"></span></div>
  <div class="player-body">
    <p class="resume-series">The Amazing Digital Circus</p>
    <p class="player-title">EP2 — Candy Carrier Chaos!</p>
    <div class="scrub"><div class="progress"><div class="progress-fill" style="width:62%"></div></div>
      <div class="times"><span>08:12</span><span>13:05</span></div></div>
    <div class="player-controls">
      <button class="ctl" aria-label="10秒戻す">−10</button>
      <button class="ctl ctl-main" aria-label="再生"><span class="play-ico"></span></button>
      <button class="ctl" aria-label="10秒送る">+10</button>
    </div>
    <div class="subrow">
      <button class="toggle">1.0x</button>
      <button class="toggle off">字幕 EN · オフ</button>
    </div>
    <div class="overlay card">
      <p class="ovl-q">どのくらい聞き取れた?</p>
      <div class="emoji-row">
        <button class="emoji">😵</button><button class="emoji">🤔</button>
        <button class="emoji">🙂</button><button class="emoji">😎</button>
      </div>
      <button class="skip">あとで</button>
    </div>
  </div>
</div>'''),
]

# ---------------------------------------------------------------- BASE CSS (レイアウト骨格、性格を持たない)
BASE_CSS = '''
*{margin:0;padding:0;box-sizing:border-box}
button{font:inherit;color:inherit;background:none;border:none;cursor:pointer}
a{color:inherit;text-decoration:none}
body{background:#ececec;-webkit-font-smoothing:antialiased}
.phone{position:relative;width:412px;min-height:896px;margin:24px auto;background:var(--bg);color:var(--ink);overflow:hidden}
.top{display:flex;align-items:baseline;justify-content:space-between;padding:26px 24px 18px}
.brand{display:flex;flex-direction:column;gap:2px}
.streak{display:flex;align-items:baseline;gap:5px}
main{padding:0 24px 32px}
.card{margin-bottom:16px}
.hero{padding:24px 22px}
.btn-primary{display:block;width:100%;height:56px;margin-top:20px}
.graph-card{padding:18px 22px}
.graph-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px}
.spark{display:block;width:100%;height:44px}
.resume-card{padding:18px 22px}
.resume-row{display:flex;gap:14px;margin-top:12px}
.thumb{flex:0 0 104px;height:58px;display:flex;align-items:center;justify-content:center}
.resume-info{flex:1;min-width:0}
.progress{height:4px;width:100%;overflow:hidden}
.progress-fill{height:100%;background:var(--accent)}
.resume-info .progress{margin:8px 0 4px}
.lib-link{display:flex;justify-content:space-between;align-items:center;padding:16px 2px}
.empty .empty-copy{margin-top:10px;line-height:1.9}
/* drill */
.drill-top{display:flex;align-items:center;justify-content:space-between;padding:20px 20px 14px}
.icon-btn{width:36px;height:36px;font-size:20px;line-height:1}
.speed-toggle{display:flex}
.speed-toggle button{padding:7px 12px;font-size:12px}
.clip{padding:0 20px}
.clip-frame{position:relative;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center}
.clip-time{position:absolute;right:10px;bottom:8px;font-size:11px}
.clip-under{display:flex;justify-content:space-between;padding:8px 2px 0;font-size:12px}
.play-ico{display:block;width:0;height:0;border-style:solid;border-width:11px 0 11px 19px;border-color:transparent transparent transparent currentColor}
.pause-ico{display:block;width:18px;height:24px;border-left:6px solid currentColor;border-right:6px solid currentColor}
.cloze{margin:18px 20px}
.sentence{word-spacing:.05em}
.blank{display:inline-block;min-width:72px;text-align:center}
.word{display:inline-block}
.fix{margin-left:.45em}
.answer-area{position:absolute;left:0;right:0;bottom:0;padding:0 20px 26px}
.chips{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
.chip{height:52px}
.btn-check,.btn-next{display:block;width:100%;height:56px}
.flags{display:flex;gap:8px;margin-bottom:12px}
.flag{padding:8px 12px;font-size:12px}
.btn-replay{display:block;width:100%;height:48px;margin-bottom:10px}
/* done */
main.done{display:flex;flex-direction:column;min-height:896px;padding:0 24px}
.done-hero{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:14px}
.done-actions{padding-bottom:34px}
.btn-ghost{display:block;width:100%;height:48px;margin-top:10px}
/* library */
.page-title{margin:4px 0 18px}
.series{margin-bottom:26px}
.series-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px}
.ep-row{display:flex;gap:12px;overflow-x:auto;padding-bottom:6px;margin:0 -24px;padding-left:24px;padding-right:24px}
.ep-card{flex:0 0 128px;min-width:0}
.ep-thumb{height:72px;display:flex;align-items:center;justify-content:center;margin-bottom:8px}
.ep-title{font-size:12px;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.ep-state{font-size:11px;margin-top:4px}
.ep-card .progress{margin-top:6px}
.pending-note{font-size:12px;line-height:1.8}
/* player */
.player-frame{aspect-ratio:16/9;display:flex;align-items:center;justify-content:center}
.player-body{padding:18px 24px}
.player-title{margin:2px 0 14px}
.times{display:flex;justify-content:space-between;font-size:11px;margin-top:6px}
.player-controls{display:flex;align-items:center;justify-content:center;gap:26px;margin:22px 0 14px}
.ctl{width:56px;height:56px;display:flex;align-items:center;justify-content:center}
.ctl-main{width:68px;height:68px}
.subrow{display:flex;justify-content:center;gap:10px}
.toggle{padding:8px 14px;font-size:12px}
.overlay{margin-top:26px;padding:18px 20px;text-align:center}
.emoji-row{display:flex;justify-content:center;gap:12px;margin:14px 0 10px}
.emoji{width:52px;height:52px;font-size:24px;display:flex;align-items:center;justify-content:center}
.skip{font-size:12px}
'''

# ---------------------------------------------------------------- Variant A 「字幕」
CSS_A = '''
:root{--bg:#fbfbf9;--ink:#191a1e;--muted:#6c6d73;--line:#e5e4df;--accent:#d8392a;--ok:#2e7d4f;
--jp:"Noto Sans JP",sans-serif;--disp:"Archivo",sans-serif;--mono:"IBM Plex Mono",monospace}
.phone{font-family:var(--jp);font-size:14px}
.brand{font-weight:700;font-size:17px}
.brand-sub{font-family:var(--mono);font-size:8.5px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);font-weight:400}
.top{border-bottom:1px solid var(--line)}
.streak-num{font-family:var(--disp);font-weight:700;font-size:22px}
.streak-label{font-family:var(--mono);font-size:10px;color:var(--muted)}
main{padding-top:22px}
.eyebrow{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.card{background:none;border-bottom:1px solid var(--line);padding-left:0;padding-right:0}
.hero{border-top:2px solid var(--ink);padding-top:18px}
.hero-title{font-size:28px;font-weight:700;margin:8px 0 6px}
.hero-meta{font-family:var(--mono);font-size:11.5px;color:var(--muted)}
.btn-primary{background:var(--accent);color:#fff;border-radius:4px;font-size:15px;font-weight:700;letter-spacing:.06em}
.graph-label{font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;color:var(--muted)}
.graph-value{font-family:var(--disp);font-weight:700;font-size:17px}
.spark-dots{display:none}
.bar{fill:#d6d5cf}.bar.today{fill:var(--accent)}
.resume-series{font-family:var(--mono);font-size:10px;letter-spacing:.08em;color:var(--muted);text-transform:uppercase}
.resume-title{font-weight:500;font-size:14px;margin-top:2px}
.thumb{background:#131418;color:#fff;font-family:var(--mono);font-size:12px;border-radius:3px}
.progress{background:var(--line)}
.resume-left{font-family:var(--mono);font-size:10.5px;color:var(--muted)}
.lib-link{font-weight:500;font-size:13.5px}
.lib-link .arrow{font-family:var(--disp)}
.empty{border-top:2px solid var(--ink)}
.empty-copy{color:var(--muted);font-size:13px}
/* drill */
.drill-top{border-bottom:1px solid var(--line)}
.icon-btn{color:var(--muted)}
.drill-progress .dots{display:none}
.drill-progress .num{font-family:var(--mono);font-size:13px}
.speed-toggle{border:1px solid var(--line);border-radius:4px;overflow:hidden}
.speed-toggle button{font-family:var(--mono);color:var(--muted)}
.speed-toggle .on{background:var(--ink);color:#fff}
.clip{margin-top:20px}
.clip-frame{background:#131418;color:#8b8e96;border-radius:4px}
.clip-time{font-family:var(--mono);color:#9aa0a6}
.clip-hint{color:var(--muted)}
.cue-meta{font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;color:var(--muted);text-transform:uppercase}
/* 署名: 字幕ストリップ */
.cloze{background:#101115;border-radius:4px;padding:22px 20px 24px;margin-top:16px}
.sentence{font-family:var(--disp);font-weight:600;font-size:21px;line-height:1.75;color:#fff}
.blank{border-bottom:2px solid var(--accent);min-height:1.2em}
.blank.filled{color:#fff}
.blank.current{background:rgba(216,57,42,.18);outline:1px solid var(--accent);outline-offset:2px;border-radius:2px}
.word.ok{color:#8fd6a8;border-bottom:2px solid #8fd6a8}
.word.ng{color:#ff9887;text-decoration:line-through;text-decoration-thickness:2px}
.fix{color:#8fd6a8;text-decoration:none;display:inline-block;border-bottom:2px solid #8fd6a8}
.chip{background:#f1f0ec;border:1px solid var(--line);border-radius:4px;font-family:var(--disp);font-weight:500;font-size:16px}
.btn-check{background:var(--accent);color:#fff;border-radius:4px;font-weight:700;letter-spacing:.06em}
.btn-check:disabled{background:#e7e6e2;color:#a6a5a0}
.flag{border:1px solid var(--line);border-radius:4px;font-family:var(--mono);font-size:11px;color:var(--muted)}
.btn-replay{border:1px solid var(--ink);border-radius:4px;font-weight:500}
.btn-next{background:var(--accent);color:#fff;border-radius:4px;font-weight:700;letter-spacing:.06em}
/* done */
.done-score{font-family:var(--disp)}
.done-num{font-weight:700;font-size:88px;line-height:1}
.done-frac{font-size:20px;color:var(--muted);margin-left:8px}
.streak-update{font-family:var(--mono);font-size:14px}
.streak-update .to{color:var(--accent);font-weight:700}
.streak-update .arrow{margin:0 .5em;color:var(--muted)}
.btn-ghost{border:1px solid var(--line);border-radius:4px;color:var(--muted)}
.done .lib-link{justify-content:center;gap:8px;font-size:12.5px;color:var(--muted)}
/* library */
.page-title{font-size:24px;font-weight:700;border-top:2px solid var(--ink);padding-top:16px}
.series-head h2{font-size:15.5px;font-weight:700}
.series-meta{font-family:var(--mono);font-size:10.5px;color:var(--muted)}
.series{border-bottom:1px solid var(--line);padding-bottom:20px}
.ep-thumb{background:#131418;color:#fff;font-family:var(--mono);font-size:12px;border-radius:3px}
.ep-state{font-family:var(--mono);color:var(--muted)}
.ep-state.done{color:var(--ok)}
.ep-state.watchonly{color:var(--muted);border:1px solid var(--line);display:inline-block;padding:1px 6px;border-radius:3px}
.pending .ep-thumb{opacity:.4}
.pending-note{color:var(--muted)}
/* player */
.player-frame{background:#131418;color:#fff}
.scrub .progress{background:#e0dfda}
.times{font-family:var(--mono);color:var(--muted)}
.player-title{font-size:17px;font-weight:700}
.ctl{border:1px solid var(--line);border-radius:50%;font-family:var(--mono);font-size:12px}
.ctl-main{background:var(--ink);color:#fff;border:none}
.toggle{border:1px solid var(--line);border-radius:4px;font-family:var(--mono);color:var(--ink)}
.toggle.off{color:var(--muted)}
.overlay{border:1px solid var(--line);background:#fff;border-radius:4px;box-shadow:0 8px 24px rgba(20,20,25,.08);padding:18px 20px}
.ovl-q{font-weight:700;font-size:14px}
.emoji{border:1px solid var(--line);border-radius:4px;background:#fbfbf9}
.skip{font-family:var(--mono);color:var(--muted)}
'''

# ---------------------------------------------------------------- Variant B 「学習帳」
CSS_B = '''
:root{--bg:#faf7f0;--ink:#2b261e;--muted:#8b8175;--line:#e6ddcd;--accent:#d8392a;--ok:#3f7d54;
--jp:"Noto Sans JP",sans-serif;--min:"Shippori Mincho",serif;--en:"Newsreader",serif}
.phone{font-family:var(--jp);font-size:13.5px}
.top{flex-direction:column;align-items:center;gap:10px;padding-top:34px;border-bottom:3px double var(--line);padding-bottom:20px}
.brand{align-items:center;font-family:var(--min);font-weight:600;font-size:20px;letter-spacing:.3em;text-indent:.3em}
.brand-sub{font-family:var(--en);font-style:italic;font-size:10px;letter-spacing:.28em;color:var(--muted);text-indent:.28em}
.streak{align-items:baseline}
.streak-num{font-family:var(--min);font-weight:600;font-size:21px}
.streak-label{font-size:11px;color:var(--muted)}
.streak::after{content:"";width:7px;height:7px;border-radius:50%;background:var(--accent);align-self:center;margin-left:7px}
main{padding-top:26px}
.eyebrow{font-size:11px;letter-spacing:.4em;color:var(--muted)}
.hero{text-align:center;padding-top:14px}
.hero-title{font-family:var(--min);font-weight:600;font-size:27px;margin:12px 0 10px}
.hero-meta{font-size:11.5px;color:var(--muted);letter-spacing:.06em}
.btn-primary{background:var(--accent);color:#fff;border-radius:2px;font-size:14.5px;font-weight:500;letter-spacing:.35em;text-indent:.35em}
.card{border-bottom:1px solid var(--line);padding-left:0;padding-right:0;padding-bottom:24px;margin-bottom:22px}
.graph-label{font-size:11px;letter-spacing:.18em;color:var(--muted)}
.graph-value{font-family:var(--min);font-weight:600;font-size:16px}
.spark-bars{display:none}
.spark-dots{background:repeating-linear-gradient(to bottom,transparent 0 10px,var(--line) 10px 11px)}
.dot{fill:#b6ab99}.dot.today{fill:var(--accent)}
.resume-series{font-family:var(--en);font-style:italic;font-size:12px;color:var(--muted)}
.resume-title{font-family:var(--min);font-weight:600;font-size:15px;margin-top:2px}
.thumb{background:#efe7d8;color:var(--muted);font-family:var(--en);font-size:13px}
.progress{background:var(--line)}
.resume-left{font-size:10.5px;color:var(--muted)}
.lib-link{font-family:var(--min);font-size:13.5px;letter-spacing:.08em;justify-content:center;gap:10px}
.empty-copy{color:var(--muted);font-size:13px}
/* drill */
.drill-top{border-bottom:1px solid var(--line);padding-top:24px}
.icon-btn{color:var(--muted)}
.drill-progress .dots{display:none}
.drill-progress .num{font-family:var(--min);font-size:14px;letter-spacing:.1em}
.speed-toggle button{color:var(--muted);border-bottom:2px solid transparent}
.speed-toggle .on{color:var(--ink);border-bottom:2px solid var(--accent)}
.clip{margin-top:22px}
.clip-frame{background:#2b261e;color:#cfc6b6;border-radius:2px}
.clip-time{font-family:var(--en);color:#cfc6b6}
.clip-hint{color:var(--muted)}
.cue-meta{font-family:var(--en);font-style:italic;font-size:11.5px;color:var(--muted)}
/* 署名: 罫線ノート */
.cloze{margin-top:26px;padding:0 4px}
.sentence{font-family:var(--en);font-size:24px;line-height:46px;background:repeating-linear-gradient(to bottom,transparent 0 45px,var(--line) 45px 46px)}
.blank{border-bottom:2px solid var(--accent)}
.blank.filled{color:var(--ink)}
.blank.current{position:relative}
.blank.current::after{content:"▲";position:absolute;left:50%;transform:translateX(-50%);top:100%;font-size:9px;color:var(--accent)}
.word.ok{color:var(--ok);border-bottom:2px solid var(--ok)}
.word.ng{color:var(--accent);text-decoration:line-through}
.fix{color:var(--ok);font-style:italic;border-bottom:2px solid var(--ok)}
.chip{background:#fff;border:1px solid var(--line);border-radius:2px;font-family:var(--en);font-size:18px}
.btn-check{background:var(--accent);color:#fff;border-radius:2px;font-weight:500;letter-spacing:.3em;text-indent:.3em}
.btn-check:disabled{background:#ddd3c2;color:#a89d8c}
.flag{border:1px solid var(--line);border-radius:2px;font-size:11px;color:var(--muted);background:#fff}
.btn-replay{border:1px solid var(--ink);border-radius:2px;letter-spacing:.2em;text-indent:.2em}
.btn-next{background:var(--accent);color:#fff;border-radius:2px;font-weight:500;letter-spacing:.3em;text-indent:.3em}
/* done */
.done-hero{gap:18px}
.done-score{font-family:var(--min)}
.done-num{font-weight:600;font-size:84px;line-height:1}
.done-frac{font-size:19px;color:var(--muted);margin-left:10px}
.streak-update{font-family:var(--min);font-size:15px;letter-spacing:.1em}
.streak-update .to{color:var(--accent);font-weight:700}
.streak-update .arrow{margin:0 .5em;color:var(--muted)}
.btn-ghost{border:1px solid var(--line);border-radius:2px;color:var(--muted);letter-spacing:.2em;text-indent:.2em}
.done .lib-link{font-size:12.5px;color:var(--muted)}
/* library */
.page-title{font-family:var(--min);font-weight:600;font-size:23px;text-align:center;letter-spacing:.2em;text-indent:.2em;margin-bottom:24px}
.series-head{border-bottom:1px solid var(--line);padding-bottom:8px}
.series-head h2{font-family:var(--min);font-weight:600;font-size:15px}
.series-meta{font-size:10.5px;color:var(--muted);letter-spacing:.1em}
.ep-thumb{background:#efe7d8;color:var(--muted);font-family:var(--en);font-size:13px}
.ep-title{font-family:var(--en);font-size:12.5px}
.ep-state{color:var(--muted)}
.ep-state.done{color:var(--ok)}
.ep-state.watchonly{border:1px solid var(--line);display:inline-block;padding:1px 7px}
.pending .pending-note{color:var(--muted)}
/* player */
.player-frame{background:#2b261e;color:#efe7d8}
.player-title{font-family:var(--min);font-weight:600;font-size:17px}
.scrub .progress{background:var(--line)}
.times{font-family:var(--en);color:var(--muted)}
.ctl{border:1px solid var(--line);border-radius:50%;font-family:var(--en);font-size:13px;background:#fff}
.ctl-main{background:var(--ink);color:#faf7f0;border:none}
.toggle{border:1px solid var(--line);background:#fff;border-radius:2px}
.toggle.off{color:var(--muted)}
.overlay{border:1px solid var(--line);background:#fff;border-radius:2px;padding:18px 20px 24px}
.ovl-q{font-family:var(--min);font-weight:600;font-size:14.5px;letter-spacing:.15em}
.emoji{border:1px solid var(--line);border-radius:50%;background:var(--bg)}
.skip{color:var(--muted);letter-spacing:.2em}
'''

# ---------------------------------------------------------------- Variant C 「ラウンド」
CSS_C = '''
:root{--bg:#fffdf7;--card:#ffffff;--ink:#37301f;--muted:#83765e;--line:#ecdfc8;--accent:#d8392a;
--accent-soft:#fdf0ec;--ok:#3c9a63;--ok-soft:#e2f3e8;--r:20px;
--jp:"M PLUS Rounded 1c",sans-serif}
.phone{font-family:var(--jp);font-size:14px}
.brand{font-weight:800;font-size:18px}
.brand-sub{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);font-weight:700}
.streak{flex-direction:column;align-items:center;gap:0;width:52px;height:52px;border:2.5px solid var(--accent);border-radius:50%;justify-content:center}
.streak-num{font-weight:800;font-size:19px;line-height:1.1}
.streak-label{font-size:8px;color:var(--muted);font-weight:700}
main{padding-top:8px}
.card{background:var(--card);border:2px solid var(--line);border-radius:var(--r)}
.eyebrow{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.08em}
.hero-title{font-weight:800;font-size:25px;margin:8px 0 6px}
.hero-meta{font-size:12px;color:var(--muted);font-weight:500}
.btn-primary{background:var(--accent);color:#fff;border-radius:30px;font-size:16px;font-weight:800;box-shadow:0 4px 0 #b02c1f}
.graph-label{font-size:11px;font-weight:700;color:var(--muted)}
.graph-value{font-weight:800;font-size:17px}
.spark-dots{display:none}
.bar{fill:#eadfc4}.bar.today{fill:var(--accent)}
.resume-series{font-size:10.5px;font-weight:700;color:var(--muted)}
.resume-title{font-weight:700;font-size:14px;margin-top:2px}
.thumb{background:#3a3547;color:#fff;font-weight:800;font-size:13px;border-radius:12px}
.progress{background:#f2ead9;border-radius:2px}
.progress-fill{border-radius:2px}
.resume-left{font-size:10.5px;color:var(--muted);font-weight:500}
.lib-link{font-weight:700;font-size:14px}
.empty-copy{color:var(--muted)}
/* drill */
.icon-btn{background:#f5eedd;border-radius:50%;color:var(--muted);font-weight:700}
.drill-progress .num{display:none}
.drill-progress .dots{display:flex;gap:7px}
.drill-progress .dots i{width:11px;height:11px;border-radius:50%;background:#eadfc4;display:block}
.drill-progress .dots i.done{background:var(--ok)}
.drill-progress .dots i.cur{background:var(--accent);transform:scale(1.25)}
.speed-toggle{background:#f5eedd;border-radius:20px;padding:3px}
.speed-toggle button{border-radius:16px;font-weight:700;color:var(--muted)}
.speed-toggle .on{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(60,48,20,.15)}
.clip{margin-top:12px}
.clip-frame{background:#3a3547;color:#fff;border-radius:var(--r)}
.clip-time{font-weight:700;background:rgba(0,0,0,.45);padding:2px 7px;border-radius:9px}
.clip-hint{color:var(--muted);font-weight:500}
.cue-meta{color:var(--muted);font-weight:700;font-size:11px}
.cloze{background:var(--card);border:2px solid var(--line);border-radius:var(--r);padding:20px 18px;margin-top:16px}
.sentence{font-weight:700;font-size:20px;line-height:2}
.blank{border:2px dashed var(--line);border-radius:10px;padding:1px 8px;background:var(--bg)}
.blank.filled{border-style:solid;color:var(--ink)}
.blank.current{border:2px solid var(--accent);background:var(--accent-soft)}
.word.ok{background:var(--ok-soft);color:var(--ok);border-radius:8px;padding:1px 8px;font-weight:800}
.word.ng{background:var(--accent-soft);color:var(--accent);border-radius:8px;padding:1px 8px;text-decoration:line-through;font-weight:800}
.fix{background:var(--ok-soft);color:var(--ok);border-radius:8px;padding:1px 8px;text-decoration:none;font-weight:800}
.chip{background:var(--card);border:2px solid var(--line);border-radius:26px;font-weight:800;font-size:16px}
.chip:active{border-color:var(--accent)}
.btn-check{background:var(--accent);color:#fff;border-radius:28px;font-weight:800;font-size:16px;box-shadow:0 4px 0 #b02c1f}
.btn-check:disabled{background:#eadfc4;color:#b3a37e;box-shadow:0 4px 0 #d8c9a4}
.flag{border:2px solid var(--line);border-radius:16px;font-weight:700;color:var(--muted);background:var(--card)}
.btn-replay{border:2px solid var(--ink);border-radius:26px;font-weight:800}
.btn-next{background:var(--accent);color:#fff;border-radius:28px;font-weight:800;font-size:16px;box-shadow:0 4px 0 #b02c1f}
/* done */
.done-score{color:var(--ink)}
.done-num{font-weight:800;font-size:92px;line-height:1}
.done-frac{font-size:20px;color:var(--muted);font-weight:700;margin-left:8px}
.streak-update{font-weight:800;font-size:16px;background:var(--accent-soft);color:var(--accent);padding:8px 18px;border-radius:20px}
.streak-update .arrow{margin:0 .4em}
.btn-ghost{border:2px solid var(--line);border-radius:26px;color:var(--muted);font-weight:700}
.done .lib-link{justify-content:center;gap:8px;font-size:12.5px;color:var(--muted)}
/* library */
.page-title{font-weight:800;font-size:23px}
.series-head h2{font-weight:800;font-size:16px}
.series-meta{font-size:11px;color:var(--muted);font-weight:700}
.ep-thumb{background:#3a3547;color:#fff;font-weight:800;border-radius:14px}
.ep-title{font-weight:700}
.ep-state{color:var(--muted);font-weight:700}
.ep-state.done{color:var(--ok)}
.ep-state.watchonly{background:#f5eedd;display:inline-block;padding:2px 8px;border-radius:9px}
.pending-note{color:var(--muted);font-weight:500}
/* player */
.player-frame{background:#3a3547;color:#fff;border-radius:0 0 var(--r) var(--r)}
.player-title{font-weight:800;font-size:17px}
.times{color:var(--muted);font-weight:700}
.ctl{border:2px solid var(--line);border-radius:50%;font-weight:800;background:var(--card)}
.ctl-main{background:var(--accent);color:#fff;border:none;box-shadow:0 4px 0 #b02c1f}
.toggle{border:2px solid var(--line);border-radius:18px;font-weight:700;background:var(--card)}
.toggle.off{color:var(--muted)}
.overlay{box-shadow:0 8px 20px rgba(60,48,20,.1)}
.ovl-q{font-weight:800;font-size:15px}
.emoji{background:var(--bg);border:2px solid var(--line);border-radius:50%}
.emoji:active{border-color:var(--accent)}
.skip{color:var(--muted);font-weight:700}
'''

# ---------------------------------------------------------------- Variant D 「融合」= A の骨格 + ドリルだけ C の可読性
# CSS_A に後勝ちで重ねる。ホーム/ライブラリ/プレイヤーは A のまま、ドリル系クラスのみ上書き。
CSS_D_EXTRA = '''
/* D: 進行はドット表示 (C 由来)、数字は隠す */
.drill-progress .num{display:none}
.drill-progress .dots{display:flex;gap:7px}
.drill-progress .dots i{width:10px;height:10px;border-radius:50%;background:#dddcd6;display:block}
.drill-progress .dots i.done{background:var(--ok)}
.drill-progress .dots i.cur{background:var(--accent);transform:scale(1.25)}
/* D: 字幕ストリップをやめ、白カード + 枠付き空欄スロット (C 由来) を A のトーンで */
.cloze{background:#fff;border:1px solid var(--line);border-radius:8px;padding:22px 18px}
.sentence{color:var(--ink);font-size:22px;line-height:2.05}
.blank{border:1.5px dashed #c6c5bf;border-radius:8px;padding:2px 10px;background:var(--bg);min-width:80px}
.blank.filled{border-style:solid;border-color:var(--ink);color:var(--ink)}
.blank.current{border:2px solid var(--accent);border-radius:8px;background:rgba(216,57,42,.06);outline:none}
/* D: 正誤は淡色塗り (C 由来) を落ち着いた彩度で */
.word.ok{color:#276b44;background:#e3f0e8;border-radius:6px;padding:2px 8px;border-bottom:none}
.word.ng{color:var(--accent);background:#faeae7;border-radius:6px;padding:2px 8px;text-decoration:line-through;text-decoration-thickness:2px}
.fix{color:#276b44;background:#e3f0e8;border-radius:6px;padding:2px 8px;text-decoration:none;border-bottom:none}
/* D: 選択チップと主ボタンは大きく明瞭に、ただし角は控えめ */
.chips{gap:12px}
.chip{height:56px;background:#fff;border:1.5px solid #d5d4ce;border-radius:10px;font-size:17px}
.btn-check{border-radius:8px}
.btn-replay{border-radius:8px}
.btn-next{border-radius:8px}
'''

FONTS = {
    "a": '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">',
    "b": '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">',
    "c": '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;500;700;800&display=swap" rel="stylesheet">',
}
FONTS["d"] = FONTS["a"]

VARIANTS = {
    "a": ("A 字幕", CSS_A),
    "b": ("B 学習帳", CSS_B),
    "c": ("C ラウンド", CSS_C),
    "d": ("D 融合 A×C", CSS_A + CSS_D_EXTRA),
}

TEMPLATE = '''<!-- @dsCard group="{group}" name="{name}" viewport="460x944" -->
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{name}</title>
{fonts}
<style>{base}{vcss}</style>
</head>
<body>
<div class="phone p-{slug}">
{body}
</div>
</body>
</html>
'''


def main():
    OUT.mkdir(exist_ok=True)
    for slug, group, title, body in PAGES:
        for v, (vlabel, vcss) in VARIANTS.items():
            html = TEMPLATE.format(
                group=group, name=f"{title} — {vlabel}", fonts=FONTS[v],
                base=BASE_CSS, vcss=vcss, slug=slug, body=body)
            path = OUT / f"{slug}-{v}.html"
            path.write_text(html, encoding="utf-8")
            print(path.name)


if __name__ == "__main__":
    main()
