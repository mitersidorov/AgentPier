---
name: minimal-test-strategy
description: Design focused Jest tests for NestJS behavior without duplicating framework or infrastructure guarantees.
---

# Focused NestJS test strategy

Inspect the target project's test runner, nearby specs, and dependency boundaries before writing tests. Prefer a small set of readable tests for observable behavior.

- Test domain outcomes, important branches, and meaningful failure handling through public methods or routes.
- Mock only external boundaries needed to isolate the behavior. Reuse project test factories and fixtures.
- Do not assert framework guarantees such as basic dependency injection, decorator metadata, or ValidationPipe behavior.
- Use repository/database integration tests when query semantics or persistence are part of the change; avoid pretending mocked repositories verify them.
- For API changes, cover representative valid input, invalid input, and response/error contract where appropriate.
- Do not create repetitive CRUD cases for methods or behaviors that do not exist.
- Run the focused test and report its exact command and result. Add broader lint/build/runtime checks only when they add evidence for the change.

For instruction-only tasks, no Jest test is required: review instruction/skill consistency and applicability, scan changed instructions for English-only content, and run `git diff --check`. Do not treat passing mocks as evidence of live GitHub, MCP, WebSocket, or release operations; report those checks as unexercised unless actually observed.
