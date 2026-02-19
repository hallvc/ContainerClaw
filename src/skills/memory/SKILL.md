---
name: memory
description: Layered markdown memory system with daily notes, learnings, and smart retrieval.
always: true
---

# Memory

## Structure

```
memory/
├── MEMORY.md        — Synthesized wisdom (always loaded). Updated weekly.
├── daily/           — One file per day (YYYY-MM-DD.md). Raw conversation capture.
├── learnings/       — Permanent agent learnings. Corrections, patterns, preferences.
├── tasks/           — Append-only task records. Never edited post-creation.
├── entities/        — People, projects, tools mentioned in conversations.
├── archive/         — Monthly archives of old daily notes.
└── .index.json      — Derived search index (rebuilt automatically).
```

## Daily Notes

Every conversation is captured in `daily/YYYY-MM-DD.md`. These are the primary capture mechanism — write first, synthesize later.

Format:
```markdown
## [HH:MM] [channel:user] Title
- Bullet point facts
- Decisions made
- TODOs identified
```

## Learnings (the `learn` tool)

Use the `learn` tool to save important knowledge permanently. Learnings are loaded into **every** conversation.

**When to use `learn`:**
- User corrects a previous behavior ("No, don't do it that way")
- You discover a non-obvious pattern in the codebase or workflow
- A preference is stated that should persist forever ("Always use TypeScript")
- A correction to your own mistake

**Example:**
```
learn(topic="deploy-workflow", content="When deploying to staging, always run the health check endpoint after deploy completes. The user was frustrated when we skipped this step.", source="correction")
```

## MEMORY.md (Synthesized Wisdom)

Updated weekly by automatic synthesis. Contains distilled patterns, preferences, and key context. Do NOT manually rewrite this file — it's managed by the weekly synthesis job.

## Search Past Events

The system automatically recalls relevant past context based on the current conversation. You can also search manually:

```bash
grep -i "keyword" memory/daily/*.md
grep -i "keyword" memory/learnings/*.md
```

## When to Update Memory

- **Automatic**: Conversation facts are extracted to daily notes after each session
- **Use `learn` tool**: For corrections, patterns, and permanent preferences
- **Don't touch MEMORY.md directly**: It's synthesized weekly from daily notes

## Auto-consolidation

Two-tier consolidation:
1. **Per-conversation** (Tier 1): Facts extracted and appended to today's daily note
2. **Weekly synthesis** (Tier 2): All daily notes from the week are synthesized into MEMORY.md

Old daily notes (>30 days) are automatically archived to `archive/YYYY-MM.md`.
