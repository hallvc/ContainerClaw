---
name: systematic-debugging
description: "Structured debugging methodology for investigating and fixing bugs. Use when encountering errors, test failures, unexpected behavior, or any issue that needs diagnosis. Enforces root cause investigation before attempting fixes."
---

# Systematic Debugging

Do not guess at fixes. Investigate first, fix second.

## The Rule

**No fixes without root cause investigation first.** Proposing a fix without completing Phase 1 violates this process. Even under time pressure, skipping investigation leads to more wasted time, not less.

## Phase 1: Root Cause Investigation

1. **Read the error carefully** -- the full message, stack trace, and context. Do not skim.
2. **Reproduce consistently** -- run the failing command and confirm you see the same error.
3. **Check recent changes** -- what changed since this last worked? (`git diff`, `git log`)
4. **Gather evidence in multi-component systems** -- trace the data flow from input to error. Check logs, network responses, and intermediate state.
5. **Identify the actual root cause** -- not the symptom. "The test fails" is a symptom. "The config loader returns null because the env var is unset" is a root cause.

### Red flags you're skipping investigation

- "Let me try changing X" without knowing why X would help
- "Maybe it's a timing issue" without evidence of timing problems
- "This should fix it" without explaining the root cause
- Changing multiple things at once

## Phase 2: Pattern Analysis

1. **Find a working example** -- is there a similar feature/test/flow that works correctly?
2. **Compare against the reference** -- what differs between the working and broken versions?
3. **Understand dependencies** -- trace imports, config, environment, and external services
4. **Check for known patterns** -- does this match a common bug class?

Common bug classes:
- **State pollution**: shared mutable state across tests or requests
- **Race condition**: timing-dependent behavior with async operations
- **Environment mismatch**: works locally, fails in CI (missing env vars, different OS)
- **Silent failure**: error caught and swallowed, causing downstream confusion
- **Stale cache**: old compiled/cached version masks the fix

## Phase 3: Hypothesis and Testing

1. **Form a single hypothesis** -- "The bug is caused by X because [evidence]"
2. **Design a minimal test** -- what is the smallest change that would confirm or refute this hypothesis?
3. **Change one variable at a time** -- never change multiple things simultaneously
4. **Verify before continuing** -- run the test, read the output, confirm the hypothesis

If the hypothesis is wrong, go back to Phase 1 with the new information. Do not chain guesses.

## Phase 4: Implementation

1. **Write a failing test** that demonstrates the bug (if possible)
2. **Implement a single, focused fix** -- address only the root cause
3. **Verify the fix** -- run the test, confirm it passes
4. **Check for regressions** -- run the broader test suite
5. **Stop after 3 failed fix attempts** -- if three fixes haven't worked, the problem is likely architectural. Step back and question your understanding.

## Tools

Use ContainerClaw's tools effectively during debugging:

- `exec` -- run commands, check logs, reproduce errors
- `read_file` -- examine source code, config files, logs
- `web_fetch` -- look up error messages, library documentation
- `spawn` -- delegate investigation of independent sub-problems to background agents

## Anti-patterns

| Temptation | Why it fails | Instead |
|-----------|-------------|---------|
| "Quick fix, then investigate later" | Quick fixes mask root causes | Investigate first, always |
| "Add a try/catch around it" | Swallows the symptom, not the bug | Find why the exception occurs |
| "Increase the timeout" | Hides a performance or race condition | Find what's slow or racing |
| "It works on my machine" | Environment differences are the bug | Compare environments systematically |
| "Delete and recreate" | Destroys evidence of the root cause | Understand before destroying |

## Root Cause Tracing

For complex bugs, see [references/root-cause-tracing.md](references/root-cause-tracing.md) for techniques on tracing bugs backward through call chains.

## Condition-Based Waiting

When debugging timing issues, see [references/condition-based-waiting.md](references/condition-based-waiting.md) for replacing arbitrary sleeps with condition polling.
