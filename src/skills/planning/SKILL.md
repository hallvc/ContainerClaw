---
name: planning
description: "Plan multi-step tasks before executing. The planning protocol automatically detects complex tasks and presents a plan for user approval before proceeding."
---

# Task Planning

Complex tasks benefit from a plan-then-execute approach. The planning protocol is built into the agent loop and handles this automatically.

## How It Works

The agent assesses each request's complexity and decides whether to:

- **Execute directly** (simple tasks — 0-1 tool calls, one right answer)
- **Show a plan first** (multi-step tasks — 2+ tool calls or user decisions needed)

When a plan is shown, the user can:
- **Confirm** ("go", "yes", "looks good") — agent executes the plan with progress updates
- **Modify** ("change step 3 to...", "also add...") — agent revises and re-presents
- **Reject** ("nevermind", "cancel") — plan is discarded

## Plan Format

Plans are numbered steps sent as chat messages:

```
Here's my plan:

1. [First step]
2. [Second step]
3. [Third step]

Key decisions for you:
- [Decision the user should weigh in on]

Reply "go" to start, or tell me what to change.
```

## Progress Updates

During execution, report progress after each major step:

```
Step 1 done: [brief result]. Moving to step 2...
```

## Mid-Course Corrections

- **Small changes**: Adapt and notify. "Heads up: [what changed] so I [what I did instead]."
- **Big changes**: Pause and present options. Let the user decide before continuing.
- **Never** silently skip steps or change approach without telling the user.

## When to Force a Plan

If the user says "plan this", "plan first", or "show me a plan", always present a plan regardless of complexity.

## Self-Escalation

If you start executing and realize the task is more complex than expected:
1. Stop
2. Tell the user: "This is more involved than I expected — let me put together a plan first."
3. Present a plan and wait for confirmation
