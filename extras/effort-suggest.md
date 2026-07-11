---
description: Analyze the current work and recommend the optimal effort (reasoning) level
argument-hint: [optional description of the next task]
---

Analyze the **current task of this session** (and, if given, the next task described here:
"$ARGUMENTS") and recommend the **effort/reasoning level** best suited for Claude Code.

Effort scale: `low` · `medium` · `high` · `xhigh` · `max`
(higher = deeper reasoning, but slower and more expensive in tokens/quota).

Assess the task briefly on these axes:
- **Reasoning depth** — does it need multi-step planning, architectural trade-offs, non-obvious
  debugging? → raise. Is it mechanical (rename, local edits, lookup, boilerplate, applying an
  already-made decision)? → lower.
- **Ambiguity / risk of error** — vague requirements, or high cost of getting it wrong? → raise.
- **Breadth** — touches many files/subsystems, or requires reasoning over a large context? → raise.
- **Reversibility** — if it's easy to fix later, no need to overdo it → lower.

Answer **CONCISELY**:
1. **Recommended level** (one word from the scale; a range if uncertain).
2. **Why** — max 2 lines, cite the decisive axes.
3. **How to set it** — run **`/effort`** and pick the level (*Set effort level for model usage*).
   The current level is in the badge after the model name in the status line.

If the task is mixed (simple parts + complex parts), recommend the level for the **dominant**
part and flag when it's worth raising/lowering it on the fly.
