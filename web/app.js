/* companion-english — フロントエンド (D 案モックの SPA 化)。
   hash ルーティング (#home / #drill / #library / #ep/<id>)。
   DOM は createElement のみ (innerHTML 不使用 = XSS 安全 / photos・remote 慣習)。
   server/app.py の実装 (server/drill.py の応答形状) を一次情報として確認済みの契約に合わせている。 */
"use strict";

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const SPEED_LABELS = { 1: "1.0x", 0.75: "0.75x", 1.25: "1.25x" };

const state = {
  drill: null,       // ドリルセッションの作業状態 (#drill 滞在中のみ有効)
  watchTimer: null,   // プレイヤー画面の視聴位置送信タイマー
  watchCleanup: null, // プレイヤー画面を離れる時の後片付け
};

// ── DOM ヘルパ ──
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ── フォーマット ──
function fmtEyebrowDate(d) {
  d = d || new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日 (${WD[d.getDay()]})`;
}
function fmtClock(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
function fmtHMS(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// ── 通信 ──
async function getJSON(path) {
  let res;
  try {
    res = await fetch(path);
  } catch (e) {
    throw new Error("サーバーに接続できません。english サーバーが起動しているか確認してください。");
  }
  if (!res.ok) throw new Error(`サーバーがエラーを返しました (${res.status})。しばらくしてからやり直してください。`);
  return res.json();
}
async function postJSON(path, body) {
  // body 未指定 (例: /api/drill/extra) では Content-Type/body を一切付けない。
  // サーバー側でリクエストボディを読まないハンドラに body を送ると、HTTP/1.1 keep-alive の
  // 接続上で未読バイトが次のリクエストの先頭に混入する既知の不具合があるため (server 側に報告済み)。
  const hasBody = body !== undefined;
  let res;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: hasBody ? { "Content-Type": "application/json" } : {},
      body: hasBody ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error("サーバーに接続できません。english サーバーが起動しているか確認してください。");
  }
  if (!res.ok) throw new Error(`サーバーがエラーを返しました (${res.status})。しばらくしてからやり直してください。`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
function postWatch(episodeId, positionS) {
  const payload = JSON.stringify({ episode_id: episodeId, position_s: positionS });
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/watch", new Blob([payload], { type: "application/json" }));
  } else {
    fetch("/api/watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
  }
}
function renderError(container, err) {
  container.replaceChildren();
  container.append(el("div", "error-box", err && err.message ? err.message : String(err)));
}
function clearWatchTimer() {
  if (state.watchTimer) { clearInterval(state.watchTimer); state.watchTimer = null; }
  if (state.watchCleanup) { state.watchCleanup(); state.watchCleanup = null; }
}

// ══════════════════════════ ホーム ══════════════════════════
async function renderHome() {
  clearWatchTimer();
  const app = $("app");
  app.replaceChildren(el("div", "loading", "読み込み中…"));
  let home;
  try { home = await getJSON("/api/home"); }
  catch (e) { renderError(app, e); return; }

  const today = home.today || { done: 0, total: 0, completed: false };
  const isEmpty = !today.total;
  app.replaceChildren();

  const top = el("header", "top");
  const brand = el("div", "brand");
  brand.append(document.createTextNode("KIKITORI"), el("span", "brand-sub", "English Listening"));
  top.append(brand);
  if (!isEmpty) {
    const streak = el("div", "streak");
    streak.setAttribute("aria-label", `連続${home.streak}日`);
    streak.append(el("span", "streak-num", String(home.streak)), el("span", "streak-label", "日連続"));
    top.append(streak);
  }
  app.append(top);

  const main = el("main");

  if (isEmpty) {
    const hero = el("section", "hero card empty");
    hero.append(el("h1", "hero-title", "教材がまだありません"));
    const copy = el("p", "empty-copy");
    copy.append(
      document.createTextNode("動画を取り込むと、ここに毎日 2〜3 分の"),
      document.createElement("br"),
      document.createTextNode("聞き取りドリルが並びます。"),
    );
    hero.append(copy);
    const cta = el("a", "btn-primary", "ライブラリへ");
    cta.href = "#library";
    hero.append(cta);
    main.append(hero);
    app.append(main);
    return;
  }

  const hero = el("section", "hero card");
  hero.append(el("p", "eyebrow", fmtEyebrowDate()));
  if (today.completed) {
    hero.append(el("h1", "hero-title", "今日のドリル達成"));
    hero.append(el("p", "hero-meta", `${today.done} / ${today.total} 本 完了`));
    const extra = el("button", "btn-ghost", "もう 1 セット");
    extra.addEventListener("click", async () => {
      try { await postJSON("/api/drill/extra"); }
      catch (e) { renderError(main, e); return; }
      location.hash = "#drill";
    });
    hero.append(extra);
  } else {
    hero.append(el("h1", "hero-title", "今日のドリル"));
    hero.append(el("p", "hero-meta", `クリップ ${today.total} 本`));
    const start = el("a", "btn-primary", "はじめる");
    start.href = "#drill";
    hero.append(start);
  }
  main.append(hero);

  const trend = Array.isArray(home.trend) ? home.trend : [];
  if (trend.length) main.append(renderTrendGraph(trend));

  // 傾向と対策 (夜間 analyze.py の analysis 最新 1 行)。行が無ければカード自体を出さない (v0 挙動)。
  if (home.analysis && home.analysis.report_md) main.append(renderReportCard(home.analysis));

  if (home.continue) main.append(renderResumeCard(home.continue));

  const libLink = el("a", "lib-link");
  libLink.href = "#library";
  libLink.append(document.createTextNode("ライブラリ — すべてのエピソード"), el("span", "arrow", "→"));
  main.append(libLink);

  app.append(main);
}

function renderTrendGraph(trend) {
  const gc = el("section", "graph-card card");
  const head = el("div", "graph-head");
  head.append(el("span", "graph-label", "正答率 · 直近 14 日"));
  const accs = trend.map((t) => (typeof t.acc === "number" ? t.acc : null)).filter((a) => a !== null);
  const avg = accs.length ? Math.round((accs.reduce((a, b) => a + b, 0) / accs.length) * 100) : 0;
  head.append(el("span", "graph-value", accs.length ? `平均 ${avg}%` : "記録なし"));
  gc.append(head);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "spark");
  svg.setAttribute("viewBox", `0 0 ${Math.max(trend.length * 10 - 4, 6)} 40`);
  svg.setAttribute("aria-label", "直近14日の正答率");
  trend.forEach((t, i) => {
    // acc:null は「その日は attempts が無い」(0% とは別物、server/drill.py compute_trend の契約)。
    // 高さ0にして「データなし」を「実際に0%だった」から視覚的に区別する。
    const hasData = typeof t.acc === "number";
    const h = hasData ? Math.max(4, t.acc * 38) : 0;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("class", i === trend.length - 1 ? "bar today" : "bar");
    rect.setAttribute("x", String(i * 10));
    rect.setAttribute("y", String(40 - h));
    rect.setAttribute("width", "6");
    rect.setAttribute("height", String(h));
    rect.setAttribute("rx", "1.5");
    svg.append(rect);
  });
  gc.append(svg);
  return gc;
}

function renderReportCard(analysis) {
  const rc = el("section", "report-card card");
  const head = el("div", "graph-head");
  head.append(el("span", "graph-label", "傾向と対策"));
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(analysis.date || "");
  let meta = m ? `${Number(m[2])}月${Number(m[3])}日` : "";
  // fallback (ルールベース定型文) は控えめに区別する。llm 時は日付のみ
  if (analysis.source === "fallback") meta = meta ? `${meta} · 定型` : "定型";
  if (meta) head.append(el("span", "report-date", meta));
  rc.append(head);
  const body = el("p", "report-body");
  String(analysis.report_md).split("\n").forEach((line, i) => {
    if (i) body.append(document.createElement("br"));
    body.append(document.createTextNode(line));
  });
  rc.append(body);
  return rc;
}

function renderResumeCard(cont) {
  const rc = el("a", "resume-card card");
  rc.href = `#ep/${cont.episode_id}`;
  rc.append(el("p", "eyebrow", "つづきを見る"));
  const row = el("div", "resume-row");
  const thumb = el("div", "thumb", "▶");
  row.append(thumb);
  const info = el("div", "resume-info");
  info.append(el("p", "resume-title", cont.title || "エピソード"));
  const dur = typeof cont.duration_s === "number" ? cont.duration_s : 0;
  const pos = typeof cont.position_s === "number" ? cont.position_s : 0;
  const pct = dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0;
  const prog = el("div", "progress");
  const fill = el("div", "progress-fill");
  fill.style.width = pct + "%";
  prog.append(fill);
  info.append(prog);
  if (dur > 0) {
    const remain = Math.max(1, Math.round((dur - pos) / 60));
    info.append(el("p", "resume-left", `残り ${remain} 分`));
  }
  row.append(info);
  rc.append(row);
  return rc;
}

// ══════════════════════════ ドリル ══════════════════════════
async function renderDrill() {
  clearWatchTimer();
  const app = $("app");
  app.replaceChildren(el("div", "loading", "読み込み中…"));

  let home, today;
  try {
    [home, today] = await Promise.all([getJSON("/api/home"), getJSON("/api/drill/today")]);
  } catch (e) { renderError(app, e); return; }

  const clips = Array.isArray(today.clips) ? today.clips : [];
  if (!clips.length) {
    app.replaceChildren();
    const main = el("main");
    main.append(el("p", "empty-copy", "今日のドリルはまだありません。ライブラリで動画を視聴すると出題対象が増えます。"));
    const link = el("a", "btn-primary", "ホームへ");
    link.href = "#home";
    main.append(link);
    app.append(main);
    return;
  }

  // clip.done (今日すでに回答済みか) を見て、未回答の先頭から再開する。
  // 全部回答済みなら新規に答えるものが無いので、その場で案内する。
  const startIdx = clips.findIndex((c) => !c.done);
  if (startIdx === -1) {
    app.replaceChildren();
    const main = el("main");
    main.append(el("p", "empty-copy", "今日のドリルはこのセットぶん全部回答済みです。"));
    const home2 = el("a", "btn-primary", "ホームへ");
    home2.href = "#home";
    main.append(home2);
    const extra = el("button", "btn-ghost", "もう 1 セット");
    extra.addEventListener("click", async () => {
      try { await postJSON("/api/drill/extra"); }
      catch (e) { renderError(main, e); return; }
      renderDrill(); // 既に #drill なので hashchange は発火しない。直接呼んで再フェッチする
    });
    main.append(extra);
    app.append(main);
    return;
  }

  state.drill = {
    clips, idx: startIdx, streakBefore: home.streak, correctClips: 0, speed: 1,
  };
  startDrillClip();
}

function startDrillClip() {
  const d = state.drill;
  d.selections = {};
  d.blankIdxs = d.clips[d.idx].blanks.map((b) => b.idx).sort((a, b) => a - b);
  d.currentIdx = d.blankIdxs[0];
  d.replays = 0;
  d.playCount = 0;
  d.startedAt = Date.now();
  d.phase = "question";
  renderDrillPhase();
}
function renderDrillPhase() {
  const d = state.drill;
  if (d.phase === "answer") renderDrillAnswer();
  else renderDrillQuestion();
}

function drillProgressDots(d) {
  const wrap = el("div", "drill-progress");
  const dots = el("span", "dots");
  d.clips.forEach((_, i) => {
    const dot = document.createElement("i");
    if (i < d.idx) dot.className = "done";
    else if (i === d.idx) dot.className = "cur";
    dots.append(dot);
  });
  wrap.append(dots);
  return wrap;
}
function speedToggle() {
  const d = state.drill;
  const wrap = el("div", "speed-toggle");
  [1, 0.75].forEach((rate) => {
    const btn = el("button", rate === d.speed ? "on" : "", SPEED_LABELS[rate]);
    btn.addEventListener("click", () => {
      d.speed = rate;
      const v = $("clipVideo");
      if (v) v.playbackRate = rate;
      renderDrillPhase();
    });
    wrap.append(btn);
  });
  return wrap;
}
function clipFrame(clip) {
  const wrap = el("div", "clip");
  const frame = el("div", "clip-frame");
  const video = document.createElement("video");
  video.id = "clipVideo";
  video.src = clip.video_url;
  video.playsInline = true;
  video.preload = "metadata";
  video.playbackRate = state.drill.speed;
  video.style.display = "none"; // 再生開始まではアイコンのみ (タップ再生、自動再生はブラウザ制約で不可)
  const playIco = el("span", "play-ico");
  frame.append(video, playIco);
  if (typeof clip.start_s === "number" && typeof clip.end_s === "number") {
    frame.append(el("span", "clip-time", `${fmtHMS(clip.start_s)}–${fmtHMS(clip.end_s)}`));
  }

  const playClip = () => {
    video.style.display = "block";
    playIco.style.display = "none";
    video.currentTime = 0;
    video.play().catch(() => {});
    if (state.drill.playCount > 0) state.drill.replays++;
    state.drill.playCount++;
  };
  frame.addEventListener("click", playClip);
  video.addEventListener("ended", () => { video.style.display = "none"; playIco.style.display = ""; });
  wrap.append(frame);

  const under = el("div", "clip-under");
  under.append(el("span", "clip-hint", "タップでもう一度聞く"));
  if (clip.episode_title) under.append(el("span", "cue-meta", clip.episode_title));
  wrap.append(under);

  // 本編内の位置バー (#72): クリップがエピソードのどのあたりかをマーカーで示す
  const dur = clip.episode_duration_s;
  if (typeof clip.start_s === "number" && typeof clip.end_s === "number" && typeof dur === "number" && dur > 0) {
    const pos = el("div", "ep-pos");
    const track = el("div", "ep-pos-track");
    const mark = el("i", "ep-pos-mark");
    const widthPct = Math.max(2, ((clip.end_s - clip.start_s) / dur) * 100);
    const leftPct = Math.max(0, Math.min((clip.start_s / dur) * 100, 100 - widthPct));
    mark.style.left = `${leftPct}%`;
    mark.style.width = `${widthPct}%`;
    track.append(mark);
    pos.append(track);
    pos.append(el("span", "ep-pos-label", `本編 ${fmtClock(clip.start_s)} / ${fmtClock(dur)}`));
    wrap.append(pos);
  }
  return { wrap, video, playClip };
}

function renderSentenceQuestion(clip, d) {
  const p = el("p", "sentence");
  const blankByIdx = new Map(clip.blanks.map((b) => [b.idx, b]));
  clip.tokens.forEach((tok, i) => {
    if (i > 0) p.append(document.createTextNode(" "));
    if (blankByIdx.has(i)) {
      const span = el("span", "blank");
      const chosen = d.selections[i];
      if (chosen !== undefined) { span.classList.add("filled"); span.textContent = chosen; }
      else { span.textContent = " "; }
      if (i === d.currentIdx) span.classList.add("current");
      span.addEventListener("click", () => { d.currentIdx = i; renderDrillQuestion(); });
      p.append(span);
    } else {
      p.append(document.createTextNode(tok));
    }
  });
  return p;
}

function renderDrillQuestion() {
  const d = state.drill;
  const clip = d.clips[d.idx];
  const app = $("app");
  app.replaceChildren();

  const screen = el("div", "drill-screen");
  const top = el("header", "drill-top");
  const close = el("a", "icon-btn", "×");
  close.href = "#home"; close.setAttribute("aria-label", "やめる");
  top.append(close, drillProgressDots(d), speedToggle());
  screen.append(top);

  const clipBox = clipFrame(clip);
  screen.append(clipBox.wrap);

  const cloze = el("div", "cloze");
  cloze.append(renderSentenceQuestion(clip, d));
  screen.append(cloze);

  const area = el("div", "answer-area");
  const chips = el("div", "chips");
  const blankDef = clip.blanks.find((b) => b.idx === d.currentIdx);
  (blankDef ? blankDef.choices : []).forEach((choice) => {
    const chip = el("button", "chip", choice);
    chip.addEventListener("click", () => {
      d.selections[d.currentIdx] = choice;
      const remain = d.blankIdxs.filter((i) => d.selections[i] === undefined);
      if (remain.length) d.currentIdx = remain[0];
      renderDrillQuestion();
    });
    chips.append(chip);
  });
  area.append(chips);

  const allFilled = d.blankIdxs.every((i) => d.selections[i] !== undefined);
  const checkBtn = el("button", "btn-check", "答え合わせ");
  checkBtn.disabled = !allFilled;
  checkBtn.addEventListener("click", submitDrillAnswer);
  area.append(checkBtn);
  screen.append(area);
  app.append(screen);
}

async function submitDrillAnswer() {
  const d = state.drill;
  const clip = d.clips[d.idx];
  const answers = d.blankIdxs.map((i) => d.selections[i]);
  const durationMs = Date.now() - d.startedAt;
  let resp;
  try {
    resp = await postJSON("/api/drill/answer", {
      clip_id: clip.id, answers, flags: [], replays: d.replays, duration_ms: durationMs,
    });
  } catch (e) { renderError($("app"), e); return; }

  d.lastResult = resp;
  d.attemptId = resp.attempt_id; // reveal 後に選ぶ flags は POST /api/drill/flag で後送りする
  d.phase = "answer";
  d.answerFlags = new Set();
  if (Array.isArray(resp.results) && resp.results.every(Boolean)) d.correctClips++;
  renderDrillAnswer();
}

function renderSentenceAnswer(clip, d, resp) {
  const p = el("p", "sentence");
  const blankByIdx = new Map(clip.blanks.map((b) => [b.idx, b]));
  const answerByIdx = new Map((resp.blanks || []).map((b) => [b.idx, b.answer]));
  clip.tokens.forEach((tok, i) => {
    if (i > 0) p.append(document.createTextNode(" "));
    if (blankByIdx.has(i)) {
      const order = d.blankIdxs.indexOf(i);
      const correct = Array.isArray(resp.results) ? !!resp.results[order] : false;
      const answerText = answerByIdx.get(i) || "";
      const chosenText = d.selections[i] || "";
      const span = el("span", correct ? "word ok" : "word ng", correct ? answerText : chosenText);
      if (!correct) span.append(el("span", "fix", answerText));
      p.append(span);
    } else {
      p.append(document.createTextNode(tok));
    }
  });
  return p;
}

function renderDrillAnswer() {
  const d = state.drill;
  const clip = d.clips[d.idx];
  const resp = d.lastResult;
  const app = $("app");
  app.replaceChildren();

  const screen = el("div", "drill-screen");
  const top = el("header", "drill-top");
  const close = el("a", "icon-btn", "×");
  close.href = "#home"; close.setAttribute("aria-label", "やめる");
  top.append(close, drillProgressDots(d), speedToggle());
  screen.append(top);

  const clipBox = clipFrame(clip);
  screen.append(clipBox.wrap);

  const cloze = el("div", "cloze");
  cloze.append(renderSentenceAnswer(clip, d, resp));
  if (resp.translation) cloze.append(el("p", "translation", resp.translation));
  screen.append(cloze);

  // エピソードのドリル消化状況 (#72): 全問回答済みになったら通し視聴の目安を出す
  const prog = resp.episode_progress;
  if (prog && typeof prog.attempted === "number" && typeof prog.total === "number" && prog.total > 0) {
    const complete = prog.attempted >= prog.total;
    const cov = el("div", complete ? "ep-coverage complete" : "ep-coverage");
    const epName = clip.episode_title || "このエピソード";
    const label = complete
      ? `${epName} の全 ${prog.total} 問 回答済み — 通しで見てOK`
      : `${epName} の問題 ${prog.attempted} / ${prog.total} 回答済み`;
    cov.append(el("span", "ep-coverage-label", label));
    const bar = el("div", "progress");
    const fill = el("div", "progress-fill");
    fill.style.width = `${Math.min(100, Math.round((prog.attempted / prog.total) * 100))}%`;
    bar.append(fill);
    cov.append(bar);
    screen.append(cov);
  }

  const area = el("div", "answer-area");
  const flags = el("div", "flags");
  [["sub_suspect", "字幕が怪しい"], ["unheard", "聞き取れなかった"]].forEach(([key, label]) => {
    const btn = el("button", "flag", label);
    btn.setAttribute("aria-pressed", String(d.answerFlags.has(key)));
    btn.addEventListener("click", () => {
      if (d.answerFlags.has(key)) d.answerFlags.delete(key); else d.answerFlags.add(key);
      renderDrillAnswer(); // 楽観的に即再描画。送信は裏で行い、失敗してもドリル進行は止めない
      if (d.attemptId != null) {
        postJSON("/api/drill/flag", { attempt_id: d.attemptId, flags: [...d.answerFlags] }).catch(() => {});
      }
    });
    flags.append(btn);
  });
  area.append(flags);

  const replayBtn = el("button", "btn-replay", "もう一度聞く");
  replayBtn.addEventListener("click", () => clipBox.playClip());
  area.append(replayBtn);

  const nextBtn = el("button", "btn-next", "次へ");
  nextBtn.addEventListener("click", () => {
    if (d.idx < d.clips.length - 1) { d.idx++; startDrillClip(); }
    else renderDrillDone();
  });
  area.append(nextBtn);
  screen.append(area);
  app.append(screen);
}

async function renderDrillDone() {
  const d = state.drill;
  const app = $("app");
  app.replaceChildren(el("div", "loading", "読み込み中…"));
  let homeAfter;
  try { homeAfter = await getJSON("/api/home"); }
  catch (e) { renderError(app, e); return; }

  app.replaceChildren();
  const main = el("main", "done");
  const hero = el("section", "done-hero");
  hero.append(el("p", "eyebrow", "今日のドリル · 完了"));
  const score = el("p", "done-score");
  score.append(el("span", "done-num", String(d.correctClips)), el("span", "done-frac", `/ ${d.clips.length} 正解`));
  hero.append(score);
  const upd = el("p", "streak-update");
  upd.append(
    document.createTextNode("連続 "), el("span", "from", String(d.streakBefore)),
    el("span", "arrow", "→"), el("span", "to", String(homeAfter.streak)),
    document.createTextNode(" 日"),
  );
  hero.append(upd);
  main.append(hero);

  const actions = el("div", "done-actions");
  const home = el("a", "btn-primary", "ホームへ");
  home.href = "#home";
  actions.append(home);
  const extra = el("button", "btn-ghost", "もう 1 セット");
  extra.addEventListener("click", async () => {
    try { await postJSON("/api/drill/extra"); }
    catch (e) { renderError($("app"), e); return; }
    // 既に #drill 上にいるため location.hash="#drill" は hashchange を発火しない。直接呼ぶ。
    renderDrill();
  });
  actions.append(extra);
  if (homeAfter.continue) {
    const link = el("a", "lib-link");
    link.href = `#ep/${homeAfter.continue.episode_id}`;
    link.append(document.createTextNode(`つづきを見る — ${homeAfter.continue.title || ""}`), el("span", "arrow", "→"));
    actions.append(link);
  }
  main.append(actions);
  app.append(main);
}

// ══════════════════════════ ライブラリ ══════════════════════════
async function renderLibrary() {
  clearWatchTimer();
  const app = $("app");
  app.replaceChildren(el("div", "loading", "読み込み中…"));
  let data;
  try { data = await getJSON("/api/library"); }
  catch (e) { renderError(app, e); return; }

  app.replaceChildren();
  const top = el("header", "top");
  const brand = el("div", "brand");
  brand.append(document.createTextNode("KIKITORI"), el("span", "brand-sub", "English Listening"));
  top.append(brand);
  app.append(top);

  const main = el("main");
  main.append(el("h1", "page-title", "ライブラリ"));
  const seriesList = Array.isArray(data.series) ? data.series : [];
  if (!seriesList.length) main.append(el("p", "empty-copy", "まだ教材が取り込まれていません。"));
  seriesList.forEach((s) => main.append(renderSeriesSection(s)));
  app.append(main);
}

function renderSeriesSection(s) {
  const sec = el("section", "series");
  const episodes = Array.isArray(s.episodes) ? s.episodes : [];
  const head = el("div", "series-head");
  head.append(el("h2", null, s.title || s.id), el("span", "series-meta", `${episodes.length} 話`));
  sec.append(head);
  const row = el("div", "ep-row");
  episodes.forEach((ep, i) => row.append(episodeCard(ep, i)));
  sec.append(row);
  return sec;
}

function episodeCard(ep, i) {
  const card = el("a", "ep-card");
  card.href = `#ep/${ep.id}`;
  card.append(el("div", "ep-thumb", `EP${i + 1}`));
  card.append(el("p", "ep-title", ep.title || ""));
  if (ep.completed) {
    card.append(el("p", "ep-state done", "✓ 視聴済"));
  } else if (typeof ep.position_s === "number" && ep.position_s > 0 && ep.duration_s > 0) {
    const prog = el("div", "progress");
    const fill = el("div", "progress-fill");
    fill.style.width = `${Math.min(100, Math.round((ep.position_s / ep.duration_s) * 100))}%`;
    prog.append(fill);
    card.append(prog);
  } else if (ep.sub_kind === "none") {
    card.append(el("p", "ep-state watchonly", "視聴のみ"));
  } else {
    card.append(el("p", "ep-state", "未視聴"));
  }
  return card;
}

// ══════════════════════════ プレイヤー ══════════════════════════
async function renderPlayer(id) {
  clearWatchTimer();
  const app = $("app");
  app.replaceChildren(el("div", "loading", "読み込み中…"));
  let ep;
  try { ep = await getJSON(`/api/episodes/${encodeURIComponent(id)}`); }
  catch (e) { renderError(app, e); return; }
  // /api/episodes/<id> のレスポンスに id は含まれない (video_url/sub_url/position_s/title/duration_s のみ)。
  // watch/comprehension の送信にはルートパラメータの id を使う。

  app.replaceChildren();
  const back = el("a", "player-back");
  back.href = "#library";
  back.append(document.createTextNode("← ライブラリ"));
  app.append(back);

  const wrap = el("div", "player");
  const frame = el("div", "player-frame");
  const video = document.createElement("video");
  video.id = "epVideo";
  video.src = ep.video_url;
  video.playsInline = true;
  video.controls = false;
  video.preload = "metadata";
  let trackEl = null;
  if (ep.sub_url) {
    trackEl = document.createElement("track");
    trackEl.kind = "subtitles";
    trackEl.src = ep.sub_url;
    trackEl.srclang = "en";
    trackEl.default = false;
    video.append(trackEl);
  }
  frame.append(video);
  wrap.append(frame);

  // 字幕は動画に重ねず、動画直下の専用行に自前描画する (track はブラウザ標準描画をさせず mode="hidden" 固定、
  // cuechange で activeCues を拾って subLineText に反映する)。トグル OFF 時は行ごと畳んで領域を取らない。
  let subLine = null, subLineText = null;
  if (trackEl) {
    subLine = el("div", "sub-line");
    subLineText = el("p", "sub-line-text");
    subLine.append(subLineText);
    subLine.style.display = "none"; // 既定 OFF
    wrap.append(subLine);
  }

  const body = el("div", "player-body");
  body.append(el("p", "player-title", ep.title || ""));

  const scrub = el("div", "scrub");
  const prog = el("div", "progress");
  const fill = el("div", "progress-fill");
  fill.style.width = "0%"; // video の再生イベント発火まで width 未指定だとブロック要素の初期幅(=満幅)が出てしまう
  prog.append(fill);
  scrub.append(prog);
  const times = el("div", "times");
  const curTimeEl = el("span", null, fmtClock(0));
  const durTimeEl = el("span", null, fmtClock(ep.duration_s || 0));
  times.append(curTimeEl, durTimeEl);
  scrub.append(times);
  body.append(scrub);

  const controls = el("div", "player-controls");
  const back10 = el("button", "ctl", "−10");
  back10.setAttribute("aria-label", "10秒戻す");
  const playBtn = el("button", "ctl ctl-main");
  playBtn.setAttribute("aria-label", "再生");
  const playIcoInner = el("span", "play-ico");
  playBtn.append(playIcoInner);
  const fwd10 = el("button", "ctl", "+10");
  fwd10.setAttribute("aria-label", "10秒送る");
  controls.append(back10, playBtn, fwd10);
  body.append(controls);

  const subrow = el("div", "subrow");
  let speedIdx = 0;
  const speeds = [1, 0.75, 1.25];
  const speedBtn = el("button", "toggle", SPEED_LABELS[speeds[0]]);
  speedBtn.addEventListener("click", () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    video.playbackRate = speeds[speedIdx];
    speedBtn.textContent = SPEED_LABELS[speeds[speedIdx]] || `${speeds[speedIdx]}x`;
  });
  subrow.append(speedBtn);

  let subsOn = false;
  if (trackEl) {
    const subBtn = el("button", "toggle off", "字幕 EN · オフ");
    subBtn.addEventListener("click", () => {
      subsOn = !subsOn;
      subLine.style.display = subsOn ? "block" : "none";
      subBtn.textContent = subsOn ? "字幕 EN · オン" : "字幕 EN · オフ";
      subBtn.classList.toggle("off", !subsOn);
    });
    subrow.append(subBtn);
  }
  body.append(subrow);
  wrap.append(body);
  app.append(wrap);

  if (trackEl) {
    // hidden でも cuechange は発火する (発火しないのは disabled のときだけ)。
    // 標準描画 (showing) には一切しない — 描画は自前の subLineText で行う。
    trackEl.track.mode = "hidden";
    trackEl.track.addEventListener("cuechange", () => {
      const cues = trackEl.track.activeCues;
      const lines = [];
      for (let i = 0; i < cues.length; i++) lines.push(cues[i].text);
      subLineText.textContent = lines.join("\n");
    });
  }

  video.addEventListener("loadedmetadata", () => {
    const pos = typeof ep.position_s === "number" ? ep.position_s : 0;
    if (pos > 0 && pos < video.duration - 1) video.currentTime = pos;
    durTimeEl.textContent = fmtClock(video.duration || ep.duration_s || 0);
  });
  video.addEventListener("timeupdate", () => {
    curTimeEl.textContent = fmtClock(video.currentTime);
    const dur = video.duration || ep.duration_s || 0;
    fill.style.width = dur > 0 ? `${Math.min(100, (video.currentTime / dur) * 100)}%` : "0%";
  });

  const setPlayIcon = () => { playIcoInner.className = video.paused ? "play-ico" : "pause-ico"; };
  playBtn.addEventListener("click", () => { video.paused ? video.play().catch(() => {}) : video.pause(); });
  video.addEventListener("play", setPlayIcon);
  video.addEventListener("pause", setPlayIcon);
  setPlayIcon();

  back10.addEventListener("click", () => { video.currentTime = Math.max(0, video.currentTime - 10); });
  fwd10.addEventListener("click", () => { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10); });

  // 視聴位置の記録: 15秒間隔 (再生中のみ) + pause + visibilitychange
  state.watchTimer = setInterval(() => { if (!video.paused) postWatch(id, video.currentTime); }, 15000);
  video.addEventListener("pause", () => postWatch(id, video.currentTime));
  const onHide = () => { if (document.hidden) postWatch(id, video.currentTime); };
  document.addEventListener("visibilitychange", onHide);
  state.watchCleanup = () => document.removeEventListener("visibilitychange", onHide);

  // 理解度オーバーレイ: 90% 到達で 1 回だけ
  let comprehensionShown = false;
  video.addEventListener("timeupdate", () => {
    const dur = video.duration || ep.duration_s || 0;
    if (!comprehensionShown && dur > 0 && video.currentTime / dur >= 0.9) {
      comprehensionShown = true;
      showComprehensionOverlay(body, id);
    }
  });
}

function showComprehensionOverlay(body, episodeId) {
  const overlay = el("div", "overlay card");
  overlay.append(el("p", "ovl-q", "どのくらい聞き取れた?"));
  const row = el("div", "emoji-row");
  [[1, "😵"], [2, "🤔"], [3, "🙂"], [4, "😎"]].forEach(([level, emoji]) => {
    const btn = el("button", "emoji", emoji);
    btn.addEventListener("click", async () => {
      try { await postJSON("/api/comprehension", { episode_id: episodeId, level }); }
      catch (e) { /* 理解度記録は補助情報のため、失敗しても視聴自体は止めない */ }
      overlay.remove();
    });
    row.append(btn);
  });
  overlay.append(row);
  const skip = el("button", "skip", "あとで");
  skip.addEventListener("click", () => overlay.remove());
  overlay.append(skip);
  body.append(overlay);
}

// ══════════════════════════ ルーティング ══════════════════════════
function route() {
  const hash = location.hash.replace(/^#/, "");
  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "ep" && parts[1]) { renderPlayer(parts[1]); return; }
  if (parts[0] === "drill") { renderDrill(); return; }
  if (parts[0] === "library") { renderLibrary(); return; }
  renderHome();
}
window.addEventListener("hashchange", route);
document.addEventListener("DOMContentLoaded", route);
