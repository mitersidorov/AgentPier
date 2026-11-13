---
name: integration-pattern
description: Add an external HTTP integration to a NestJS application using its existing transport and clear business/transport boundaries.
---

# NestJS HTTP integration

Before adding an integration, inspect the repository for an existing HTTP client, shared transport, timeout/retry behavior, error mapping, and module conventions. Reuse those conventions; do not assume a particular `HttpService` implementation or source path.

## Boundaries

- Keep request construction and transport response mapping in a focused integration service.
- Keep business decisions in the calling domain service or use case.
- Use typed request and response shapes where useful; validate and normalize data at the boundary.
- Do not log authorization headers, tokens, credentials, or sensitive request/response bodies.

## Reliability

- Use the repository's timeout and retry mechanisms. Add retries only for operations that are safe to retry and only if an existing shared layer does not already retry.
- Map external errors into stable application errors at the integration boundary. Avoid leaking raw provider responses to callers.
- Make rate limits, pagination, idempotency, and partial failures explicit when the provider uses them.
- Keep provider credentials in environment/secret configuration. Update the repository's example configuration and docs without adding real values.

## Review before completion

- Confirm module providers/imports expose only the required integration surface.
- Test success mapping and representative timeout, provider-error, and retry/idempotency cases.
- Run the target repository's documented checks and report what was actually verified.
