---
name: verify-docker-runtime
description: Boot and verify a Dockerized NestJS application with MySQL and S3-compatible backup storage. Use for runtime changes involving migrations, MySQL persistence, MinIO/S3, startup configuration, or when asked to run the service locally.
---

# Verify Docker runtime

Use the repository's Compose stack and verify behavior against its actual services.

1. Inspect `docker compose ps` and confirm service health before changing containers.
2. Rebuild and start the Compose application; inspect logs and health endpoints.
3. Confirm TypeORM migrations are applied and `synchronize` remains disabled.
4. For AgentPier, verify the app-server with HTTP readiness checks and an actual WebSocket RPC from inside the Manager container.
5. A database-backup test must create a real MySQL dump, upload it, download it, restore it into an isolated database and compare restored data. A standalone S3 object check is not sufficient.
6. Report missing external credentials and which features were verified using local MinIO.
7. Preserve Docker volumes unless the user explicitly asks to remove them.
