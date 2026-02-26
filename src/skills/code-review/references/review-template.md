# Code Review Template

Use this template when performing a structured code review. Copy and fill in relevant sections.

## Review Header

```
**Reviewer:** [agent/name]
**Files reviewed:** [list of files]
**Change summary:** [1-2 sentence description of what changed]
```

## Findings

### Security

| Severity | File:Line | Issue | Fix |
|----------|-----------|-------|-----|
| | | | |

Check for:
- SQL/NoSQL injection (string concatenation in queries)
- XSS (unsanitized user input in HTML/templates)
- Command injection (user input in shell commands)
- Path traversal (user input in file paths)
- Hardcoded secrets (API keys, passwords, tokens)
- Missing authentication/authorization checks
- Insecure deserialization
- CORS misconfiguration

### Code Quality

| Severity | File:Line | Issue | Fix |
|----------|-----------|-------|-----|
| | | | |

Check for:
- Null/undefined not handled
- Error cases silently swallowed
- Logic errors (off-by-one, wrong comparator, inverted condition)
- Missing input validation at system boundaries
- Resource leaks (unclosed connections, file handles)
- Race conditions in async code

### Performance

| Severity | File:Line | Issue | Fix |
|----------|-----------|-------|-----|
| | | | |

Check for:
- N+1 queries (loop with DB call inside)
- Unnecessary allocations in hot paths
- Missing pagination for large result sets
- Synchronous I/O blocking the event loop
- Redundant computation that could be cached
- O(n^2) or worse algorithms on user-controlled input size

### Best Practices

| Severity | File:Line | Issue | Fix |
|----------|-----------|-------|-----|
| | | | |

Check for:
- Inconsistent naming (mixedCase vs snake_case in same file)
- Dead code (unreachable branches, unused variables/imports)
- DRY violations (copy-pasted logic that should be extracted)
- Missing test coverage for new logic
- Violated project conventions (check existing patterns)

### Maintainability

| Severity | File:Line | Issue | Fix |
|----------|-----------|-------|-----|
| | | | |

Check for:
- Functions longer than ~50 lines
- Deeply nested conditionals (>3 levels)
- Unclear variable/function names
- Missing comments on non-obvious logic
- Tight coupling between unrelated modules

## Verdict

**Recommendation:** APPROVE | REQUEST CHANGES | COMMENT

**Summary:** [2-3 sentences on overall quality and what needs attention]

**Blocking issues:** [count] critical, [count] high
**Non-blocking issues:** [count] medium, [count] low
