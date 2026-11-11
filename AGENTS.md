# AgentPier Codex instructions

## Project boundaries

- AgentPier is a local project manager and MCP interface. Preserve the user-led analysis → explicit approval → execution → review loop. Never publish or merge project changes as part of an ordinary task.
- The Manager is NestJS and MySQL. Keep schema changes migration-based (`synchronize: false`). MySQL is required; do not substitute SQLite or PostgreSQL.
- Codex app-server runs on the Mac host, outside Docker. Never package Codex CLI/app-server or add a Host Agent to Compose.
- Preserve user files and local Git changes. Validate project-bound paths before filesystem operations.
- Never claim a Codex session, backup, restore or Git change occurred unless the operation ran and returned a verified result.
- Never store secrets in tasks, logs, memory or prompts. Environment secrets belong only in ignored `.env`.

## NestJS conventions

- Keep controllers thin and put orchestration in services.
- Put TypeORM entities under `src/<domain>/entities/` and migrations under `src/migrations/`.
- Inject `Repository<Entity>` directly; avoid a repository wrapper without a concrete need.
- Keep shared infrastructure in `src/common/` and domain boundaries in `src/<domain>/`.
- Validate all incoming DTOs, reject unknown fields where practical, and return consistent HTTP errors.
- Add new environment variables to `.env.example`; update API/domain/operational docs with behavior changes.

## Frontend guidance

There is no standalone Angular app in this repository yet. If one is introduced, follow `.codex/frontend-guidelines.md` and the reusable Angular skills in `.agents/skills/`. The current dashboard is served by NestJS.

## Reusable skills

Backend and frontend reusable skills are versioned under `.agents/skills/`. Apply the closest relevant skill when changing its area; adapt instructions to AgentPier rather than importing unrelated Znak services or authentication assumptions.

## Verification and delivery

- Run checks proportionate to changed behavior. For runtime or integration changes, test the actual local service route where the needed services are available.
- Review the final diff and report exact commands/results and unverified integrations.
- Follow the user's explicit delivery instructions for branch, commit and merge; those instructions override generic workflow preferences.
