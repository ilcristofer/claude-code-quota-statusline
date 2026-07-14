#!/usr/bin/env sh
# install.sh — installer for the QUOTA-aware Claude Code status line (macOS / Linux).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ilcristofer/claude-code-quota-statusline/main/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --with-effort-suggest   # also install /effort-suggest
#   ./install.sh [--with-effort-suggest]                          # from a local clone
#
# What it does: copies statusline.mjs into ~/.claude/, then merges ONLY the "statusLine"
# key into ~/.claude/settings.json (backing it up first) — everything else is preserved.
# The JSON merge is done with Node, which is required anyway (the status line runs on it).
set -eu

REPO_RAW="https://raw.githubusercontent.com/ilcristofer/claude-code-quota-statusline/main"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
DEST="$CLAUDE_DIR/statusline.mjs"
SETTINGS="$CLAUDE_DIR/settings.json"
WITH_EFFORT=0
WITH_SAFECLEAR=0

for arg in "$@"; do
  case "$arg" in
    --with-effort-suggest) WITH_EFFORT=1 ;;
    --with-safe-clear) WITH_SAFECLEAR=1 ;;
    -h|--help)
      echo "Usage: install.sh [--with-effort-suggest] [--with-safe-clear]"
      exit 0 ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2 ;;
  esac
done

# 1) Node is mandatory — the status line is a Node script.
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required (the status line runs on Node) but was not found on PATH." >&2
  echo "Install it from https://nodejs.org and re-run this installer." >&2
  exit 1
fi

fetch() { # fetch <url> <dest>
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    echo "Error: need 'curl' or 'wget' to download files." >&2
    exit 1
  fi
}

mkdir -p "$CLAUDE_DIR"

# 2) Source statusline.mjs: prefer a local copy (running from a clone), else download.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd 2>/dev/null || true)
if [ -n "${SCRIPT_DIR:-}" ] && [ -f "$SCRIPT_DIR/statusline.mjs" ]; then
  echo "Using local statusline.mjs from $SCRIPT_DIR"
  cp "$SCRIPT_DIR/statusline.mjs" "$DEST"
else
  echo "Downloading statusline.mjs ..."
  fetch "$REPO_RAW/statusline.mjs" "$DEST"
fi

# 3) Sanity check the file we're about to wire in.
if ! node --check "$DEST" >/dev/null 2>&1; then
  echo "Error: statusline.mjs failed a Node syntax check; aborting without touching settings." >&2
  exit 1
fi

# 4) Merge the statusLine key into settings.json (backup first, preserve everything else).
if [ -f "$SETTINGS" ]; then
  BAK="$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
  cp "$SETTINGS" "$BAK"
  echo "Backed up existing settings to $BAK"
fi

CMD="node \"$DEST\""
CC_SL_SAFECLEAR="$WITH_SAFECLEAR" node -e '
const fs = require("fs");
const file = process.argv[1], command = process.argv[2];
let s = {};
try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { s = {}; }
if (typeof s !== "object" || s === null || Array.isArray(s)) s = {};
// refreshInterval (seconds, min 1) re-runs the line on a timer so reset countdowns tick while idle.
// Preserve a value the user already set; default to 30 on a fresh install.
var ri = (s.statusLine && typeof s.statusLine.refreshInterval === "number" && s.statusLine.refreshInterval >= 1) ? s.statusLine.refreshInterval : 30;
s.statusLine = { type: "command", command: command, padding: 2, refreshInterval: ri };
// Opt-in safe-clear: register the SessionStart(clear) hook that auto-restores the /preclear handoff.
// Preserve every other hook; idempotent (drop any prior cc-sl restore-handoff group, then add ours).
if (process.env.CC_SL_SAFECLEAR === "1") {
  if (typeof s.hooks !== "object" || s.hooks === null || Array.isArray(s.hooks)) s.hooks = {};
  var ss = Array.isArray(s.hooks.SessionStart) ? s.hooks.SessionStart : [];
  ss = ss.filter(function (g) { return !(g && Array.isArray(g.hooks) && g.hooks.some(function (h) { return h && typeof h.command === "string" && h.command.indexOf("restore-handoff") !== -1; })); });
  ss.push({ matcher: "clear", hooks: [ { type: "command", command: command + " restore-handoff" } ] });
  s.hooks.SessionStart = ss;
}
fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
' "$SETTINGS" "$CMD"

# 5) Companion: /quota slash command (installed by default — it's how you read the line).
mkdir -p "$CLAUDE_DIR/commands"
DEST_QUOTA="$CLAUDE_DIR/commands/quota.md"
if [ -n "${SCRIPT_DIR:-}" ] && [ -f "$SCRIPT_DIR/extras/quota.md" ]; then
  cp "$SCRIPT_DIR/extras/quota.md" "$DEST_QUOTA"
else
  fetch "$REPO_RAW/extras/quota.md" "$DEST_QUOTA"
fi
echo "Installed /quota command to $DEST_QUOTA"

# 6) Optional companion: /effort-suggest slash command.
if [ "$WITH_EFFORT" -eq 1 ]; then
  DEST_EFF="$CLAUDE_DIR/commands/effort-suggest.md"
  if [ -n "${SCRIPT_DIR:-}" ] && [ -f "$SCRIPT_DIR/extras/effort-suggest.md" ]; then
    cp "$SCRIPT_DIR/extras/effort-suggest.md" "$DEST_EFF"
  else
    fetch "$REPO_RAW/extras/effort-suggest.md" "$DEST_EFF"
  fi
  echo "Installed /effort-suggest command to $DEST_EFF"
fi

# 7) Optional companion: /preclear safe-clear command (the SessionStart hook was wired in step 4).
if [ "$WITH_SAFECLEAR" -eq 1 ]; then
  DEST_PC="$CLAUDE_DIR/commands/preclear.md"
  if [ -n "${SCRIPT_DIR:-}" ] && [ -f "$SCRIPT_DIR/extras/preclear.md" ]; then
    cp "$SCRIPT_DIR/extras/preclear.md" "$DEST_PC"
  else
    fetch "$REPO_RAW/extras/preclear.md" "$DEST_PC"
  fi
  echo "Installed /preclear command to $DEST_PC (+ SessionStart auto-restore hook)"
fi

echo ""
echo "✓ Status line installed to $DEST"
echo "  settings.json -> statusLine: $CMD"
echo "  Tip: run /quota in Claude Code for an explained breakdown with your real values."
[ "$WITH_SAFECLEAR" -eq 1 ] && echo "  Tip: run /preclear before a /clear to wrap up safely (handoff auto-restores after)."
echo "  Restart Claude Code (or start a new session) to see it."
