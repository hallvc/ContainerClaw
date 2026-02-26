---
name: brainstorming
description: "Collaborative design and brainstorming before implementation. Use when starting a new feature, project, or creative task to explore requirements, propose approaches with tradeoffs, and get user approval before writing code."
---

# Brainstorming

Think before building. This skill ensures a design phase happens before any implementation.

## When to Use

- User asks to "build", "create", "implement", or "add" something non-trivial
- The task has multiple valid approaches
- Requirements are vague or incomplete
- The task will take more than a few minutes to implement

## Process

### Step 1: Understand Context

Before asking the user anything, gather information yourself:

- Read relevant files in the workspace to understand existing patterns
- Check what technologies/frameworks are already in use
- Look at how similar features are implemented

### Step 2: Clarify Intent

Ask the user **one question at a time**. Build on their answers. Do not batch multiple questions.

Good:
```
"What's the primary goal for this feature?"
→ [user answers]
"Got it. Should this be accessible to all users or just admins?"
→ [user answers]
```

Bad:
```
"What's the goal? Who are the users? What's the timeline?
What about edge cases? Should it be mobile-responsive?"
```

### Step 3: Propose Approaches

Present 2-3 options with tradeoffs. Structure each option clearly:

```
### Option A: [Name]
**Approach:** [1 sentence]
**Pros:** [bullets]
**Cons:** [bullets]
```

After presenting options, ask for the user's reaction. Do not present all options at once if there are more than 3 -- chunk them.

End with a recommendation and why.

### Step 4: Present Design

Break the design into digestible sections. Present each section and get acknowledgment before moving to the next. Scale detail to complexity:

- Small feature: 2-3 sections
- Medium feature: 4-6 sections
- Large project: save full design to a document

### Step 5: Get Approval

Before any implementation:

1. Summarize the agreed design
2. Ask for explicit approval: "Ready to start building?"
3. Save the design to the workspace if it's substantial

## Hard Gate

**No implementation until the user approves the design.** This applies regardless of how simple the task seems. Even "simple" tasks benefit from a 30-second design check.

Exceptions:
- User explicitly says "just do it" or "skip the design"
- The task is purely mechanical with zero design decisions (rename a variable, fix a typo)

## Design Output

For substantial designs, save to the workspace:

```
docs/designs/YYYY-MM-DD-<topic>.md
```

Include:
- Goal (1-2 sentences)
- Approach chosen (with rationale)
- Key decisions made during brainstorming
- Implementation steps (high-level)

## Anti-patterns

| Temptation | Why it fails |
|-----------|-------------|
| "This is too simple to design" | Simple tasks with wrong assumptions waste more time than 30 seconds of alignment |
| "I'll design as I go" | You'll commit to the first approach and miss better options |
| "The user said 'build X' so I should just build X" | "Build X" is what, not how -- the design decisions still need to be made |
| Asking 5 questions at once | Decision fatigue leads to shallow answers |
