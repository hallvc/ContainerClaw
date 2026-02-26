# MCP Server Best Practices

## Tool Design

### Naming

- Use `verb_noun` format: `get_user`, `create_issue`, `search_docs`
- Be specific: `list_open_issues` > `list_issues` (if that's what it does)
- Avoid generic names: `do_thing`, `process`, `handle`

### Descriptions

Write descriptions for the agent, not the developer:

```
GOOD: "Search for GitHub issues by keyword, label, or assignee. Returns issue number, title, state, and URL. Use this when the user asks about bugs, features, or tasks."

BAD: "Searches issues."
```

Include:
- What the tool does
- What it returns
- When to use it (and when NOT to)
- Example inputs if the format isn't obvious

### Input Schemas

- Make required fields actually required
- Use descriptive field names (`user_id` not `id`)
- Add `.describe()` to every field
- Set sensible defaults for optional fields
- Validate early and return clear errors

```typescript
{
  query: z.string().describe("Search keywords to match against issue title and body"),
  state: z.enum(["open", "closed", "all"]).default("open").describe("Filter by issue state"),
  limit: z.number().min(1).max(100).default(20).describe("Maximum results to return"),
}
```

### Output Format

- Return structured data (JSON), not plain text prose
- Include the most useful fields first
- Truncate large responses with a count of omitted items
- For errors, return actionable messages with context

```typescript
return {
  content: [{
    type: "text",
    text: JSON.stringify({
      results: items.slice(0, limit),
      total: items.length,
      truncated: items.length > limit,
    }, null, 2)
  }]
};
```

## Error Handling

### Actionable error messages

```
GOOD: "User 'jdoe' not found. Available users: alice, bob, charlie"
GOOD: "Rate limited (429). Retry after 30 seconds."
GOOD: "Missing required field 'repo'. Expected format: 'owner/repo'"

BAD: "Error occurred"
BAD: "404"
BAD: "Invalid input"
```

### Error categories

- **Input validation**: return immediately with what's wrong and how to fix it
- **Authentication**: clear message about which credential is missing/expired
- **Not found**: include what was searched and suggest alternatives
- **Rate limiting**: include retry-after information
- **Server errors**: include enough context to diagnose without exposing internals

## Tool Annotations

```typescript
server.tool(
  "get_user",
  "Look up user details",
  { user_id: z.string() },
  async ({ user_id }) => { /* ... */ },
  {
    annotations: {
      readOnlyHint: true,    // Does not modify state
      idempotentHint: true,  // Safe to retry
      openWorldHint: false,  // Only accesses known resources
    }
  }
);
```

## Authentication

- Accept credentials via environment variables, not tool parameters
- Support both API key and OAuth token patterns
- Check auth on server startup and fail fast with a clear message
- Never log or return credentials in error messages

## Performance

- Set reasonable timeouts on external API calls (10-30 seconds)
- Paginate large result sets rather than returning everything
- Cache read-only data when appropriate (with TTL)
- Return partial results on timeout rather than failing completely
