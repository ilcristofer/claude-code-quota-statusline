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
// SEGMENTS:
//  1) model + effort/mode badge (xhigh / thinking / fast)
//  2) CONTEXT scaled to the TRUE CEILING (context_window_size, typically 1M) with zones
//     colored on ABSOLUTE thresholds (HINT_COMPACT / HINT_CLEAR) that SUGGEST /compact
//     or /clear without forcing. The red zone >HINT_CLEAR is also the context-rot alert.
//  3) cache hit % of the last turn (efficiency/latency)
//  4) turn = FRESH tokens of the last turn (new input + cache write + output; excludes cache_read)
//  5) 5h/wk limits: % + (+X%) quota burned BY THIS SESSION + Pro~ projection + reset.
//     At LAUNCH rate_limits aren't there yet -> fallback to cache, marked "*".

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

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let d = {};
  try { d = JSON.parse(input); } catch { /* empty/broken payload: minimal line */ }

  const R = '\x1b[0m', DIM = '\x1b[2m', B = '\x1b[1m';
  const G = '\x1b[32m', Y = '\x1b[33m', O = '\x1b[38;5;208m', Rd = '\x1b[31m', GR = '\x1b[90m';
  const sep = `${DIM}  ${R}`;
  // 4-level scale. col4: green < t1 <= yellow < t2 <= orange < t3 <= red (high=bad).
  // col4inv: high=good -> >=hi green, >=mid yellow, >=lo orange, below red.
  const col4 = (v, t1, t2, t3) => (v >= t3 ? Rd : v >= t2 ? O : v >= t1 ? Y : G);
  const col4inv = (v, hi, mid, lo) => (v >= hi ? G : v >= mid ? Y : v >= lo ? O : Rd);
  const k = (n) =>
    n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' :
    n >= 1000 ? (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'k' :
    String(n | 0);
  const now = Date.now();
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
  const clock = (secs) => {
    const dt = new Date(secs * 1000);
    const hm = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    if (secs * 1000 - now < 20 * 3600000) return hm;
    return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()]} ${hm}`;
  };

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

  const parts = [];

  // --- 1) model + effort/mode badge ---
  let head = `${B}${d.model?.display_name || 'Claude'}${R}`;
  const eff = d.effort?.level;
  const effC = { low: GR, medium: G, high: Y, xhigh: Y, max: Rd }[eff] || DIM;
  // each emoji separated by spaces (double-cell glyphs: avoid overlaps).
  const badgeParts = [];
  if (eff) badgeParts.push(`${effC}${eff}${R}`);
  if (d.thinking?.enabled) badgeParts.push('💭');
  if (d.fast_mode) badgeParts.push(`${Y}⚡${R}`);
  if (badgeParts.length) head += ` ${DIM}·${R} ${badgeParts.join(' ')}`;
  // Self-gating: show a non-default output style (session_name is omitted on purpose — it's the
  // chat title, already shown elsewhere in the Claude Code UI, so it'd be redundant here).
  const ostyle = d.output_style?.name;
  if (ostyle && ostyle !== 'default') head += ` ${DIM}·${R} ${DIM}style:${ostyle}${R}`;
  parts.push(head);

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
  if (orient.length) parts.push(orient.join(' '));

  // --- 2) CONTEXT on the TRUE ceiling, with suggestion zones on absolute thresholds ---
  const cw = d.context_window || {};
  const cu = cw.current_usage || {};
  const win = cw.context_window_size || 1000000;
  const used = (cu.input_tokens || 0) + (cu.cache_creation_input_tokens || 0) + (cu.cache_read_input_tokens || 0);
  const pct = typeof cw.used_percentage === 'number' ? cw.used_percentage : (win ? Math.round(used / win * 100) : 0);
  const nearLimit = used >= win * 0.9;
  // zone (4 levels) for a given token level: green<compact, yellow<clear, orange<90%, red beyond
  const zoneCol = (tok) => (tok >= win * 0.9 ? Rd : tok >= HINT_CLEAR ? O : tok >= HINT_COMPACT ? Y : G);
  // 10-cell bar colored by ZONE (risk map): the colors alone mark the thresholds.
  const W = 10;
  const filled = Math.max(0, Math.min(W, Math.round(pct / 10)));
  let bar = '';
  for (let i = 0; i < W; i++) {
    const zc = zoneCol((i + 0.5) / W * win);
    bar += `${zc}${i < filled ? '▓' : '░'}${R}`;
  }
  const c = nearLimit ? Rd : used >= HINT_CLEAR ? O : used >= HINT_COMPACT ? Y : G;
  // "wasted" = tokens carried BEYOND the compact threshold: load that /compact would reclaim.
  const waste = Math.max(0, used - HINT_COMPACT);
  let ctx = `ctx ${bar} ${GR}${k(used)}/${k(win)}${R} ${c}${pct}%${R}`;
  if (nearLimit) ctx += ` ${Rd}${B}⚠ near limit — compact NOW${R} ${Rd}↓ ${k(waste)}${R}`;
  else if (used >= HINT_CLEAR) ctx += ` ${O}${B}⚠ compact! (context rot!)${R} ${O}↓ ${k(waste)}${R}`;
  else if (used >= HINT_COMPACT) ctx += ` ${Y}~ compact (save token)${R} ${GR}↓ ${k(waste)}${R}`;
  parts.push(ctx);

  // --- 3) cache hit % (last turn): share of input served from cache ---
  const cr = cu.cache_read_input_tokens || 0, ccr = cu.cache_creation_input_tokens || 0, itk = cu.input_tokens || 0;
  const totIn = cr + ccr + itk;
  if (totIn > 0) {
    const hit = Math.round(cr / totIn * 100);
    const hc = col4inv(hit, 90, 70, 50); // high=good; a drop = "cold" turn (watch out)
    parts.push(`${DIM}cache${R} ${hc}${hit}%${R}`);
  }

  // --- 4) turn = FRESH tokens of the turn (new input + cache write + output).
  // EXCLUDES cache_read (= context re-read): otherwise ≈ context size and would be
  // redundant with "ctx". Measures how much NEW work the turn does / how much the context grows.
  const turnNew = itk + ccr + (cu.output_tokens || 0);
  if (turnNew > 0) {
    const tc = col4(turnNew, 20000, 50000, 90000);
    parts.push(`${DIM}turn${R} ${tc}${k(turnNew)}${R}`);
  }

  // --- 5) subscription limits (LINE 2): %, (+X%) session-quota, Pro~, reset ---
  const rl = d.rate_limits || {};
  // Global rate-limit cache: at LAUNCH the payload doesn't have d.rate_limits yet (CC
  // derives them from the LAST API response headers). We persist the last known value and
  // show it "stale" (marked *) until the live one arrives and while the window hasn't expired.
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

  // Per-session baseline for the quota burned BY THIS SESSION (key = resets_at,
  // so at the window reset the count restarts clean).
  const sid = String(d.session_id || d.cwd || 'default').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
  const baseFile = join(tmpdir(), `cc-sl-${sid}.json`);
  let base = {};
  try { base = JSON.parse(readFileSync(baseFile, 'utf8')); } catch { /* first time */ }
  const sessDelta = (key, live) => {
    if (!live) return null;
    const b = base[key];
    if (!b || b.resets_at !== live.resets_at || live.used_percentage < b.pct) {
      base[key] = { pct: live.used_percentage, resets_at: live.resets_at, ts: now };
    }
    return live.used_percentage - base[key].pct;
  };
  const dF = sessDelta('five', liveFive);
  const dW = sessDelta('seven', liveSeven);
  if (liveFive || liveSeven) { try { writeFileSync(baseFile, JSON.stringify(base)); } catch { /* best effort */ } }

  // Burn-rate warning (default on; disable with CC_SL_BURN=0). If at THIS SESSION's AVERAGE pace
  // (since the baseline was set) a window would reach 100% BEFORE it resets, surface the projected
  // time-to-full. Guarded: needs >=8min elapsed and >=2pt burned, else the rate is too noisy.
  // Only ever shows when actionable — it stays hidden on the normal, not-going-to-hit-the-wall case.
  const burnWarn = (live, b) => {
    if (!SHOW_BURN || !live || !b || typeof b.ts !== 'number') return null;
    const elapsed = now - b.ts, dpct = live.used_percentage - b.pct;
    if (elapsed < 480000 || dpct < 2) return null;
    const rate = dpct / elapsed, remaining = 100 - live.used_percentage; // rate = %/ms
    if (rate <= 0 || remaining <= 0) return null;
    const msFull = remaining / rate, resetMs = live.resets_at * 1000 - now;
    return resetMs > 0 && msFull < resetMs ? msFull : null;
  };
  // Binding constraint: mark whichever window is closer to its OWN cap — the one that bites first.
  // Only when it matters (leader >=50%) and there's a real gap (no marker on a tie / when idle).
  let bindKey = null;
  if (pickFive && pickSeven) {
    const pf = pickFive.used_percentage, ps = pickSeven.used_percentage;
    if (Math.max(pf, ps) >= 50 && pf !== ps) bindKey = pf > ps ? 'five' : 'seven';
  }

  const lim = [];
  if (pickFive) {
    const p = pickFive.used_percentage;
    const cc = stF ? GR : col4(p, 50, 70, 85);
    let s = `5h ${cc}${Math.round(p)}%${mk(stF)}${R}`;
    if (!stF && dF != null && dF >= 1) s += `${GR}(+${Math.round(dF)}%)${R}`;
    const pro = Math.round(p * PRO_FACTOR);
    const pc = stF ? GR : col4(pro, 60, 90, 100);
    s += ` ${DIM}→${R} ${pc}Pro~${pro}%${!stF && pro >= 100 ? '⚠ ' : ''}${R}`;
    const bw = burnWarn(liveFive, base.five);
    if (bw != null) s += ` ${O}${B}⚠ full ~${left(bw)}${R}`;
    const t = pickFive.resets_at * 1000 - now;
    if (t > 0) s += ` ${GR}↻ ${left(t)} (${clock(pickFive.resets_at)})${R}`;
    if (bindKey === 'five') s += ` ${cc}◀${R}`;
    lim.push(s);
  }
  if (pickSeven) {
    const p = pickSeven.used_percentage;
    const cc = stW ? GR : col4(p, 50, 70, 85);
    let s = `wk ${cc}${Math.round(p)}%${mk(stW)}${R}`;
    if (!stW && dW != null && dW >= 1) s += `${GR}(+${Math.round(dW)}%)${R}`;
    const bw = burnWarn(liveSeven, base.seven);
    if (bw != null) s += ` ${O}${B}⚠ full ~${left(bw)}${R}`;
    const t = pickSeven.resets_at * 1000 - now;
    if (t > 0) s += ` ${GR}↻ ${left(t)} (${clock(pickSeven.resets_at)})${R}`;
    if (bindKey === 'seven') s += ` ${cc}◀${R}`;
    lim.push(s);
  }
  // Output: ONE line if it fits the terminal width (COLUMNS, passed by CC in the env);
  // otherwise split in 2 (line1 = model·context·cache·turn ; line2 = 5h/wk quota).
  const line1 = parts.join(sep);
  const line2 = lim.join(`${GR} · ${R}`);
  if (!line2) { process.stdout.write(line1); return; }
  const oneLine = `${line1}${sep}${line2}`;
  const cols = Number(process.env.COLUMNS) || 0;
  // -3 margin (statusLine padding + glyph-width rounding). cols unknown -> 2 lines (safe).
  const fits = cols > 0 && vlen(oneLine) <= cols - 3;
  process.stdout.write(fits ? oneLine : `${line1}\n${line2}`);
});
