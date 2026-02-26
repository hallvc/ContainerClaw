---
name: code-review
description: "Structured code review for quality, security, and maintainability. Use when reviewing code changes, pull requests, or when the user asks for a code review. Also use after writing substantial code to self-review before delivery."
---

# Code Review

## Review Process

### 1. Understand the change

Before reviewing line by line:
- What is this change trying to accomplish?
- What files are modified and why?
- Is there a related issue, PR description, or spec?

### 2. Review by category

Evaluate across five categories:

| Category | What to check |
|----------|--------------|
| **Security** | Input validation, injection risks, auth/authz, secrets exposure, OWASP top 10 |
| **Code Quality** | Logic errors, null/undefined handling, error handling, edge cases |
| **Performance** | N+1 queries, unnecessary allocations, missing caching, algorithmic complexity |
| **Best Practices** | Naming, DRY violations, dead code, test coverage, consistent patterns |
| **Maintainability** | Readability, documentation needs, coupling, complexity |

### 3. Rate each finding

| Severity | Meaning | Action |
|----------|---------|--------|
| **CRITICAL** | Security vulnerability, data loss, crash in production | Must fix before merge |
| **HIGH** | Logic bug, missing validation, significant performance issue | Should fix before merge |
| **MEDIUM** | Code smell, poor naming, missing edge case handling | Fix recommended |
| **LOW** | Style nit, minor improvement, documentation gap | Optional |

### 4. Format each finding

```
**[SEVERITY]** category -- file:line

What: [What's wrong]
Why: [Why it matters]
Fix: [How to fix it]
```

Example:
```
**[HIGH]** Security -- src/api/users.ts:45

What: User input passed directly to SQL query without parameterization
Why: SQL injection vulnerability -- attacker can read/modify database
Fix: Use parameterized query: `db.query("SELECT * FROM users WHERE id = $1", [userId])`
```

### 5. Deliver verdict

End every review with one of:

- **APPROVE** -- no critical/high issues, good to merge
- **REQUEST CHANGES** -- critical or high issues must be addressed
- **COMMENT** -- suggestions only, author decides

## Self-Review Checklist

Before delivering code, review your own work:

- [ ] Does it actually solve the stated problem?
- [ ] Are there edge cases not handled?
- [ ] Are error messages helpful to the end user?
- [ ] Is there any dead code or debugging artifacts left?
- [ ] Are secrets, keys, or credentials exposed?
- [ ] Does it follow existing patterns in the codebase?

## Receiving Review Feedback

When feedback is received on your code:

1. **Read all feedback first** before responding to any item
2. **Understand the concern** -- restate it to confirm understanding
3. **Evaluate technically** -- is the feedback correct? Check the code.
4. **Respond factually** -- avoid performative agreement ("Great catch!") or defensiveness
5. **Push back when warranted** -- if feedback is technically incorrect, explain why with evidence
6. **Fix blocking issues first** (critical/high), then simple fixes, then complex ones

### Response protocol

- If feedback is correct: fix it, no fanfare needed
- If feedback is incorrect: "This is actually handled by [specific mechanism] at [file:line]"
- If feedback is unclear: ask for clarification before implementing any changes

See [references/review-template.md](references/review-template.md) for a structured review prompt template.
