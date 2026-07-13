// statusline.mjs — Claude Code status line, "QUOTA-aware" version (subscription plan).
//
// Copyright (c) 2026 ilcristofer. MIT License (see LICENSE).
//
// Reads the JSON that Claude Code passes on stdin (the transcript is NOT needed).
// Config: ~/.claude/settings.json -> "statusLine": {"type":"command","command":"node <path>/statusline.mjs"}
// Hard rule: stdout ONLY, never stderr, never throw; no output = blank line.
//
// PHILOSOPHY: on a subscription the marginal $ is ZERO -> it doesn't measure a real cost.
// The real currency you "spend" is the rate-limit WINDOWS (5h + weekly) and the
// SIZE of the context (more tokens = more per-turn usage + context-rot risk).
// So: no $, and the focus is quota, context and per-turn usage in TOKENS.
//
// SEGMENTS (line):
//  1) model + effort/mode badge (xhigh / thinking / fast)
//  2) CONTEXT scaled to the TRUE CEILING with zone colors + "↗ compact ~N" heads-up
//  3) cache hit % of the last turn
//  4) turn = FRESH tokens of the last turn (excludes cache_read)
//  5) 5h/wk limits: % + (+X%) session-quota + "~N msg" (prompts left at your pace) + Pro~ + reset
//
// EXPLAIN MODE: `node statusline.mjs explain` prints an annotated legend with your REAL
// latest values (read from a snapshot the normal render persists each time). The line stays
// lean = a glance; `explain` (wired to a /quota slash command) is the full, spelled-out manual.

import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process'; // ONLY for the opt-in git segment (CC_SL_GIT=1)

// SUGGESTION thresholds (absolute, in tokens) — override via env, else default.
// They DON'T force anything: they color the bar and suggest. The actual compaction is
// decided by you (or CC's autocompact configured in settings.json).
const HINT_COMPACT = Number(process.env.CC_SL_HINT_COMPACT) || 200000; // yellow: consider /compact
const HINT_CLEAR   = Number(process.env.CC_SL_HINT_CLEAR)   || 400000; // red: rot, consider /clear

// Conversion factor: 5h Max limit -> Pro. Personal usage estimate (2026-07: 27% Max ≈ 135% Pro => ×5).
// Recalibrate for your own usage. Override via env CC_SL_PRO_FACTOR.
const PRO_FACTOR = Number(process.env.CC_SL_PRO_FACTOR) || 5;

// Optional segments (see README). Defaults keep the line quota-focused, payload-only and fast:
//   CC_SL_GIT=1  -> show git branch+dirty (spawns git per render; off by default)
//   CC_SL_CWD=1  -> show the project dir basename (always takes width; off by default)
//   CC_SL_BURN=0 -> disable the burn-rate "⚠ full ~Yh" warning (on by default; self-gating)
const envOn = (v) => /^(1|true|yes|on)$/i.test(String(v || ''));
const SHOW_GIT  = envOn(process.env.CC_SL_GIT);
const SHOW_CWD  = envOn(process.env.CC_SL_CWD);
const SHOW_BURN = process.env.CC_SL_BURN == null ? true : envOn(process.env.CC_SL_BURN);

const WEEK_SECONDS = 7 * 24 * 3600; // weekly window length (for the steady-spend pace reference)

// ── Shared, PURE helpers (used by BOTH the render path and the explain view) ──────────────
const R = '\x1b[0m', DIM = '\x1b[2m', B = '\x1b[1m';
const G = '\x1b[32m', Y = '\x1b[33m', O = '\x1b[38;5;208m', Rd = '\x1b[31m', GR = '\x1b[90m';
// 4-level scale. col4: green < t1 <= yellow < t2 <= orange < t3 <= red (high=bad).
// col4inv: high=good -> >=hi green, >=mid yellow, >=lo orange, below red.
const col4 = (v, t1, t2, t3) => (v >= t3 ? Rd : v >= t2 ? O : v >= t1 ? Y : G);
const col4inv = (v, hi, mid, lo) => (v >= hi ? G : v >= mid ? Y : v >= lo ? O : Rd);
const k = (n) =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' :
  n >= 1000 ? (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'k' :
  String(n | 0);
const left = (ms) => {
  const m = Math.round(ms / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 24) return mm ? `${h}h${mm}m` : `${h}h`;
  const dd = Math.floor(h / 24), hh = h % 24;
  return hh ? `${dd}d${hh}h` : `${dd}d`;
};
// Wall-clock time of a reset (in ADDITION to the countdown). HH:MM when it's within ~20h
// (unambiguous same-day, e.g. the 5h window); weekday-prefixed further out (e.g. weekly).
const clock = (secs, nowMs) => {
  const dt = new Date(secs * 1000);
  const hm = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  if (secs * 1000 - nowMs < 20 * 3600000) return hm;
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()]} ${hm}`;
};
// 10-cell context bar colored by ZONE (risk map). Shared so line + explain look identical.
const ctxBar = (used, win, pct, hintCompact, hintClear) => {
  const W = 10, filled = Math.max(0, Math.min(W, Math.round(pct / 10)));
  const zc = (tok) => (tok >= win * 0.9 ? Rd : tok >= hintClear ? O : tok >= hintCompact ? Y : G);
  let bar = '';
  for (let i = 0; i < W; i++) bar += `${zc((i + 0.5) / W * win)}${i < filled ? '▓' : '░'}${R}`;
  return bar;
};
// Micro trend sparkline from a numeric history. Block glyphs are SINGLE-cell (safe width).
const spark = (arr) => {
  const bars = '▁▂▃▄▅▆▇█';
  const a = (arr || []).filter((x) => typeof x === 'number');
  if (a.length < 2) return '';
  const mn = Math.min(...a), mx = Math.max(...a), rng = mx - mn || 1;
  return a.map((v) => bars[Math.min(7, Math.floor((v - mn) / rng * 7.999))]).join('');
};
const ago = (ms, nowMs) => {
  const m = Math.round(Math.max(0, nowMs - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
};

// Where the normal render drops a snapshot for the explain view. GLOBAL (last render wins across
// sessions): `explain` runs as a separate process with no stdin payload, so it can only read this.
const EXPLAIN_FILE = join(tmpdir(), 'cc-sl-explain.json');

// ── EXPLAIN VIEW: annotated legend with the user's real latest values ─────────────────────
// Generic fallback shown before the first render populates a real snapshot.
const EXAMPLE = {
  ts: 0, model: 'Opus 4.8 (1M context)', eff: 'xhigh', thinking: true, fast: false,
  ctx: { used: 67000, win: 1000000, pct: 7, hintCompact: 200000, hintClear: 400000, compactIn: 6 },
  cache: 89, turn: 7200, turns: 12,
  five: { pct: 20, stale: false, delta: 6, pro: 100, msgLeft: 14, perTurn: 1.4, burnMs: null, resetAt: null, resetMs: 3 * 3600000 + 59 * 60000, spark: [12, 14, 15, 17, 20], binding: false },
  seven: { pct: 38, stale: false, delta: 1, pace: { expected: 33, over: true }, burnMs: null, resetAt: null, resetMs: 27 * 3600000, spark: [34, 35, 36, 37, 38], binding: true },
};

function printExplain() {
  const nowMs = Date.now();
  let snap, demo = false;
  try { snap = JSON.parse(readFileSync(EXPLAIN_FILE, 'utf8')); } catch { snap = null; }
  if (!snap || !snap.ctx) { snap = EXAMPLE; demo = true; }

  const out = [];
  const badge = [snap.eff, snap.thinking ? '💭' : '', snap.fast ? '⚡' : ''].filter(Boolean).join(' ');
  out.push(`${B}⛽ Fuel Gauge — how to read your status line${R}`);
  out.push(`${DIM}${demo ? 'no live data yet — generic example (use Claude Code a moment, then rerun)' : 'last render ' + ago(snap.ts, nowMs)} · ${snap.model}${badge ? ' · ' + badge : ''}${R}`);
  out.push('');

  out.push(`${B}CONTEXT${R}`);
  const cx = snap.ctx;
  const bar = ctxBar(cx.used, cx.win, cx.pct, cx.hintCompact, cx.hintClear);
  out.push(`  ctx ${bar} ${GR}${k(cx.used)}/${k(cx.win)}${R} ${cx.pct}%   ${DIM}context used vs the TRUE model window — colors are risk zones${R}`);
  if (cx.compactIn != null)
    out.push(`      ${Y}↗ compact in ~${cx.compactIn} turns${R}   ${DIM}at the current growth rate, when you'll cross the /compact line${R}`);
  if (snap.turn) out.push(`  ${DIM}turn${R} ${k(snap.turn)}   ${DIM}FRESH tokens this turn (new input+write+output; the re-read context is excluded)${R}`);
  if (snap.cache != null) out.push(`  ${DIM}cache${R} ${snap.cache}%   ${DIM}share of input served from cache — higher = cheaper & faster${R}`);
  out.push('');

  if (snap.five) {
    const f = snap.five;
    out.push(`${B}5-HOUR WINDOW${R}`);
    out.push(`  5h ${Math.round(f.pct)}%${f.stale ? ' *' : ''}${f.delta ? ` (+${f.delta}%)` : ''}   ${DIM}quota used${f.delta ? ' · (+X%) = burned by THIS session' : ''}${f.stale ? ' · * = stale (before the first API round-trip)' : ''}${R}`);
    if (f.msgLeft != null)
      out.push(`  ${col4inv(f.msgLeft, 20, 10, 5)}~${f.msgLeft > 99 ? '99+' : f.msgLeft} msg left${R}   ${DIM}≈ prompts remaining before the cap, at your recent pace${f.perTurn ? ` (~${f.perTurn.toFixed(1)}%/msg)` : ''}${R}`);
    const sp = spark(f.spark);
    if (sp) out.push(`  ${sp}   ${DIM}recent 5h-burn trend (this session)${R}`);
    out.push(`  ${DIM}→${R} Pro~${f.pro}%   ${DIM}the same usage projected onto the Pro plan (rough ×${PRO_FACTOR} gauge)${R}`);
    if (f.burnMs != null) out.push(`  ${O}⚠ full ~${left(f.burnMs)}${R}   ${DIM}at this pace it would cap BEFORE it resets${R}`);
    const rm = f.resetAt ? f.resetAt * 1000 - nowMs : f.resetMs;
    if (rm > 0) out.push(`  ${GR}↻ ${left(rm)}${f.resetAt ? ` (${clock(f.resetAt, nowMs)})` : ''}${R}   ${DIM}resets in / at${R}`);
    if (f.binding) out.push(`  ${O}◀ binding constraint${R}   ${DIM}of the two windows, this is the one that caps first${R}`);
    out.push('');
  }

  if (snap.seven) {
    const w = snap.seven;
    out.push(`${B}WEEKLY WINDOW${R}`);
    out.push(`  wk ${Math.round(w.pct)}%${w.stale ? ' *' : ''}${w.delta ? ` (+${w.delta}%)` : ''}   ${DIM}quota used${w.delta ? ' · session delta' : ''}${R}`);
    if (w.pace)
      out.push(`  ${w.pace.over ? O : G}${w.pace.over ? 'over pace ⚠' : 'on pace ✓'}${R}   ${DIM}spent ${Math.round(w.pct)}% vs ~${Math.round(w.pace.expected)}% of the week elapsed (steady-spend reference)${R}`);
    const sp = spark(w.spark);
    if (sp) out.push(`  ${sp}   ${DIM}recent weekly-burn trend${R}`);
    if (w.burnMs != null) out.push(`  ${O}⚠ full ~${left(w.burnMs)}${R}   ${DIM}at this pace it would cap BEFORE it resets${R}`);
    const rm = w.resetAt ? w.resetAt * 1000 - nowMs : w.resetMs;
    if (rm > 0) out.push(`  ${GR}↻ ${left(rm)}${w.resetAt ? ` (${clock(w.resetAt, nowMs)})` : ''}${R}   ${DIM}resets in / at${R}`);
    if (w.binding) out.push(`  ${O}◀ binding constraint${R}   ${DIM}of the two windows, this is the one that caps first${R}`);
    out.push('');
  }

  out.push(`${DIM}Symbols: ↓N = tokens /compact would reclaim · ◀ = window that caps first · * = stale · colors run green → yellow → orange → red by risk.${R}`);
  process.stdout.write(out.join('\n') + '\n');
}

// ── entry point: explain mode (manual, no stdin) vs the normal render (stdin payload) ──────
const mode = process.argv[2];
if (mode === 'explain' || mode === '--explain' || mode === 'legend' || mode === '--legend') {
  try { printExplain(); } catch { /* never throw: manual view degrades to nothing */ }
} else {
  renderFromStdin();
}

function renderFromStdin() {
  let input = '';
  process.stdin.on('data', (c) => (input += c));
  process.stdin.on('end', () => {
    let d = {};
    try { d = JSON.parse(input); } catch { /* empty/broken payload: minimal line */ }

    const sep = `${DIM}  ${R}`;
    const now = Date.now();

    // VISIBLE width of a string (without ANSI codes); double-cell glyphs count as 2.
    const vlen = (s) => {
      const plain = s.replace(/\x1b\[[0-9;]*m/g, '');
      const wide = (plain.match(/[\u{1F000}-\u{1FAFF}☀-➿←-⇿⬀-⯿◀▶]/gu) || []).length;
      return [...plain].length + wide;
    };

    // Optional git branch+dirty (opt-in via CC_SL_GIT=1). Uses child_process (a Node built-in) to
    // spawn git once per render — off by default to keep the line payload-only and fast. Timeout +
    // try/catch so a huge/slow repo or a missing git can never hang or crash the status line.
    const gitInfo = (cwd) => {
      try {
        const o = { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 300, encoding: 'utf8' };
        let br = execSync('git rev-parse --abbrev-ref HEAD', o).trim();
        if (!br) return null;
        if (br === 'HEAD') { try { br = execSync('git rev-parse --short HEAD', o).trim(); } catch { /* detached */ } }
        let dirty = false;
        try { dirty = !!execSync('git status --porcelain', o).trim(); } catch { /* ignore */ }
        return { branch: br, dirty };
      } catch { return null; }
    };

    // --- 1) model + effort/mode badge ---
    let head = `${B}${d.model?.display_name || 'Claude'}${R}`;
    const eff = d.effort?.level;
    const effC = { low: GR, medium: G, high: Y, xhigh: Y, max: Rd }[eff] || DIM;
    const badgeParts = [];
    if (eff) badgeParts.push(`${effC}${eff}${R}`);
    if (d.thinking?.enabled) badgeParts.push('💭');
    if (d.fast_mode) badgeParts.push(`${Y}⚡${R}`);
    if (badgeParts.length) head += ` ${DIM}·${R} ${badgeParts.join(' ')}`;
    // Self-gating: show a non-default output style (session_name is omitted on purpose — it's the
    // chat title, already shown elsewhere in the Claude Code UI, so it'd be redundant here).
    const ostyle = d.output_style?.name;
    if (ostyle && ostyle !== 'default') head += ` ${DIM}·${R} ${DIM}style:${ostyle}${R}`;

    // --- 1b) orientation (opt-in): project dir basename + git branch/dirty ---
    const dir = d.workspace?.current_dir || d.cwd || '';
    const orient = [];
    if (SHOW_CWD && dir) {
      const base0 = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
      if (base0) orient.push(`${DIM}${base0}${R}`);
    }
    if (SHOW_GIT) {
      const g = gitInfo(dir || undefined);
      if (g) orient.push(`${GR}⎇ ${g.branch}${g.dirty ? `${Y}*` : ''}${R}`);
    }

    // --- 2) CONTEXT numbers on the TRUE ceiling ---
    const cw = d.context_window || {};
    const cu = cw.current_usage || {};
    const win = cw.context_window_size || 1000000;
    const used = (cu.input_tokens || 0) + (cu.cache_creation_input_tokens || 0) + (cu.cache_read_input_tokens || 0);
    const pct = typeof cw.used_percentage === 'number' ? cw.used_percentage : (win ? Math.round(used / win * 100) : 0);
    const nearLimit = used >= win * 0.9;
    const bar = ctxBar(used, win, pct, HINT_COMPACT, HINT_CLEAR);
    const c = nearLimit ? Rd : used >= HINT_CLEAR ? O : used >= HINT_COMPACT ? Y : G;
    const waste = Math.max(0, used - HINT_COMPACT); // tokens carried BEYOND compact = /compact reclaim

    // --- 3) cache hit % ---
    const cr = cu.cache_read_input_tokens || 0, ccr = cu.cache_creation_input_tokens || 0, itk = cu.input_tokens || 0;
    const totIn = cr + ccr + itk;
    const cacheHit = totIn > 0 ? Math.round(cr / totIn * 100) : null;

    // --- 4) turn = FRESH tokens (excludes the re-read context) ---
    const turnNew = itk + ccr + (cu.output_tokens || 0);

    // --- 5) subscription limits + per-session state ---
    const rl = d.rate_limits || {};
    const rlCacheFile = join(tmpdir(), 'cc-sl-ratelimits.json');
    let rlCache = {};
    try { rlCache = JSON.parse(readFileSync(rlCacheFile, 'utf8')); } catch { /* first time */ }
    const liveFive = rl.five_hour && typeof rl.five_hour.used_percentage === 'number' ? rl.five_hour : null;
    const liveSeven = rl.seven_day && typeof rl.seven_day.used_percentage === 'number' ? rl.seven_day : null;
    if (liveFive) rlCache.five = { used_percentage: liveFive.used_percentage, resets_at: liveFive.resets_at };
    if (liveSeven) rlCache.seven = { used_percentage: liveSeven.used_percentage, resets_at: liveSeven.resets_at };
    if (liveFive || liveSeven) { try { writeFileSync(rlCacheFile, JSON.stringify(rlCache)); } catch { /* best effort */ } }
    const fresh = (x) => x && typeof x.resets_at === 'number' && x.resets_at * 1000 > now ? x : null;
    const pickFive = liveFive || fresh(rlCache.five);
    const pickSeven = liveSeven || fresh(rlCache.seven);
    const stF = !liveFive && !!pickFive, stW = !liveSeven && !!pickSeven;
    const mk = (st) => (st ? `${DIM}*${R}` : '');

    // Per-session state file (key = session): baselines + turn counter + trend histories.
    const sid = String(d.session_id || d.cwd || 'default').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
    const baseFile = join(tmpdir(), `cc-sl-${sid}.json`);
    let base = {};
    try { base = JSON.parse(readFileSync(baseFile, 'utf8')); } catch { /* first time */ }

    // Turn counter via prompt_id (one "turn" = one user prompt, regardless of how many renders it
    // triggers). Drives "~N msg" and "↗ compact ~N". On a NEW turn we also append trend samples.
    const pid = d.prompt_id;
    const isNewTurn = pid != null && pid !== base._pid;
    if (isNewTurn) {
      base._turns = (base._turns || 0) + 1;
      base._pid = pid;
      if (liveFive) base.h5 = [...(base.h5 || []), liveFive.used_percentage].slice(-16);
      if (liveSeven) base.hw = [...(base.hw || []), liveSeven.used_percentage].slice(-16);
      base.hc = [...(base.hc || []), used].slice(-8);
    }
    const turnN = base._turns || 0;

    // Per-session quota baseline (key = resets_at, so at the window reset the count restarts clean).
    // turn0 = the turn number when the baseline was set -> lets us measure %-per-turn burn.
    const sessDelta = (key, live) => {
      if (!live) return null;
      const b = base[key];
      // Re-baseline on: no baseline, a baseline from an OLDER version missing turn0 (migration),
      // a new window (resets_at changed), or a drop below baseline (window rolled).
      if (!b || typeof b.turn0 !== 'number' || b.resets_at !== live.resets_at || live.used_percentage < b.pct) {
        base[key] = { pct: live.used_percentage, resets_at: live.resets_at, ts: now, turn0: turnN };
      }
      return live.used_percentage - base[key].pct;
    };
    const dF = sessDelta('five', liveFive);
    const dW = sessDelta('seven', liveSeven);

    // "~N msg" — remaining quota translated into remaining PROMPTS, from THIS session's measured
    // %-per-turn burn. Honest (same family as the burn warning): hidden until there's real signal.
    const perTurnBurn = (key, live) => {
      const b = base[key];
      if (!live || !b || typeof b.turn0 !== 'number') return null;
      const dt = turnN - b.turn0, dp = live.used_percentage - b.pct;
      if (dt < 2 || dp < 1) return null; // too few turns / too little burned: rate is noise
      return dp / dt;
    };
    const msgLeftFor = (key, live) => {
      const rate = perTurnBurn(key, live);
      if (rate == null || rate <= 0) return null;
      return Math.max(0, Math.floor((100 - live.used_percentage) / rate));
    };
    const perTurnFive = perTurnBurn('five', liveFive);
    const msgLeftFive = msgLeftFor('five', liveFive);

    // "↗ compact ~N" — project the context growth (recent per-turn slope) to the /compact line.
    let compactIn = null;
    {
      const h = base.hc || [];
      if (h.length >= 3 && used < HINT_COMPACT) {
        const slope = (h[h.length - 1] - h[0]) / (h.length - 1); // tokens/turn
        if (slope > 0) compactIn = Math.max(1, Math.ceil((HINT_COMPACT - used) / slope));
      }
    }

    // Weekly pace: compare spend to a steady linear spend over the 7-day window (ahead/behind).
    let weekPace = null;
    if (liveSeven && typeof liveSeven.resets_at === 'number') {
      const elapsed = now / 1000 - (liveSeven.resets_at - WEEK_SECONDS);
      if (elapsed > 0) {
        const expected = Math.min(1, elapsed / WEEK_SECONDS) * 100;
        weekPace = { expected, over: liveSeven.used_percentage > expected + 5 };
      }
    }

    // Burn-rate warning (default on; disable with CC_SL_BURN=0). If at THIS SESSION's AVERAGE pace
    // (since the baseline) a window would reach 100% BEFORE it resets, surface the projected
    // time-to-full. Guarded: needs >=8min elapsed and >=2pt burned. Hidden unless actionable.
    const burnWarn = (live, b) => {
      if (!SHOW_BURN || !live || !b || typeof b.ts !== 'number') return null;
      const elapsed = now - b.ts, dpct = live.used_percentage - b.pct;
      if (elapsed < 480000 || dpct < 2) return null;
      const rate = dpct / elapsed, remaining = 100 - live.used_percentage; // rate = %/ms
      if (rate <= 0 || remaining <= 0) return null;
      const msFull = remaining / rate, resetMs = live.resets_at * 1000 - now;
      return resetMs > 0 && msFull < resetMs ? msFull : null;
    };
    const bwFive = burnWarn(liveFive, base.five);
    const bwSeven = burnWarn(liveSeven, base.seven);

    // Binding constraint: mark whichever window is closer to its OWN cap — the one that bites first.
    let bindKey = null;
    if (pickFive && pickSeven) {
      const pf = pickFive.used_percentage, ps = pickSeven.used_percentage;
      if (Math.max(pf, ps) >= 50 && pf !== ps) bindKey = pf > ps ? 'five' : 'seven';
    }

    // ── assemble the CONTEXT segment (with the "↗ compact ~N" heads-up) ──
    let ctx = `ctx ${bar} ${GR}${k(used)}/${k(win)}${R} ${c}${pct}%${R}`;
    if (nearLimit) ctx += ` ${Rd}${B}⚠ near limit — compact NOW${R} ${Rd}↓ ${k(waste)}${R}`;
    else if (used >= HINT_CLEAR) ctx += ` ${O}${B}⚠ compact! (context rot!)${R} ${O}↓ ${k(waste)}${R}`;
    else if (used >= HINT_COMPACT) ctx += ` ${Y}~ compact (save token)${R} ${GR}↓ ${k(waste)}${R}`;
    else if (compactIn != null && compactIn <= 12) ctx += ` ${Y}↗ compact ~${compactIn}${R}`;

    const parts = [head];
    if (orient.length) parts.push(orient.join(' '));
    parts.push(ctx);
    if (cacheHit != null) parts.push(`${DIM}cache${R} ${col4inv(cacheHit, 90, 70, 50)}${cacheHit}%${R}`);
    if (turnNew > 0) parts.push(`${DIM}turn${R} ${col4(turnNew, 20000, 50000, 90000)}${k(turnNew)}${R}`);

    // ── assemble the LIMIT segments (line 2) ──
    const lim = [];
    if (pickFive) {
      const p = pickFive.used_percentage;
      const cc = stF ? GR : col4(p, 50, 70, 85);
      let s = `5h ${cc}${Math.round(p)}%${mk(stF)}${R}`;
      if (!stF && dF != null && dF >= 1) s += `${GR}(+${Math.round(dF)}%)${R}`;
      if (!stF && msgLeftFive != null) s += ` ${col4inv(msgLeftFive, 20, 10, 5)}~${msgLeftFive > 99 ? '99+' : msgLeftFive} msg${R}`;
      const pro = Math.round(p * PRO_FACTOR);
      const pc = stF ? GR : col4(pro, 60, 90, 100);
      s += ` ${DIM}→${R} ${pc}Pro~${pro}%${!stF && pro >= 100 ? '⚠ ' : ''}${R}`;
      if (bwFive != null) s += ` ${O}${B}⚠ full ~${left(bwFive)}${R}`;
      const t = pickFive.resets_at * 1000 - now;
      if (t > 0) s += ` ${GR}↻ ${left(t)} (${clock(pickFive.resets_at, now)})${R}`;
      if (bindKey === 'five') s += ` ${cc}◀${R}`;
      lim.push(s);
    }
    if (pickSeven) {
      const p = pickSeven.used_percentage;
      const cc = stW ? GR : col4(p, 50, 70, 85);
      let s = `wk ${cc}${Math.round(p)}%${mk(stW)}${R}`;
      if (!stW && dW != null && dW >= 1) s += `${GR}(+${Math.round(dW)}%)${R}`;
      if (bwSeven != null) s += ` ${O}${B}⚠ full ~${left(bwSeven)}${R}`;
      const t = pickSeven.resets_at * 1000 - now;
      if (t > 0) s += ` ${GR}↻ ${left(t)} (${clock(pickSeven.resets_at, now)})${R}`;
      if (bindKey === 'seven') s += ` ${cc}◀${R}`;
      lim.push(s);
    }

    // ── persist per-session state + the explain snapshot (best effort; never fatal) ──
    try { writeFileSync(baseFile, JSON.stringify(base)); } catch { /* best effort */ }
    try {
      const snap = {
        ts: now,
        model: d.model?.display_name || 'Claude',
        eff, thinking: !!d.thinking?.enabled, fast: !!d.fast_mode,
        ctx: { used, win, pct, hintCompact: HINT_COMPACT, hintClear: HINT_CLEAR, compactIn },
        cache: cacheHit, turn: turnNew || null, turns: turnN,
        five: pickFive ? {
          pct: pickFive.used_percentage, stale: stF,
          delta: (!stF && dF != null && dF >= 1) ? Math.round(dF) : null,
          pro: Math.round(pickFive.used_percentage * PRO_FACTOR),
          msgLeft: msgLeftFive, perTurn: perTurnFive,
          burnMs: bwFive, resetAt: pickFive.resets_at, resetMs: pickFive.resets_at * 1000 - now,
          spark: base.h5 || [], binding: bindKey === 'five',
        } : null,
        seven: pickSeven ? {
          pct: pickSeven.used_percentage, stale: stW,
          delta: (!stW && dW != null && dW >= 1) ? Math.round(dW) : null,
          pace: weekPace, burnMs: bwSeven,
          resetAt: pickSeven.resets_at, resetMs: pickSeven.resets_at * 1000 - now,
          spark: base.hw || [], binding: bindKey === 'seven',
        } : null,
      };
      writeFileSync(EXPLAIN_FILE, JSON.stringify(snap));
    } catch { /* best effort */ }

    // ── output: ONE line if it fits COLUMNS, else split in 2 ──
    const line1 = parts.join(sep);
    const line2 = lim.join(`${GR} · ${R}`);
    if (!line2) { process.stdout.write(line1); return; }
    const oneLine = `${line1}${sep}${line2}`;
    const cols = Number(process.env.COLUMNS) || 0;
    const fits = cols > 0 && vlen(oneLine) <= cols - 3; // -3 margin; cols unknown -> 2 lines (safe)
    process.stdout.write(fits ? oneLine : `${line1}\n${line2}`);
  });
}
