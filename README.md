# AgentPier

AgentPier is a local project manager and MCP server for Codex work across several local applications and Git repositories. It stores project context and task history in MySQL, runs fresh Codex app-server threads for analysis and approved implementation, and leaves changes in local branches for the user to review. It never pushes, opens pull requests, or merges as part of a normal task.

## Repository layout

- `apps/manager/` — NestJS API, MCP endpoint, orchestration, integrations, and migrations.
- `agents/backend/` and `agents/frontend/` — the two universal profiles available on first boot.
- `skills/` — versioned shared skills injected into sessions selected by each profile.
- `orchestrator/instructions.md` — rules injected into each managed session.
- `docs/architecture/` — C4 Context and Container diagrams.
- `docker-compose.yml` — Manager, MySQL, MinIO, and bucket initialization.

Profile and skill files are the source of truth. New sessions read them on every launch and save a content hash in the session record. Project-specific instructions and confirmed memory are added to the session prompt. Additional profiles can be added as directories under `agents/` without changing Manager code.

## Run locally

Requirements: macOS, Docker Desktop with Compose, Node 22 for local development, and Codex CLI/app-server installed on the Mac.

```sh
cp .env.example .env
# Set a local DB_PASSWORD and optional S3-compatible credentials in .env.
docker compose up --build -d
docker compose ps
```

Open <http://localhost:3100>. Compose persists MySQL and MinIO in named volumes and runs TypeORM migrations before Manager starts. `docker compose down` keeps data; `docker compose down -v` removes the local database and backups.

For local development, install dependencies with `npm ci`, point `.env` at a MySQL server, then run `npm run migration:run` and `npm run start:dev`.

## Codex app-server and local paths

Run the app-server on macOS, outside Docker, listening on port 4500. Manager uses:

- Docker → Mac: `ws://host.docker.internal:4500`
- Mac-local client → app-server: `ws://127.0.0.1:4500`
- readiness and health: `http://host.docker.internal:4500/readyz` and `/healthz` from Manager's network namespace.

`manager_status` checks both HTTP endpoints and opens a real WebSocket connection with the app-server JSON-RPC `initialize` method. An HTTP 200 alone does not mean session control is working. Check `GET /api/status` or call MCP `manager_status` for the concrete failure reason.

Register absolute **Mac paths**. The Manager container does not mount project checkouts. It sends the saved path in `thread/start` and `turn/start`; the host app-server resolves that exact path on the Mac. Applications and repositories must remain under the registered project root. Verify the intended path before analysis.

The installed Codex CLI accepts remote app-server connections. In an IDE terminal, a user can open the managed thread by its saved Codex session ID:

```sh
codex resume <codex-session-id> --remote ws://127.0.0.1:4500 -C /absolute/mac/project/path
```

`codex agents --remote ws://127.0.0.1:4500` opens the remote agent list. Manager always creates new threads; it does not take over existing sessions.

## MCP

The local Streamable HTTP endpoint is `http://localhost:3100/mcp`. It implements MCP `initialize`, `tools/list`, and `tools/call` through the same NestJS services and MySQL used by the UI. The tools cover project/application registration, profile and context reads, analysis, planning, explicit approval, execution, messages, cancellation, results, and backups. `docs/mcp.md` lists tool arguments and an example client setup.

**ChatGPT connection limitation:** ChatGPT's custom MCP apps connect to remote HTTPS endpoints; they cannot connect directly to `localhost`. OpenAI's current guidance for a developer machine is to connect through its Secure MCP Tunnel. This repository does not start a tunnel or expose the local endpoint, consistent with the local-only boundary. Therefore local MCP calls are verified here, but ChatGPT registration and calling AgentPier from ChatGPT require a separately available Secure MCP Tunnel and workspace permission. Do not enter `http://localhost:3100/mcp` as a ChatGPT remote server URL and expect it to work. See [OpenAI's MCP connection guide](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt).

## Projects and workflow

Register a project with an absolute local root. Then register one `repository` record per Git clone and one `app` record per application, linking each app to its repository. A project can contain multiple apps and repositories. Remote URLs are metadata; local branch and status operations use Git through the host app-server. Cloning a remote into a new local path is not yet exposed as a Manager operation.

The workflow is:

1. Call `analyze_task` with the verbatim user request. Manager selects backend/frontend profiles per application and starts new read-only threads. It saves thread IDs, profile and project instruction hashes, events, messages, and reports.
2. Discuss the analysis with the user and use `save_plan` to store a draft. Analysis must finish before planning.
3. Call `approve_plan` only after explicit user confirmation (`userConfirmed: true`). Manager stores the approved plan separately and refuses execution before approval.
4. Call `execute_task`. Manager validates the dependency graph, serializes tasks targeting the same checkout, creates a new local branch per step, starts a workspace-write session, and passes completed dependency results into downstream prompts.
5. Poll status/messages/results. Answer app-server user-input requests or send further instructions. Cancel interrupts active turns and retains history.
6. Review changed files, branch names, diff summaries, and reported checks in the local IDE. Push, PR, and merge remain a separate user decision.

Status values include `analysis_running`, `analysis_complete`, `plan_draft`, `approved`, `executing`, `blocked`, `cancelled`, and `review_ready`. A blocked task with an approved plan can be retried without losing its request or plan.

## Memory and data

MVP records are stored in the MySQL `manager_records` table with a kind, project association, JSON data and timestamps. Domain boundaries and provenance are described in [docs/domain-model.md](docs/domain-model.md). Confirmed context is passed into new analysis sessions; agent output is kept as output and is not automatically promoted to confirmed memory. Do not store secrets in project notes or prompts.

## Backups and restore

Compose includes MinIO and creates the configured bucket. Set `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, and optional `S3_PREFIX`, `BACKUP_SCHEDULE`, `BACKUP_RETENTION_DAYS`, and `RESTORE_TEST_DB` in the local `.env`. The backup tool captures a consistent logical MySQL snapshot, compresses it, uploads it with a SHA-256 checksum, journals the outcome, and prunes expired objects. A verified backup downloads the object, restores it into the isolated `agentpier_restore_test` database, and compares each table's row count and content checksum.

Call MCP `backup_database` with `verifyRestore: true` to run the full upload/list/download/restore verification. Compose creates the isolated restore database and grants access on a fresh MySQL volume. For an existing volume, apply `docker/mysql/init/10-restore-test.sh` once inside the MySQL container. Real cloud S3 credentials have not been checked; local MinIO is the integration target.

For restore operations and limits, see [docs/backup-restore.md](docs/backup-restore.md).

## Checks and limits

Run `npm run build`, `npm test -- --runInBand`, and `npm run lint`. The system has been exercised locally against Compose/MySQL/MinIO and a real WebSocket app-server. ChatGPT itself cannot reach this local server without Secure MCP Tunnel, and real cloud S3 credentials are not configured. Remote GitHub operations and remote cloning are outside the local MVP. The dashboard is a small Nest-served UI; there is no separate Angular application in this repository.

See [docs/architecture/c4-context.md](docs/architecture/c4-context.md), [docs/architecture/c4-container.md](docs/architecture/c4-container.md), and [docs/mcp.md](docs/mcp.md).
