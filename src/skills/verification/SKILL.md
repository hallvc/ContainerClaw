---
name: verification
description: "Verify work is complete with fresh evidence before claiming success. Use before any completion claim -- tests, builds, bug fixes, feature implementations, or task handoffs. Prevents false 'done' claims."
---

# Verification Before Completion

Never claim work is complete without fresh evidence proving it.

## The Gate Function

Before making ANY completion claim, follow this sequence:

1. **IDENTIFY** -- What command or check proves this claim?
2. **RUN** -- Execute the verification command fresh (not from memory or cache)
3. **READ** -- Read the full output, not just the exit code
4. **VERIFY** -- Confirm the output actually proves the claim
5. **CLAIM** -- Only now state the work is complete, citing the evidence

## Verification by Task Type

### Tests

```
IDENTIFY: "npm test" or "pytest" proves all tests pass
RUN:      exec("npm test")
READ:     Output shows "42 passed, 0 failed"
VERIFY:   Zero failures, no skipped tests that should run
CLAIM:    "All 42 tests pass (verified: npm test output attached)"
```

### Builds

```
IDENTIFY: "npm run build" proves the build succeeds
RUN:      exec("npm run build")
READ:     Output shows "Build completed successfully"
VERIFY:   Exit code 0, no warnings that indicate real problems
CLAIM:    "Build succeeds with zero errors"
```

### Bug fixes

```
IDENTIFY: Reproduce the original bug, confirm it's fixed
RUN:      Execute the reproduction steps
READ:     Output shows correct behavior
VERIFY:   The fix addresses the root cause, not just the symptom
CLAIM:    "Bug fixed -- reproduction steps now produce correct output"
```

### Regression test protocol

For bug fixes, verify the test actually catches the bug:

1. Write the test -> run it -> it **passes** (with the fix)
2. Revert the fix -> run the test -> it **must fail**
3. Restore the fix -> run the test -> it **passes** again

If the test passes even without the fix, the test is not testing the right thing.

### Requirements checklist

1. Re-read the original requirements
2. Create a checklist of each requirement
3. Verify each item with evidence (command output, file contents, behavior)
4. Report any gaps honestly

### Subagent delegation

When work is done by a spawned subagent:

- Do not trust the subagent's success claim at face value
- Independently verify by checking the actual output (read files, run tests)
- If the subagent says "tests pass," run the tests yourself

## Forbidden Language

These phrases indicate a claim without evidence:

| Forbidden | Why | Instead |
|-----------|-----|---------|
| "should work" | No evidence it actually works | Run it and verify |
| "probably fixed" | Uncertainty = not verified | Reproduce and confirm |
| "looks correct" | Visual inspection is not verification | Execute and check output |
| "I believe this is done" | Belief is not evidence | Show the evidence |
| "seems to be working" | Vague assessment | Specific passing output |

These phrases before verification indicate premature satisfaction:

- "Great!" / "Perfect!" / "Excellent!" / "Done!"
- Use these only AFTER verification evidence confirms success.

## When Verification Fails

If verification reveals problems:

1. Do not claim partial success ("mostly works")
2. State what specifically failed
3. Return to fixing the issue
4. Re-verify after the fix

Verification is a loop, not a single pass.
