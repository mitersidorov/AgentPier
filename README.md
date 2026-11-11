# AgentPier MVP

AgentPier is a local project manager and MCP endpoint for a human-led Codex workflow. It stores project context, verbatim requests, analysis task records, user-approved plans and results in MySQL. The assistant discusses and approves plans with the user; AgentPier does not publish, push, create pull requests or merge project changes.

## Current support

The local MVP includes a NestJS API and browser dashboard, MySQL persistence and migrations, project/application/repository/instruction/memory/task records, two seeded universal profiles, local path validation, a Streamable HTTP MCP JSON-RPC endpoint, and a real WebSocket handshake check to the host app-server. It stores analysis requests and prevents plan approval without `explicitlyConfirmed: true`.

Agent session orchestration, Codex turn streaming/cancellation, Git branch creation and diff reporting, full S3 backup/restore lifecycle and restore drills are not yet implemented. An analysis record is not an agent analysis result. These limits are explicit so the UI/MCP does not claim work happened when it did not. The repository currently contains no separate Angular frontend application; the UI is a small local dashboard served by NestJS.

## Run locally

Requirements: Docker Desktop with Compose and a Mac host running Codex app-server when session checks are needed.

```sh
cp .env.example .env
# For the Compose defaults, set DB_PASSWORD=local-agentpier and S3_ACCESS_KEY=agentpierlocal,
# S3_SECRET_KEY=local-agentpier-secret in .env, or edit docker-compose.yml defaults.
docker compose up --build -d
docker compose ps
```

Open [http://localhost:3100](http://localhost:3100) (or the `MANAGER_PORT` configured in `.env`). MySQL data persists in the `mysql_data` volume; MinIO data persists in `minio_data`. Migrations run on Manager startup. Use `docker compose down` to stop while preserving data. `docker compose down -v` deletes local database and object data.

For standalone development, use Node 22+, a MySQL 8 database and `npm ci`, set `.env`, run `npm run migration:run`, then `npm run start:dev`.

## Register projects and repositories

Create a project with an absolute Mac path, then register `app` and `repository` records with its `projectId`, purpose, absolute path and `remoteUrl`. App/repository paths must remain under the registered project path. This is a local clone registry; remote cloning is not implemented. Multiple apps and repositories can be registered per project.

The API stores generic domain records at `/api/records/:kind` (kinds: `project`, `app`, `repository`, `instruction`, `skill`, `memory`, `task`). Read with `/api/records?kind=project&projectId=…`; update with `PUT /api/records/:id`. See `/docs` for the NestJS API explorer.

## Workflow and MCP

The dashboard and API can preserve a verbatim request as a task using `POST /api/projects/:id/analyze`. It creates an `analysis` record only; no agent has run yet. An approved plan is stored with `POST /api/tasks/:id/approve` and a body containing `{ "plan": { "explicitlyConfirmed": true, "steps": [] } }`. A missing explicit confirmation is rejected.

Configure local MCP clients to use Streamable HTTP at `http://localhost:3100/mcp` (or the configured `MANAGER_PORT`). The MCP methods `initialize`, `tools/list` and `tools/call` are served by AgentPier itself. Tools include Manager status, record listing/creation, request analysis record creation and plan approval. Manager status checks `/readyz`, `/healthz` and attempts a real WebSocket handshake to `ws://host.docker.internal:4500`.

Start app-server on the Mac separately and configure it to listen on port 4500 with HTTP readiness endpoints. In Docker, Manager sends the Mac absolute path as a string to app-server; it does not mount the project into the container. The host app-server must be configured to allow the intended local workspace paths. On macOS outside Docker, use a reachable host URL instead of `host.docker.internal`.

The seeded profiles are exactly **Backend developer** and **Frontend developer**. Shared, versioned instructions and skills live in `.agents/skills/`; frontend guidance is in `.codex/frontend-guidelines.md`. Project-specific instructions are stored as project-linked records. New sessions are not yet started, so this repository's guidance is not yet injected into a live session.

## Data domains

See [docs/domain-model.md](docs/domain-model.md) for record relationships, knowledge provenance, path handling, and boundaries. All persistent records use MySQL `manager_records`; `kind`, optional project link, display name and JSON `data` separate the domains while allowing records to evolve. MySQL is configured with `synchronize: false` and schema migration support.

## Backups

Compose includes a local MinIO S3-compatible service and bucket initialization so storage can be configured locally. Backup scheduling, S3 upload/list/download, restore into a test database and retention enforcement are **not implemented or verified yet**. No cloud credentials are included. Configure S3 credentials only in local `.env`; never commit that file. Do not treat the presence of MinIO as evidence a backup exists.

## Architecture diagrams

See [docs/architecture.md](docs/architecture.md) for C4 Context and Container diagrams, service responsibilities, local path semantics and app-server diagnostics.

## Configuration and diagnostics

Copy `.env.example` to `.env`. `GET /api/status` includes database/Manager and the WebSocket result, with a concrete reason when app-server cannot be reached. Check `docker compose logs manager mysql minio` for local diagnostics. API/MCP responses do not include environment credentials.

## Codex guidance

`AGENTS.md` is the project instruction entry point. Reusable backend skills are in `.agents/skills/`; selected frontend instructions and skills are included for future frontend work. They were adapted from the adjacent Znak backend and portal frontend project and are committed as local files, not symlinks. Claude-only `.claude/` instructions remain separate and are not part of AgentPier's Codex workflow.
