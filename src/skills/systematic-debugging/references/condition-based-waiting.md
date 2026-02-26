# Condition-Based Waiting

Replace arbitrary `sleep()` calls with condition polling. Arbitrary timeouts are a common source of flaky tests and unreliable behavior.

## The Problem

```python
# BAD: arbitrary sleep
subprocess.Popen(["server", "start"])
time.sleep(5)  # "should be enough"
requests.get("http://localhost:8080")
```

This fails when:
- The server starts in 1 second (wastes 4 seconds)
- The server takes 6 seconds (test fails intermittently)
- CI is slower than local (flaky in CI)

## The Solution

```python
# GOOD: condition-based waiting
import time

def wait_for(condition, timeout=30, interval=0.5, message="Condition not met"):
    """Poll a condition until it returns True or timeout is reached."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if condition():
                return True
        except Exception:
            pass
        time.sleep(interval)
    raise TimeoutError(f"{message} (waited {timeout}s)")
```

## Common Patterns

### Wait for HTTP server

```python
import urllib.request

def server_is_ready(url="http://localhost:8080/health"):
    try:
        urllib.request.urlopen(url, timeout=2)
        return True
    except Exception:
        return False

subprocess.Popen(["server", "start"])
wait_for(server_is_ready, timeout=30, message="Server did not start")
```

### Wait for file to appear

```python
import os

wait_for(
    lambda: os.path.exists("/tmp/output.json"),
    timeout=10,
    message="Output file was not created"
)
```

### Wait for process to exit

```python
def process_finished(proc):
    return proc.poll() is not None

wait_for(
    lambda: process_finished(proc),
    timeout=60,
    message="Process did not exit"
)
```

### Wait for log line

```python
def log_contains(path, pattern):
    if not os.path.exists(path):
        return False
    with open(path) as f:
        return any(pattern in line for line in f)

wait_for(
    lambda: log_contains("/var/log/app.log", "Server started"),
    timeout=30,
    message="Server start log line not found"
)
```

### Wait for database record

```python
def record_exists(db, query):
    result = db.execute(query).fetchone()
    return result is not None

wait_for(
    lambda: record_exists(db, "SELECT 1 FROM jobs WHERE status='complete'"),
    timeout=60,
    message="Job did not complete"
)
```

## Guidelines

- **Always set a timeout** -- never poll forever
- **Use descriptive error messages** -- include what you were waiting for
- **Choose appropriate intervals** -- 0.1s for fast checks, 1-2s for network/DB
- **Catch exceptions in the condition** -- transient errors during startup are expected
- **Log on timeout** -- include the last state/error to aid debugging
