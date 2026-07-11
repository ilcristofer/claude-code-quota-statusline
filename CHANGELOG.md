# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Wall-clock reset time** next to each countdown — `↻ 3h18m (18:42)`, weekday-prefixed
  (`Wed 09:00`) when the reset is more than ~20h out.
- **Binding-constraint marker** `◀` on whichever quota window (5h vs weekly) is closer to its own
  cap — the one that will bite first (shown only when it's ≥50% and there's a real gap).
- **Burn-rate warning** `⚠ full ~Yh` — warns when, at this session's average pace, a window would
  reach 100% *before* it resets. On by default; disable with `CC_SL_BURN=0`.
- **Optional git segment** — branch + dirty flag (`⎇ main*`), opt-in via `CC_SL_GIT=1`.
- **Optional project-dir segment** — the working-directory basename, opt-in via `CC_SL_CWD=1`.
- **Auto orientation** — a non-default `output_style` now appears in the header.

## [1.0.0] - 2026-07-11

Initial public release.

### Added

- **QUOTA-aware status line** (`statusline.mjs`) for Claude Code **subscription** users — a
  single, dependency-free file that reads Claude Code's stdin payload and prints one adaptive
  line to stdout. Deliberately shows **no `$`**: under a subscription the marginal cost is zero,
  so the bar spends its space on quota, context, and per-turn tokens instead.
- **Context bar** scaled to the true `context_window_size` (e.g. 1M), with a 4-color risk scale
  and advisory `/compact` · `/clear` hints at absolute thresholds, plus `↓ N` = tokens reclaimable
  by compacting.
- **Cache hit %** for the last turn, and **`turn`** = the turn's *fresh* tokens (input +
  cache-write + output, excluding the re-read context).
- **5-hour and weekly quota** segments: usage `%`, per-session delta `(+X%)`, a `Pro~` cross-plan
  projection (5h), reset countdowns `↻`, and a stale-data fallback (marked `*`) shown before the
  first API round-trip populates `rate_limits`.
- **Adaptive layout** — everything on one line when it fits `COLUMNS`, otherwise split into two.
- **Configuration via environment variables**: `CC_SL_HINT_COMPACT`, `CC_SL_HINT_CLEAR`, and
  `CC_SL_PRO_FACTOR`.
- **One-command installers** — `install.sh` (macOS/Linux) and `install.ps1` (Windows). They copy
  `statusline.mjs` into `~/.claude/` and merge only the `statusLine` key into `settings.json`
  (backing it up first and preserving every other key) using Node — no `jq` dependency. They are
  idempotent, run a `node --check` before wiring the file in, honor `CLAUDE_CONFIG_DIR`, work from
  a clone or via `curl … | sh` / `irm … | iex`, and take an optional `--with-effort-suggest`
  (`-WithEffortSuggest`) flag to also install the companion.
- **`/effort-suggest`** companion slash command (`extras/effort-suggest.md`) that analyzes the
  current task and recommends a reasoning-effort level, pointing to Claude Code's `/effort`
  command.
- **MIT License.**
