# AgentPier repository instructions

The canonical orchestration rules are in `orchestrator/instructions.md`. Universal profiles live in `agents/`; reusable skills live in `skills/`. Do not use generated project-local instructions as a source of truth.

## Manager application

- NestJS application source is under `apps/manager/src/`; migrations are under `apps/manager/migrations/`.
- Keep MySQL and `synchronize: false`. Make schema changes with reversible TypeORM migrations.
- Keep controllers thin, validate inputs at boundaries, and implement business rules in domain services.
- Codex app-server runs on the Mac, outside Docker. Send host absolute paths through its WebSocket protocol; do not mount user repositories into the Manager container or add a Host Agent.
- Start each managed task in a new app-server thread. Never take over an existing user session.
- Analysis is `read-only`. Execution requires a persisted user-approved plan and uses a new local branch without discarding user changes.
- Never push, create a PR or merge project work without a separate user instruction.
- Never put credentials in database records, events, messages or prompts.

## Verification

- Test the real MCP route and Codex app-server WebSocket for orchestration changes. A successful build or HTTP health probe alone is insufficient.
- Run focused tests, lint and build; for runtime changes verify Compose and the actual database migration state.
- Report integrations that were not exercised. Do not present records or mock output as real agent results.
