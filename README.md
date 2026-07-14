# ⛽ Claude Code Fuel Gauge

> **Know your Pro/Max rate-limit quota — and never hit the wall by surprise.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-required-339933?logo=node.js&logoColor=white)](https://nodejs.org)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![Single file](https://img.shields.io/badge/single%20file-statusline.mjs-blue)
![Platforms](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-lightgrey)

A single-file, dependency-free status line for [Claude Code](https://claude.com/claude-code)
built for **subscription** users (Pro / Max), not API users.

> On a subscription the marginal **$ is zero** — it doesn't measure anything real.
> The currency you actually spend is your **rate-limit quota** (the 5-hour and weekly
> windows) and the **size of your context** (more tokens = more per-turn usage + higher
> context-rot risk). This status line drops the `$` entirely and shows you *that* instead.

```
Opus 4.8 (1M context) · xhigh 💭  ctx ▓░░░░░░░░░ 67k/1.0M 7%  cache 89%  turn 7.2k  5h 20% ~14 msg → (⚠  Pro~100%) ↻ 3h18m (18:42) · wk 16% ↻ 3d13h (Wed 09:00)
```

That **`~14 msg`** is the headline: ≈ how many more prompts you can send before the 5-hour
window caps, at *your* recent pace. It renders on **one line** when the terminal is wide
enough, and automatically **splits into two** when it isn't:

```
Opus 4.8 (1M context) · xhigh 💭  ctx ▓░░░░░░░░░ 67k/1.0M 7%  cache 89%  turn 7.2k
5h 20% ~14 msg → (⚠  Pro~100%) ↻ 3h18m (18:42) · wk 16% ↻ 3d13h (Wed 09:00)
```

When the context grows, the bar changes color by zone and adds an actionable hint plus
`↓ N` = how many tokens you could reclaim by compacting:

```
… ctx ▓▓▓▓▓░░░░░ 455k/1.0M 45% ⚠ compact! (context rot!) ↓ 255k …
```

Live (colors in a real terminal):

![Claude Code QUOTA-aware status line](assets/screenshot.png)

## Forgot what a symbol means? Run `/quota`

The line is a *glance*. When you want the whole thing spelled out — with **your real latest
values** — run the bundled `/quota` slash command. It prints an annotated legend of every
segment (context, trend sparkline, `~N msg`, Pro projection, weekly pace, reset clock, …):

```
⛽ Fuel Gauge — how to read your status line
last render just now · Opus 4.8 (1M context) · xhigh 💭

CONTEXT
  ctx ▓░░░░░░░░░ 130k/1.0M 13%   context used vs the TRUE model window — colors are risk zones
      ↗ compact in ~6 turns      at the current growth rate, when you'll cross the /compact line
  turn 13k                       FRESH tokens this turn (the re-read context is excluded)
  cache 92%                      share of input served from cache — higher = cheaper & faster

5-HOUR WINDOW
  5h 24% (+4%)                   quota used · (+X%) = burned this window
  ~38 msg left                   ≈ prompts remaining before the cap, at your recent pace (~2.0%/msg)
  pooled across 2 sessions       the per-msg pace is shared, so "~N msg" stays honest with several windows open
  ▁▂▃▅█                          recent 5h-burn trend (this machine)
  → (⚠  Pro~120%)                the same usage projected onto the Pro plan (rough ×5 gauge)
  ↻ 3h59m (15:01)                resets in / at

WEEKLY WINDOW
  wk 38% (+2%)                   quota used · (+X%) = burned this window
  over pace ⚠                    spent 38% vs ~33% of the week elapsed (steady-spend reference)
  ↻ 1d3h (Tue 14:00)             resets in / at
  ◀ binding constraint           of the two windows, this is the one that caps first
```

`/quota` is installed by the one-command installer. (Manual install: drop `extras/quota.md`
into `~/.claude/commands/`.) The values come from a tiny snapshot the status line writes on
each render — so the deep-dive needs no extra API calls.

## Why

Under a subscription you aren't paying per token. The traditional "cost" status line
(`$0.42`) is meaningless: that money is already spent, fixed, and sunk. What you can
actually run out of is **quota** and **usable context**. So this bar is organized around:

- **quota** — how much of your 5-hour and weekly windows you've burned, and when they reset;
- **context** — how full the true model window is, with color-coded zones and compaction hints;
- **per-turn work** — how fast the context is growing (fresh tokens, *not* the whole re-read context).

## What makes it different

Most Claude Code status lines are built around **dollar cost** and are aimed at API users. This
one is built for subscribers, and a few of its ideas don't (yet) exist elsewhere in the ecosystem:

- **`~N msg` remaining** — your leftover quota translated into *how many more prompts you can send*
  before the 5-hour window caps, from your own measured pace. Humans think in messages, not
  percentages. I haven't seen this anywhere else. The pace is **pooled across every Claude Code
  window on the machine**, so the number stays honest with several sessions open (`/quota` says
  "pooled across N sessions"); the rare cross-machine case is flagged with `‖`.
- **`/quota` explained view** — a full annotated legend of every segment, populated with your real
  values (from a snapshot the line persists — no extra API calls). The line is the glance; `/quota`
  is the manual.
- **`Pro~` cross-plan projection** — estimates your current usage against the Pro plan so you can
  see, at a glance, whether Pro would cover you or you're right to be on Max.
- **`turn` = fresh tokens only** — input + cache-write + output, *excluding* the re-read context.
  It's the context-growth rate, not a second copy of the context size.
- **Proactive compaction hint with `↓ N` reclaimable** — tells you *now* how much you'd reclaim by
  compacting, before you hit the wall (not a retrospective count of past compactions).
- **No dollar cost, on purpose** — under a subscription the marginal `$` is zero; the bar spends its
  pixels on quota and context instead.

## Features

- **No `$`.** Quota + context + per-turn tokens instead.
- **True context ceiling.** Scaled to the real `context_window_size` (e.g. 1M for Opus 1M),
  decoupled from any autocompact override.
- **4-color risk scale** (green → yellow → orange → red) on every indicator.
- **Actionable compaction hints** at absolute thresholds — advisory only, *you* decide.
- **`↓ N` reclaimable-tokens** estimate once you pass the compact threshold.
- **`~N msg` remaining** — quota translated into how many more prompts fit before the 5h window
  caps, at your recent pace (self-gated: appears once there's enough signal to be honest). The pace
  is **pooled across all your open windows** on this machine, so it doesn't jump between sessions;
  the marker `‖` flags the rare case of another *machine* also spending the quota.
- **`↗ compact ~N` heads-up** — projects context growth and warns ~N turns *before* you'll cross
  the `/compact` line (only when it's close).
- **Per-window quota delta** `(+X%)` — how many quota points burned since this window opened.
- **`Pro~` projection** — estimates the same usage against the Pro plan, so you can judge
  whether Pro would be enough (or whether you're safe on Max).
- **`/quota` explained view** — bundled slash command that prints an annotated legend (with a
  trend sparkline and a weekly steady-spend pace check) using your real latest values.
- **Reset countdowns + wall-clock time** `↻ 3h18m (18:42)` — both *how long* until each window
  resets and *at what time* (weekday-prefixed when it's more than ~20h out, e.g. `Wed 09:00`). The
  countdown **ticks down live while you're idle** (the installer sets `refreshInterval`; see below).
- **Binding-constraint marker** `◀` — flags whichever window (5h vs weekly) is closer to its own
  cap, i.e. the one that will bite first (only when it's ≥50% and there's a real gap).
- **Burn-rate warning** `⚠ full ~45m` — if, at your *recent* average pace, a window would hit
  100% **before** it resets, it warns you with the projected time-to-full. Hidden otherwise.
- **Cache hit %** and **cold-turn** warning.
- **Optional orientation** — a non-default output style shows automatically; git branch + dirty
  flag and the project-dir name are opt-in (see Configuration).
- **Adaptive layout** — 1 line if it fits `COLUMNS`, else 2.
- **Stale-data fallback** — shows the last known quota (marked `*`) at launch, before the
  first API round-trip populates `rate_limits`.
- **Update nudge** — when a newer version is published, a subtle `⬆ vX.Y.Z` appears in the header.
  The check runs at most **once a day** in a detached, fail-silent background process (it never
  blocks the line); disable with `CC_SL_UPDATE=0`.
- **Zero dependencies**, single `.mjs` file, never writes to stderr, never throws.

## The segments

| Segment | Example | Meaning |
|---|---|---|
| Model + badge | `Opus 4.8 (1M context) · xhigh 💭` | Model name; effort level; `💭` thinking, `⚡` fast mode |
| Context bar | `ctx ▓░░░░░░░░░ 67k/1.0M 7%` | Fill + zone colors against the true window; `used/window` and `%` |
| Compact heads-up | `↗ compact ~6` | ≈ turns until you'll cross the `/compact` line at the current growth (shown only when close) |
| Compaction hint | `~ compact (save token) ↓ 50k` | Advisory at thresholds; `↓ N` = tokens reclaimable by `/compact` |
| Cache | `cache 89%` | Share of input served from cache last turn (high = good) |
| Turn | `turn 7.2k` | **Fresh** tokens this turn (new input + cache write + output; **excludes** the re-read context) |
| Messages left | `~14 msg` | ≈ prompts remaining before the 5h cap, at the machine's pooled pace across open windows (self-gated); `‖` = contested by another device |
| 5h limit | `5h 20% (+6%) ~14 msg → (⚠  Pro~100%) ↻ 3h18m (18:42) ◀` | 5-hour window %, session delta, messages-left, Pro-plan projection, reset countdown + wall-clock time; `◀` = binding constraint |
| Weekly limit | `wk 16% ↻ 3d13h (Wed 09:00)` | Weekly window %, session delta, reset countdown + wall-clock time |
| Burn warning | `⚠ full ~45m` | Shown only if the window will hit 100% before it resets at the session's average pace |
| *(opt-in)* dir + git | `statusline ⎇ main*` | Project-dir name (`CC_SL_CWD=1`) and git branch + dirty flag (`CC_SL_GIT=1`) |
| *(auto)* output style | `· style:concise` | Shown when the output style is non-default |
| *(auto)* update nudge | `· ⬆ v1.2.0` | A newer version is out — re-run the installer to update (`/quota` shows the command) |

## Requirements

- [Node.js](https://nodejs.org) (any recent version) on your `PATH`.
- Claude Code with the `statusLine` command feature.
- A terminal with **256-color** and **emoji** support (Windows Terminal, iTerm2, most modern
  terminals). The orange zone uses 256-color `38;5;208`.

## Install

### Quick install (script)

One command — it copies `statusline.mjs` into `~/.claude/` and wires it into your
`settings.json`, **backing up** any existing file and **preserving your other settings** (the
JSON merge is done with Node, so nothing else is touched). Requires **Node.js** on your `PATH`
(the status line runs on Node).

**macOS / Linux:**

```sh
curl -fsSL https://raw.githubusercontent.com/ilcristofer/claude-code-quota-statusline/main/install.sh | sh
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/ilcristofer/claude-code-quota-statusline/main/install.ps1 | iex
```

To also install the `/effort-suggest` companion (see below), add the flag:

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/ilcristofer/claude-code-quota-statusline/main/install.sh | sh -s -- --with-effort-suggest
```

```powershell
# Windows
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/ilcristofer/claude-code-quota-statusline/main/install.ps1))) -WithEffortSuggest
```

Then **restart Claude Code** (or start a new session). Rather not pipe a script from the
internet? Clone the repo and run `./install.sh` / `./install.ps1` locally — same result — or
follow the manual steps below.

### Manual install

1. Copy `statusline.mjs` somewhere stable, e.g. `~/.claude/statusline.mjs`.
2. Point your `~/.claude/settings.json` at it:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline.mjs",
    "padding": 2
  }
}
```

On **Windows** use the full path with forward slashes, e.g.:

```json
"command": "node C:/Users/YOU/.claude/statusline.mjs"
```

3. Restart Claude Code (or start a new session). The quota segments appear after the first
   API round-trip; before that you'll see the last known values marked with `*`.

### Staying up to date

The status line checks for a newer version **once a day** and, when one is out, shows a small
`⬆ vX.Y.Z` nudge in the header. To update, just re-run the installer above — it's idempotent and
backs up your current file — or run `/quota`, which prints the exact command. The check runs in a
**detached, fail-silent** background process (it never blocks or slows the line, and sends nothing
but a plain GET to GitHub); disable it entirely with `CC_SL_UPDATE=0`.

## Configuration

All knobs are environment variables — set them in your shell, or in the `env` block of
`settings.json`. All are optional.

| Variable | Default | What it does |
|---|---|---|
| `CC_SL_HINT_COMPACT` | `200000` | Token threshold for the yellow "consider /compact" zone |
| `CC_SL_HINT_CLEAR` | `400000` | Token threshold for the orange "context rot / clear" zone |
| `CC_SL_PRO_FACTOR` | `5` | Multiplier for the `Pro~` projection (5h Max → Pro). **Recalibrate for your own usage.** |
| `CC_SL_BURN` | `1` (on) | Set to `0` to hide the `⚠ full ~Yh` burn-rate warning |
| `CC_SL_GIT` | `0` (off) | Set to `1` to show the git branch + dirty flag (spawns `git` once per render) |
| `CC_SL_CWD` | `0` (off) | Set to `1` to show the project-dir basename |
| `CC_SL_UPDATE` | `1` (on) | Set to `0` to disable the once-a-day check for a newer version (see [Staying up to date](#staying-up-to-date)) |
| `COLUMNS` | *(set by Claude Code)* | Terminal width used to decide 1-line vs 2-line layout |

The default thresholds (200k / 400k) are tuned for a **1M** context window. On a 200k model
they won't trigger usefully — lower them (e.g. `40000` / `120000`).

> **`Pro~` is an estimate, not a guarantee.** The default `×5` factor comes from one user's
> measured ratio and is not published by Anthropic. Treat it as a rough gauge and recalibrate
> `CC_SL_PRO_FACTOR` against your own numbers.

### Live countdowns (`refreshInterval`)

The installer sets `refreshInterval: 30` on the `statusLine` block in `settings.json`, so Claude
Code re-runs the line every 30 seconds *in addition to* its event-driven updates — the reset
countdowns (`↻ 3h18m`) keep ticking down while you're idle at the prompt instead of freezing until
the next message. It's purely a wall-clock refresh: quota `%` and context don't change until the
next real turn (Claude Code only recomputes those from a fresh API response). Tune it in
`settings.json` (integer seconds, minimum `1`) or remove the key to render on events only:

```json
"statusLine": { "type": "command", "command": "node …/statusline.mjs", "padding": 2, "refreshInterval": 30 }
```

## Recommended: let *yourself* control compaction

If you're on a large-context model (e.g. Opus 1M), check your autocompact settings. Values
like `CLAUDE_CODE_AUTO_COMPACT_WINDOW=250000` will force compaction at ~200k and quietly cap
your 1M window to a fraction of it. To keep the full window and let the bar's hints guide
*your* decision (with a high safety net), something like:

```json
{
  "env": {
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "1000000",
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "90"
  }
}
```

Env vars are read at startup — restart Claude Code for changes to take effect. Tune to taste;
this is a safety net, not a recommendation to never compact.

## How it works

Claude Code invokes the `statusLine` command on every render and passes a JSON payload on
**stdin** (no transcript needed). The script reads `context_window`, `rate_limits`, `effort`,
`thinking`, `fast_mode`, `model`, and (for the optional segments) `output_style` and `workspace`
from it, and writes the formatted line to **stdout only**. The opt-in git segment
(`CC_SL_GIT=1`) shells out to `git` — guarded by a timeout and `try/catch` so it can never hang or
crash the line — which is why it's off by default. The only other touch outside the payload is the
once-a-day update check (disable with `CC_SL_UPDATE=0`), which runs in a **detached** background
process so the render itself never waits on the network.

`rate_limits` is derived from the last API response headers, so it's absent for the very first
render of a session; the script persists the last known values to the OS temp dir and shows
them as stale (`*`) until fresh data arrives. Quota deltas are baselined per reset-window so they
restart cleanly when a window rolls over.

The `~N msg` pace is **pooled across every Claude Code window on the machine** via a small shared
file in the temp dir (`used_percentage` is account-global, so the per-message rate has to be too —
otherwise the number would jump between windows). A second *machine* can't share that file, so if
its usage moves the quota while this machine is idle, the line flags `~N msg` with `‖` and reads
conservatively rather than pretending it can see the other device.

## Companion: `/effort-suggest`

`extras/effort-suggest.md` is an optional Claude Code slash command that analyzes your current
task and recommends an effort level. Drop it in `~/.claude/commands/` to enable `/effort-suggest`.

## License

[MIT](LICENSE) © 2026 ilcristofer. Free to use, modify, and distribute — attribution appreciated.

## Author

Made by **ilcristofer**. Issues, ideas, and PRs welcome.
