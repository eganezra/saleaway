# Error Handling Strategy

## Error Flow

```mermaid
sequenceDiagram
    participant C as Consumer
    participant R as Retailer
    participant D as D1
    participant F as Finalize
    participant A as Alert webhook
    C->>R: GET sale page
    R-->>C: timeout, 403 or 5xx
    C->>C: classify (blocked or error), no throw
    C->>D: run_result recorded, last good sale_record kept
    F->>D: count failures for the run
    alt failure rate above 20 percent or run incomplete
        F->>A: POST short summary
    end
```

## Error Response Format

```typescript
interface ApiError {
  error: { code: string; message: string; requestId: string; timestamp: string };
}
```

Used by `/api/click` and `/admin/run` only. Page routes return HTML.

## Frontend Error Handling

If D1 is unavailable and a cached copy exists, serve the cached page. If there is no cached copy, render the friendly "Sales are loading, check back soon" card with status 503 (Story 1.4, AC5).

```typescript
try {
  vm = await loadHomeViewModel(db);
} catch (err) {
  log.error('home_failed', { err });
  return renderEmptyState(503);
}
```

## Backend Error Handling

```typescript
export function classifyFetch(res: Response | null, err: unknown): FetchClass {
  if (err) return 'error';
  if (!res) return 'error';
  if (res.status === 403 || res.status === 429 || res.status === 503) return 'blocked';
  if (res.status === 404 || res.status === 410) return 'not_found';
  if (res.status >= 500) return 'error';
  return 'ok';   // further checks (redirected away, js_only) happen after reading the body
}
```
