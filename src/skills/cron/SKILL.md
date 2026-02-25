---
name: cron
description: Schedule reminders and recurring tasks.
---

# Cron

Use the `cron` tool to schedule reminders or recurring tasks.

## Modes

Use the `mode` parameter to control how the job executes:

1. **Reminder** (`mode="reminder"`, default) - message is sent directly to user as-is, no agent processing
2. **Task** (`mode="task"`) - message is a task description, agent executes it and sends the result

Scheduling types (orthogonal to mode):
- **Recurring** - runs on an interval or cron expression
- **One-time** - runs once at a specific time via `at`, then auto-deletes

## Examples

Fixed reminder (delivered directly, no agent):
```
cron(action="add", message="Time to take a break!", every_seconds=1200)
```

Dynamic task (agent executes each time):
```
cron(action="add", message="Check HKUDS/nanobot GitHub stars and report", every_seconds=600, mode="task")
```

One-time reminder (compute ISO datetime from current time):
```
cron(action="add", message="Remind me about the meeting", at="<ISO datetime>")
```

One-time task:
```
cron(action="add", message="Generate a weekly summary of my GitHub activity", at="<ISO datetime>", mode="task")
```

List/remove:
```
cron(action="list")
cron(action="remove", job_id="abc123")
```

## Time Expressions

| User says | Parameters |
|-----------|------------|
| every 20 minutes | every_seconds: 1200 |
| every hour | every_seconds: 3600 |
| every day at 8am | cron_expr: "0 8 * * *" |
| weekdays at 5pm | cron_expr: "0 17 * * 1-5" |
| at a specific time | at: ISO datetime string (compute from current time) |
