---
description: Explain the QUOTA status line — annotated legend with your real values
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/statusline.mjs" explain`

The block above is the live "Fuel Gauge" legend for the status line — already formatted (colors
+ layout), filled in with the user's real latest values. **Do not repeat, reformat, or summarize
it.** Say nothing at all, unless one number is genuinely urgent (a window about to cap, context in
the red) — then add a single short line. If it says *"no live data yet"*, tell the user to use
Claude Code for a moment and rerun `/quota`.
