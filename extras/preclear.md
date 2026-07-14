---
description: Prepare the session for a safe /clear — check uncommitted work, sync docs, and write a handoff that auto-restores after you clear
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(node:*), Read, Edit, Write
---

The user is about to `/clear` this session and wants to do it **safely** — without losing context or scope. Prepare the session, then hand off. Be concise: the chat is about to be discarded.

Captured now:
- **git status:** !`git status --short --branch`
- **handoff file** (write the handoff to THIS path): !`node "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/statusline.mjs" handoff-file`

Do these steps in order:

1. **Uncommitted work.** If git status shows changes, summarize them in one line and **ask** the user whether to commit (propose a message). Commit only on confirmation. If the tree is clean, say so and move on. Never commit without asking.

2. **Docs / memory.** If this session changed behavior, decisions, or ongoing work, say whether CLAUDE.md / README / memory need a quick update. Do the update only if it's clearly warranted; otherwise just flag it. Don't invent work.

3. **Clear vs compact.** Give a one-line recommendation: if the next task is unrelated and the context is large → `/clear` (fresh start) is right; if you're mid-task and want to keep the thread → suggest `/compact` instead. (You can inspect context/quota with `node "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/statusline.mjs" explain` if useful.)

4. **Write the handoff.** Using the **Write** tool, write a concise, factual handoff to the exact *handoff file* path shown above. It survives the clear and is **auto-injected into your next session**, so write it **to your future self**, not to the user. Structure:
   - **Goal / task** and any explicit constraints or acceptance criteria the user gave.
   - **Decisions made and why** — the chosen approach and the alternatives you rejected.
   - **Concrete facts costly to rediscover** — exact file paths, function/symbol names, config keys, commands run, version numbers, results/measurements.
   - **Open threads** — what's in progress, the planned next step, unresolved questions or blockers.
   - **User preferences / corrections** expressed this session.

   Keep it tight — maximize the useful work that survives per token. No file dumps: a path plus one line on what changed. Write in the user's language.

5. **Finish.** Print 2–3 lines: `✅ handoff saved`, the one-line goal, and tell the user: **type `/clear` now — the next session picks this up automatically** (or `/compact`, per your recommendation). Do **not** try to clear yourself — you can't; the user types it.
