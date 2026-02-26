# Root Cause Tracing

Technique for tracing bugs backward through call chains to find the original trigger.

## The Method

Start at the error and work backward:

1. **Error site**: Where does the error manifest? (crash, wrong output, test failure)
2. **Immediate cause**: What value/state/condition triggered the error at this site?
3. **One level up**: Where did that value/state come from? Who set it?
4. **Repeat**: Keep tracing backward until you reach the original incorrect action

## Example

```
Error: "Cannot read property 'name' of undefined" at UserProfile.tsx:42
↑ user object is undefined
↑ useUser() hook returned undefined
↑ API call to /api/user returned 401
↑ Auth token expired but wasn't refreshed
↑ Token refresh logic has an off-by-one in expiry check
ROOT CAUSE: Token is considered "valid" when it has exactly 0 seconds remaining
```

## Instrumentation

When the call chain is unclear, add temporary logging:

```python
# Add at suspected points in the chain
import traceback
print(f"DEBUG [{__file__}:{line}] value={value}")
traceback.print_stack()  # Shows full call chain
```

For async flows, log with correlation IDs:

```python
import uuid
req_id = uuid.uuid4().hex[:8]
print(f"[{req_id}] Step 1: received input={input}")
print(f"[{req_id}] Step 2: transformed to={output}")
```

**Always remove debug logging after finding the root cause.**

## Multi-Component Tracing

When the bug spans multiple services or processes:

1. Start at the error in the failing component
2. Identify the input that caused the failure
3. Trace that input to the sending component
4. Check: was the input correct when sent? Or was it corrupted in transit?
5. Continue backward through each component boundary

Key boundaries to check:
- HTTP request/response (check actual payloads, not just status codes)
- Database reads (query the DB directly to see actual stored data)
- Message queues (check message contents, not just delivery status)
- File I/O (read the file directly, check permissions and encoding)

## Test Pollution Detection

When tests pass individually but fail together, one test is polluting shared state.

### Binary search approach

1. Run the failing test with the full suite -> fails
2. Run the failing test alone -> passes (confirms pollution)
3. Split the preceding tests in half, run first half + failing test
4. If it fails, the polluter is in the first half. If not, second half.
5. Repeat until you find the single polluting test.

### What to look for

- Global variables modified and not restored
- Database records created and not cleaned up
- Environment variables set and not unset
- Files created in shared directories
- Mocked modules not properly restored
- Singleton state that persists across tests
