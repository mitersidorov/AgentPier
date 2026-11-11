---
name: verify-docker-runtime
description: Boot and verify the Znak backend against its project-specific Docker test stack. Use for runtime-relevant changes involving NestJS module wiring, migrations, PostgreSQL, Redis, S3 uploads, startup configuration, or when explicitly asked to run the service locally. Do not use for documentation-only or static instruction changes.
---

# Verify the Docker Runtime

Recheck `docker-compose.test.yml` and `.env.example` before relying on these assumptions.

## Stack

- Use PostgreSQL and Redis.
- Keep MinIO because the `upload` domain uses `S3StorageService`.
- The app is published on host port `3000`; verify current port mappings before starting.
- Use the local values in `docker-compose.test.yml` and `.env.example` for JWT, API key, admin, OTP, S3, and frontend invalidation settings.
- Use `DB_NAME=znak`.
- Never expose or modify the real `.env`.

The bind-mounted repository may allow `dotenv` to fill variables omitted by Compose from the developer's `.env`. Treat the effective environment carefully.

## Run

1. Start with `docker compose -f docker-compose.test.yml up -d --wait`.
2. Ensure the app command builds, runs migrations, and starts production output.
3. Poll `http://localhost:3300/health`.
4. Run e2e tests only when their configuration exists.
5. On failure, inspect `docker compose -f docker-compose.test.yml logs`.
6. Always tear down with `docker compose -f docker-compose.test.yml down -v`.

Do not repair application logic while performing an independent runtime check unless the task explicitly includes the fix. Report reproducible application failures with relevant logs.
