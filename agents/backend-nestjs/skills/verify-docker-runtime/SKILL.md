---
name: verify-docker-runtime
description: Boot and verify a Dockerized NestJS application using the target repository's own stack and checks.
---

# Verify a Dockerized NestJS runtime

Use this when a runtime change depends on container wiring, migrations, persistence, or external services. Inspect the target repository's Compose files, environment example, scripts, and health checks before running anything. Never assume a database engine, service name, or host port.

1. Confirm the intended Compose file, services, published ports, persistent volumes, and current container state.
2. Preserve existing volumes and user data. Do not use destructive teardown options such as `down -v` unless the user explicitly requests removal.
3. Start/rebuild only the required services and wait for the repository's health/readiness checks.
4. Inspect startup logs and verify the actual application behavior, database connectivity, and migration state.
5. Exercise the changed runtime path against real local services where available. Use isolated test data and a safe local substitute for unavailable external services.
6. Run the relevant project tests and report exact commands, results, missing credentials, and any integration not exercised.

Do not treat a successful image build or HTTP health endpoint as proof that a dependent protocol, job, or persistence path works.
