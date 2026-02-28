---
name: brainstorming
description: "Collaborative design and brainstorming before implementation. Use when starting a new feature, project, or creative task to explore requirements, propose approaches with tradeoffs, and get user approval before writing code."
---

# Brainstorming

Think before building. Use this approach for tasks with multiple valid solutions.

## When to Use

- The task has multiple valid approaches
- Requirements are vague or incomplete
- The outcome depends heavily on user preferences
- The user asks to "brainstorm", "explore options", or "think through" something

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

Present 2-3 options with tradeoffs:

```
### Option A: [Name]
**Approach:** [1 sentence]
**Pros:** [bullets]
**Cons:** [bullets]
```

End with a recommendation and why.

### Step 4: Present Design

Break the design into digestible sections. Scale detail to complexity:

- Small feature: 2-3 sections
- Medium feature: 4-6 sections
- Large project: save full design to a document

### Step 5: Plan and Confirm

Once the design is agreed, present it as a numbered plan for confirmation. The planning protocol will handle the confirm/execute/progress flow from there.

## Anti-patterns

| Temptation | Why it fails |
|-----------|-------------|
| "This is too simple to design" | Simple tasks with wrong assumptions waste more time than 30 seconds of alignment |
| "I'll design as I go" | You'll commit to the first approach and miss better options |
| "The user said 'build X' so I should just build X" | "Build X" is what, not how — the design decisions still need to be made |
| Asking 5 questions at once | Decision fatigue leads to shallow answers |
