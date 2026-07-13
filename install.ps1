#!/usr/bin/env pwsh
# install.ps1 — installer for the QUOTA-aware Claude Code status line (Windows).
#
# Usage:
#   irm https://raw.githubusercontent.com/ilcristofer/claude-code-quota-statusline/main/install.ps1 | iex
#   # also install /effort-suggest:
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/ilcristofer/claude-code-quota-statusline/main/install.ps1))) -WithEffortSuggest
#   ./install.ps1 [-WithEffortSuggest]   # from a local clone
#
# What it does: copies statusline.mjs into ~/.claude/, then merges ONLY the "statusLine"
# key into ~/.claude/settings.json (backing it up first) — everything else is preserved.
# The JSON merge is done with Node, which is required anyway (the status line runs on it).
param([switch]$WithEffortSuggest)

$ErrorActionPreference = 'Stop'

$RepoRaw   = 'https://raw.githubusercontent.com/ilcristofer/claude-code-quota-statusline/main'
$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$Dest      = Join-Path $ClaudeDir 'statusline.mjs'
$Settings  = Join-Path $ClaudeDir 'settings.json'

# 1) Node is mandatory — the status line is a Node script.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js is required (the status line runs on Node) but was not found on PATH. Install it from https://nodejs.org and re-run."
  exit 1
}

New-Item -ItemType Directory -Force -Path $ClaudeDir | Out-Null

# 2) Source statusline.mjs: prefer a local copy (running from a clone), else download.
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { $null }
$LocalSrc  = if ($ScriptDir) { Join-Path $ScriptDir 'statusline.mjs' } else { $null }
if ($LocalSrc -and (Test-Path $LocalSrc)) {
  Write-Host "Using local statusline.mjs from $ScriptDir"
  Copy-Item $LocalSrc $Dest -Force
} else {
  Write-Host "Downloading statusline.mjs ..."
  Invoke-RestMethod -Uri "$RepoRaw/statusline.mjs" -OutFile $Dest
}

# 3) Sanity check the file we're about to wire in.
& node --check $Dest
if ($LASTEXITCODE -ne 0) {
  Write-Error "statusline.mjs failed a Node syntax check; aborting without touching settings."
  exit 1
}

# 4) Merge the statusLine key into settings.json (backup first, preserve everything else).
if (Test-Path $Settings) {
  $bak = "$Settings.bak.$(Get-Date -Format 'yyyyMMddHHmmss')"
  Copy-Item $Settings $bak -Force
  Write-Host "Backed up existing settings to $bak"
}

$CmdPath = ($Dest -replace '\\', '/')      # forward slashes: robust for node on Windows
$Command = "node `"$CmdPath`""
# Merge with Node (already required). IMPORTANT: pass the JS via a temp .cjs FILE and the two
# values via ENV VARS — never as `node -e <string>` / native args. Windows PowerShell mangles the
# embedded double-quotes when handing a quoted string to a native exe (it corrupted "\n" -> \n,
# which broke the merge). File + env vars sidestep native-arg quoting entirely. .cjs forces
# CommonJS so require() works regardless of any package.json in the temp dir.
$MergeJs = @'
const fs = require("fs");
const file = process.env.CC_SL_SETTINGS, command = process.env.CC_SL_COMMAND;
let s = {};
try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { s = {}; }
if (typeof s !== "object" || s === null || Array.isArray(s)) s = {};
s.statusLine = { type: "command", command: command, padding: 2 };
fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
'@
$MergeTmp = Join-Path ([System.IO.Path]::GetTempPath()) "cc-sl-merge-$PID.cjs"
Set-Content -Path $MergeTmp -Value $MergeJs -Encoding ascii
$env:CC_SL_SETTINGS = $Settings
$env:CC_SL_COMMAND  = $Command
try {
  & node $MergeTmp
  $mergeExit = $LASTEXITCODE
} finally {
  Remove-Item $MergeTmp -Force -ErrorAction SilentlyContinue
  Remove-Item Env:\CC_SL_SETTINGS -ErrorAction SilentlyContinue
  Remove-Item Env:\CC_SL_COMMAND  -ErrorAction SilentlyContinue
}
if ($mergeExit -ne 0) { Write-Error "Failed to update settings.json."; exit 1 }

# 5) Companion: /quota slash command (installed by default — it's how you read the line).
$CmdDir = Join-Path $ClaudeDir 'commands'
New-Item -ItemType Directory -Force -Path $CmdDir | Out-Null
$DestQuota = Join-Path $CmdDir 'quota.md'
$LocalQuota = if ($ScriptDir) { Join-Path $ScriptDir 'extras/quota.md' } else { $null }
if ($LocalQuota -and (Test-Path $LocalQuota)) {
  Copy-Item $LocalQuota $DestQuota -Force
} else {
  Invoke-RestMethod -Uri "$RepoRaw/extras/quota.md" -OutFile $DestQuota
}
Write-Host "Installed /quota command to $DestQuota"

# 6) Optional companion: /effort-suggest slash command.
if ($WithEffortSuggest) {
  $DestEff = Join-Path $CmdDir 'effort-suggest.md'
  $LocalEff = if ($ScriptDir) { Join-Path $ScriptDir 'extras/effort-suggest.md' } else { $null }
  if ($LocalEff -and (Test-Path $LocalEff)) {
    Copy-Item $LocalEff $DestEff -Force
  } else {
    Invoke-RestMethod -Uri "$RepoRaw/extras/effort-suggest.md" -OutFile $DestEff
  }
  Write-Host "Installed /effort-suggest command to $DestEff"
}

Write-Host ""
Write-Host "OK  Status line installed to $Dest"
Write-Host "    settings.json -> statusLine: $Command"
Write-Host "    Tip: run /quota in Claude Code for an explained breakdown with your real values."
Write-Host "    Restart Claude Code (or start a new session) to see it."
