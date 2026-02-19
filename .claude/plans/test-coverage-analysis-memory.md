# Test Coverage Analysis: Memory System

## Executive Summary

**Current Coverage**: 33 tests in memory_test.ts covering ~60% of critical paths
**Test Quality**: NEEDS ATTENTION - Missing edge cases, helper function tests, and the learn tool
**Risk Level**: MEDIUM - Core functionality tested, but important gaps exist

---

## CRITICAL GAPS (High Risk)

### 1. LearnTool NOT TESTED
**File**: `src/agent/tools/learn.ts`
**Status**: ❌ NO TESTS FOUND
**Risk**: HIGH - This is the primary interface users interact with

**Missing test cases**:
- ✗ Valid learning with all required fields (topic, content 100+ chars, source)
- ✗ Validation: topic missing/empty
- ✗ Validation: content under 100 characters (boundary test)
- ✗ Validation: content exactly 100 characters (boundary test)
- ✗ Validation: content with 99 characters (should fail)
- ✗ Default source value when omitted
- ✗ Integration: learn tool saves and memory can recall it
- ✗ Special characters in topic (should slugify correctly)
- ✗ Error message format verification

---

## Helper Functions UNTESTED (Medium Risk)

### 2. slugify() - Lines 67-73
**Risk**: MEDIUM - Used for file naming; bugs cause file system issues

**Missing test cases**:
- ✗ Normal text: "Deploy Workflow" → "deploy-workflow"
- ✗ Special characters: "OAuth2/PKCE Setup!" → "oauth2-pkce-setup"
- ✗ Leading/trailing dashes: "---test---" → "test"
- ✗ Unicode characters: "Café Notes 🎉" → "caf-notes"
- ✗ Very long strings (>60 chars): truncation behavior
- ✗ Exactly 60 chars: no truncation
- ✗ Empty string: ""
- ✗ Only special chars: "!!!@@@" → ""
- ✗ Multiple consecutive spaces/dashes: "a---b   c" → "a-b-c"

### 3. contentHash() - Lines 76-83
**Risk**: MEDIUM - Deduplication depends on this; collisions = data loss

**Missing test cases**:
- ✗ Same content produces same hash
- ✗ Different content produces different hash
- ✗ Hash is 16 characters long
- ✗ Hash is hex format (0-9a-f)
- ✗ Empty string produces valid hash
- ✗ Very long content (10KB+) produces valid hash
- ✗ Unicode content: "Hello 世界" produces valid hash

### 4. extractTags() - Lines 86-113
**Risk**: MEDIUM - Affects recall quality; wrong tags = missed memories

**Missing test cases**:
- ✗ Returns top 10 most frequent non-stopwords
- ✗ Filters stopwords correctly ("the", "is", "and", etc.)
- ✗ Case insensitive: "Docker docker DOCKER" counts as 1 word
- ✗ Min length 3: "a ab abc" only includes "abc"
- ✗ Returns empty array for empty string
- ✗ Returns empty array for only stopwords: "the a an is"
- ✗ Frequency sorting: most common words first
- ✗ Exactly 10 tags returned when 15+ unique words
- ✗ Less than 10 tags when fewer unique words
- ✗ Special characters removed: "node.js, express!" → ["node", "express"]

### 5. scoreMatch() - Lines 116-137
**Risk**: HIGH - Core retrieval quality depends on scoring accuracy

**Missing test cases**:
- ✗ Exact tag match scores 3 points
- ✗ Content substring match scores 1 point
- ✗ Both tag and content match: cumulative scoring
- ✗ No match returns 0
- ✗ Multiple query terms: aggregate scoring
- ✗ Normalization by query length works correctly
- ✗ Case insensitive matching
- ✗ Empty query returns 0
- ✗ Empty content returns 0
- ✗ Partial word matches vs exact word matches

### 6. recencyBoost() - Lines 140-147
**Risk**: HIGH - Wrong decay = wrong recall prioritization

**Missing test cases**:
- ✗ Today (daysDiff = 0) returns 1.0
- ✗ Tomorrow (future date) returns 1.0 (clamped)
- ✗ 15 days ago returns ~0.65 (mid-decay)
- ✗ 30 days ago returns 0.3 (floor)
- ✗ 31+ days ago returns 0.3 (clamped)
- ✗ Linear decay over 30 days
- ✗ Invalid date string handling
- ✗ Boundary: exactly 30 days

### 7. todayStr() - Line 60
**Risk**: LOW - Simple but critical for file naming

**Missing test cases**:
- ✗ Returns YYYY-MM-DD format
- ✗ Returns current date (hard to test, but can mock)

### 8. timeStr() - Line 64
**Risk**: LOW - Used for timestamps

**Missing test cases**:
- ✗ Returns HH:MM format
- ✗ Returns current time (hard to test, but can mock)

---

## Edge Cases in Tested Functions (Medium Risk)

### 9. appendDailyRaw() - Lines 273-282
**Status**: ❌ UNTESTED
**Risk**: MEDIUM - Alternative interface for daily notes

**Missing test cases**:
- ✗ Multi-line text splits into bullets correctly
- ✗ First line becomes title (truncated to 80 chars)
- ✗ Title longer than 80 chars is truncated
- ✗ Empty lines are filtered out
- ✗ Source parameter is preserved

### 10. readToday() - Lines 294-296
**Status**: ❌ UNTESTED
**Risk**: LOW - Thin wrapper but should be tested

**Missing test cases**:
- ✗ Returns today's note when it exists
- ✗ Returns empty string when today has no note

### 11. saveTask() - Lines 431-435
**Status**: ❌ UNTESTED
**Risk**: MEDIUM - Task persistence not verified

**Missing test cases**:
- ✗ Creates task file with slugified ID
- ✗ Content is written correctly
- ✗ Directory is created if missing
- ✗ Special characters in ID are slugified

### 12. parseLearningFile() - Lines 378-408
**Status**: ❌ UNTESTED (private, but affects readLearnings)
**Risk**: MEDIUM - Parsing errors = lost data

**Missing test cases**:
- ✗ Parses complete learning file correctly
- ✗ Missing **Learned** field: uses filename or default
- ✗ Missing **Source** field: uses "unknown"
- ✗ Malformed markdown: graceful degradation
- ✗ Empty file returns null or minimal learning
- ✗ Extra whitespace handling
- ✗ Topic from filename when # header missing

---

## Integration & Workflow Tests (High Risk)

### 13. Index Staleness Detection
**Status**: ⚠️ PARTIAL - Only basic cases tested

**Missing test cases**:
- ✗ isIndexStale returns true when daily note modified after index
- ✗ isIndexStale returns true when learning modified after index
- ✗ isIndexStale returns true when MEMORY.md modified after index
- ✗ Multiple directories checked correctly
- ✗ Race condition: file modified during index check

### 14. Index Cache Invalidation
**Status**: ⚠️ PARTIAL - Invalidation mentioned but not thoroughly tested

**Missing test cases**:
- ✗ saveLearning() invalidates cache (indexCache = null)
- ✗ trackEntity() invalidates cache
- ✗ archiveOldNotes() invalidates cache when archived > 0
- ✗ loadIndex() rebuilds when cache invalid
- ✗ Cache persists across multiple reads

### 15. Recall Without Explicit Rebuild
**Status**: ❌ UNTESTED - Critical integration path

**Missing test cases**:
- ✗ appendDailyNote → recall (without manual rebuildIndex) finds entry
- ✗ saveLearning → recall (auto-rebuild) finds learning
- ✗ Stale index triggers auto-rebuild on recall
- ✗ loadIndex() auto-rebuilds when index missing

### 16. getRelevantContext Full Integration
**Status**: ⚠️ PARTIAL - Basic cases tested

**Missing test cases**:
- ✗ All sections present: memory + learnings + recalled + today
- ✗ Today's note truncated when >500 chars
- ✗ Exactly 500 chars: no truncation
- ✗ 501 chars: truncation with "..." prefix
- ✗ Recall returns max 5 results (boundary test)
- ✗ Empty query still loads memory + learnings + today

---

## Archive Logic Edge Cases (Medium Risk)

### 17. archiveOldNotes Boundary Conditions
**Status**: ⚠️ PARTIAL - Happy path tested

**Missing test cases**:
- ✗ Exactly at cutoff date (olderThanDays boundary): archived or kept?
- ✗ Multiple notes from same month: all appended to same archive
- ✗ Archive file already exists: appends not overwrites
- ✗ Archive directory doesn't exist: creates it
- ✗ No old notes: returns 0
- ✗ Mix of old and recent notes across months
- ✗ Index invalidation only when archived > 0 (already tested)

---

## Concurrency & Race Conditions (Low-Medium Risk)

### 18. Concurrent Writes
**Status**: ❌ UNTESTED
**Risk**: MEDIUM - Multi-user or multi-channel scenarios

**Missing test cases**:
- ✗ Two appendDailyNote() calls simultaneously
- ✗ appendDailyNote() while archiveOldNotes() running
- ✗ saveLearning() while rebuildIndex() running
- ✗ Multiple trackEntity() calls simultaneously
- ✗ File locking behavior (if any)

---

## Error Handling & Resilience (Medium Risk)

### 19. File System Errors
**Status**: ⚠️ PARTIAL - Try-catch exists but not tested

**Missing test cases**:
- ✗ Read-only file system: graceful degradation
- ✗ Disk full during write: error handling
- ✗ Permission denied: clear error message
- ✗ Corrupted index file: rebuilds instead of crashing
- ✗ Corrupted learning file: skips or returns partial data
- ✗ Invalid date format in daily note filename: skipped

### 20. Data Validation
**Status**: ❌ UNTESTED

**Missing test cases**:
- ✗ appendDailyNote with empty bullets array
- ✗ appendDailyNote with very long title (1000+ chars)
- ✗ saveLearning with empty content
- ✗ trackEntity with empty name
- ✗ recall with very long query (1000+ chars)

---

## Test Quality Issues

### 21. Shallow Assertions
**Current**: Many tests use `assertStringIncludes` for content verification
**Issue**: Doesn't verify structure, order, or completeness

**Examples**:
- Test #10 (appendDailyNote appends): Should verify both entries present AND in correct order
- Test #22 (rebuildIndex learnings): Should verify learning content, not just topic
- Test #28 (getRelevantContext): Should verify section order and formatting

### 22. No Negative Tests
**Missing**:
- What happens when recall finds 0 results? (Test #26 covers this - GOOD)
- What happens when operations fail? (Mostly missing)
- What happens with malformed input? (Missing)

### 23. Time-Dependent Tests
**Risk**: LOW but present

**Issue**: Tests #16, 25, 27, 30 use `new Date()` which makes them non-deterministic
**Fix**: Should use fixed dates like "2026-02-19" for consistency

---

## Recommended Test Additions (Prioritized)

### PRIORITY 1 (CRITICAL - Do First)
1. **LearnTool complete test suite** (9 tests)
   - Valid learning, validation errors, integration with memory
2. **Helper function tests** (40 tests)
   - slugify, contentHash, extractTags, scoreMatch, recencyBoost
3. **Recall integration** (5 tests)
   - Auto-rebuild, cache invalidation, without explicit rebuild

### PRIORITY 2 (HIGH - Do Second)
4. **Untested methods** (12 tests)
   - appendDailyRaw, readToday, saveTask, parseLearningFile edge cases
5. **Index staleness detection** (5 tests)
   - File modification detection, multiple directories
6. **Archive edge cases** (6 tests)
   - Boundary dates, multiple months, existing archives

### PRIORITY 3 (MEDIUM - Do Third)
7. **Error handling** (10 tests)
   - File system errors, corrupted data, invalid input
8. **Data validation** (5 tests)
   - Empty/oversized inputs
9. **Test quality improvements** (5 tests)
   - Replace time-dependent tests, strengthen assertions

### PRIORITY 4 (LOW - Nice to Have)
10. **Concurrency tests** (5 tests)
    - Concurrent writes, race conditions
11. **Performance tests** (3 tests)
    - Large datasets, indexing speed

---

## Summary Statistics

- **Total existing tests**: 33
- **Recommended additions**: 105 tests
- **Total after additions**: 138 tests
- **Estimated coverage increase**: 60% → 90%+

---

## Test File Organization Recommendation

Consider splitting memory_test.ts into:
1. `memory_test.ts` - Core MemoryStore class (keep existing)
2. `memory_helpers_test.ts` - Helper functions (NEW)
3. `learn_tool_test.ts` - LearnTool class (NEW)
4. `memory_integration_test.ts` - Integration scenarios (NEW)

This improves maintainability and test execution speed.

---

## Specific Test Cases to Write First

### Learn Tool Test (Create: src/agent/tools/learn_test.ts)

```typescript
Deno.test("LearnTool - valid learning with all fields", async () => {
  // topic, content 100+ chars, source
  const result = await tool.execute({
    topic: "Docker Builds",
    content: "Always use multi-stage builds for production. This reduces image size significantly and improves security by excluding build tools from the final image.",
    source: "correction"
  });
  assertStringIncludes(result, "Learned \"Docker Builds\"");
  // Verify file was created
});

Deno.test("LearnTool - rejects content under 100 chars", async () => {
  const result = await tool.execute({
    topic: "Test",
    content: "Too short",
    source: "test"
  });
  assertStringIncludes(result, "Error: content must be at least 100 characters");
  assertStringIncludes(result, "got 9");
});

Deno.test("LearnTool - boundary: exactly 100 chars accepted", async () => {
  const content = "a".repeat(100);
  const result = await tool.execute({
    topic: "Test",
    content,
    source: "test"
  });
  assertEquals(result.startsWith("Error"), false);
});

Deno.test("LearnTool - boundary: 99 chars rejected", async () => {
  const content = "a".repeat(99);
  const result = await tool.execute({
    topic: "Test",
    content,
    source: "test"
  });
  assertStringIncludes(result, "Error");
  assertStringIncludes(result, "got 99");
});
```

### Helper Function Tests (Create: src/agent/memory_helpers_test.ts)

Extract helper functions to a separate module for testability, or use reflection/testing utilities.

---

## Questions for Consideration

1. **Test Organization**: Should we split tests into multiple files as recommended, or keep everything in memory_test.ts?

2. **LearnTool Priority**: The learn tool has ZERO tests. Is this the highest priority to address?

3. **Helper Function Testing**: Helper functions are private. Should we:
   - Extract them to a separate module for testing?
   - Test them indirectly through public methods?
   - Use Deno's testing utilities to access private functions?

4. **Concurrency Testing**: How important is multi-user/multi-channel concurrency? Should we invest in these tests?

5. **Coverage Target**: What's the target coverage percentage? 90%+ requires all recommended tests. 80% can skip some lower-priority items.

6. **Time-Dependent Tests**: Should we refactor existing tests to use fixed dates for determinism?

---

## Implementation Plan

When ready to proceed:

1. **Phase 1**: Create learn_tool_test.ts with 9 critical tests
2. **Phase 2**: Add 40 helper function tests (new file or inline)
3. **Phase 3**: Add 12 missing method tests to memory_test.ts
4. **Phase 4**: Add 16 integration/edge case tests
5. **Phase 5**: Add 10 error handling tests
6. **Phase 6**: Improve test quality (strengthen assertions, remove time dependencies)

Each phase can be done incrementally with verification after each addition.
