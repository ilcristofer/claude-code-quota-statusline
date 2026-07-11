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

// SUGGESTION thresholds (absolute, in tokens) — override via env, else default.
// They DON'T force anything: they color the bar and suggest. The actual compaction is
// decided by you (or CC's autocompact configured in settings.json).
const HINT_COMPACT = Number(process.env.CC_SL_HINT_COMPACT) || 200000; // yellow: consider /compact
const HINT_CLEAR   = Number(process.env.CC_SL_HINT_CLEAR)   || 400000; // red: rot, consider /clear

// Conversion factor: 5h Max limit -> Pro. Personal usage estimate (2026-07: 27% Max ≈ 135% Pro => ×5).
// Recalibrate for your own usage. Override via env CC_SL_PRO_FACTOR.
const PRO_FACTOR = Number(process.env.CC_SL_PRO_FACTOR) || 5;

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

  // VISIBLE width of a string (without ANSI codes); double-cell glyphs count as 2.
  const vlen = (s) => {
    const plain = s.replace(/\x1b\[[0-9;]*m/g, '');
    const wide = (plain.match(/[\u{1F000}-\u{1FAFF}☀-➿←-⇿⬀-⯿]/gu) || []).length;
    return [...plain].length + wide;
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
  parts.push(head);

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
      base[key] = { pct: live.used_percentage, resets_at: live.resets_at };
    }
    return live.used_percentage - base[key].pct;
  };
  const dF = sessDelta('five', liveFive);
  const dW = sessDelta('seven', liveSeven);
  if (liveFive || liveSeven) { try { writeFileSync(baseFile, JSON.stringify(base)); } catch { /* best effort */ } }

  const lim = [];
  if (pickFive) {
    const p = pickFive.used_percentage;
    const cc = stF ? GR : col4(p, 50, 70, 85);
    let s = `5h ${cc}${Math.round(p)}%${mk(stF)}${R}`;
    if (!stF && dF != null && dF >= 1) s += `${GR}(+${Math.round(dF)}%)${R}`;
    const pro = Math.round(p * PRO_FACTOR);
    const pc = stF ? GR : col4(pro, 60, 90, 100);
    s += ` ${DIM}→${R} ${pc}Pro~${pro}%${!stF && pro >= 100 ? '⚠ ' : ''}${R}`;
    const t = pickFive.resets_at * 1000 - now;
    if (t > 0) s += ` ${GR}↻ ${left(t)}${R}`;
    lim.push(s);
  }
  if (pickSeven) {
    const p = pickSeven.used_percentage;
    const cc = stW ? GR : col4(p, 50, 70, 85);
    let s = `wk ${cc}${Math.round(p)}%${mk(stW)}${R}`;
    if (!stW && dW != null && dW >= 1) s += `${GR}(+${Math.round(dW)}%)${R}`;
    const t = pickSeven.resets_at * 1000 - now;
    if (t > 0) s += ` ${GR}↻ ${left(t)}${R}`;
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
