---
name: planning
description: "Create structured implementation plans for multi-step tasks. Use when a task has 3+ steps, involves multiple files, or benefits from written planning before execution. Produces step-by-step plans with file paths, code snippets, and verification commands."
---

# Implementation Planning

For complex tasks, a written plan prevents the agent from losing track, going off-course, or missing steps.

## When to Plan

- Task involves 3+ implementation steps
- Multiple files need to be created or modified
- Task has dependencies between steps (order matters)
- User explicitly asks to "plan first" or "make a plan"

## When to Skip

- Single-file changes with obvious scope
- Quick fixes or typo corrections
- User says "just do it"

## Plan Structure

### Header

```markdown
# Plan: [Feature Name]

**Goal:** [1-2 sentences]
**Tech stack:** [relevant technologies]
**Estimated steps:** [count]
```

### Steps

Each step is one atomic action. Structure:

```markdown
## Step 1: [Action verb] [What]

**File:** `path/to/file.ext` (create | modify | test)

**What:** [1-2 sentences describing the change]

**Code:**
\```language
// exact code to write or change
\```

**Verify:**
\```bash
command to verify this step worked
\```
Expected output: [what success looks like]
```

### Step design rules

- **One action per step** -- "write the test" and "run the test" are separate steps
- **Exact file paths** -- relative to workspace root
- **Complete code** -- include full function/class, not just the diff
- **Explicit verification** -- every 2-3 steps should have a verify command
- **Commit points** -- mark natural commit boundaries

## Execution

### Batch execution

Execute steps in batches of 3-5, then pause for review:

```
Steps 1-3: [implement]
→ Verify batch
→ Report progress to user
→ Proceed if everything passes

Steps 4-6: [implement]
→ Verify batch
→ Report progress
→ ...
```

### Stop conditions

Stop and ask the user if:
- A step fails and the fix isn't obvious
- Requirements are unclear for the next batch
- You discover the plan needs significant changes
- Dependencies are missing

### Plan updates

If the plan needs to change during execution:
1. Note what changed and why
2. Update remaining steps
3. Inform the user of the change

## Saving Plans

Save plans to the workspace:

```
docs/plans/YYYY-MM-DD-<feature-name>.md
```

This enables:
- Resuming work across sessions
- Reviewing what was planned vs. what was built
- Reusing plans for similar features

## Plan Quality Checklist

- [ ] Every step has an exact file path
- [ ] No step requires more than 5 minutes of work
- [ ] Verification steps are included every 2-3 implementation steps
- [ ] Dependencies between steps are ordered correctly
- [ ] The plan addresses error handling, not just the happy path
