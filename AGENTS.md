# AgentPier repository instructions

The canonical orchestration rules are in `orchestrator/instructions.md`. Each stack profile and its reusable skills live together in `agents/<profile>/`: `AGENTS.md` plus `skills/<skill>/SKILL.md`. Do not keep shared agent skills in a separate root folder or use generated project-local instructions as a source of truth.

## Manager application

- NestJS application source is under `apps/manager/src/`; migrations are under `apps/manager/migrations/`.
- Keep MySQL and `synchronize: false`. Make schema changes with reversible TypeORM migrations.
- Keep controllers thin, validate inputs at boundaries, and implement business rules in domain services.
- Codex app-server runs on the Mac, outside Docker. Send host absolute paths through its WebSocket protocol; do not mount user repositories into the Manager container or add a Host Agent.
- Start each managed task in a new app-server thread. Never take over an existing user session.
- Analysis is `read-only`. Execution uses the persisted user-approved plan and the exact user-selected target branch. If the branch is missing, the orchestrator asks and waits. If the selected branch exists but is not checked out, the assigned agent switches to that exact branch and preserves all existing changes; it does not choose a substitute branch. If the exact branch does not exist locally or remotely, ask before creating that exact name.
- Select application working directories from the LLM's explicit plan and the selected profile's repository-relative path instructions. Never infer an application or directory from check-command words.
- Agents may run installed host `git`/`gh` tools within actual permissions. Follow `orchestrator/instructions.md` for explicit commit, push, PR, submitted review, and merge scope; implementation approval alone authorizes none of these. One user instruction may explicitly cover multiple operations. Direct user instructions override conflicting local conventions, not system/safety or sandbox restrictions.
- Manager has no executable GitHub client or release API. Its current execution handoff forbids commit/push/PR/merge. Managed agent turns request network access while retaining their filesystem sandbox and `approvalPolicy: never`; instruction updates do not enable these capabilities. Report blocked actions rather than bypassing restrictions.
- Use existing permitted host authentication without displaying credentials. Never put credentials in database records, events, messages, prompts, commands, remote URLs, logs or reports; missing authentication requires user setup, not secret sharing.

## Verification

- For runtime orchestration changes, test the real MCP route and Codex app-server WebSocket. A successful build or HTTP health probe alone is insufficient.
- Run focused tests, lint and build for relevant application changes; for runtime changes verify Compose and the actual database migration state. Instruction-only work requires consistency/applicability review, an English-only scan of changed instructions and `git diff --check`, not application/runtime checks.
- Report integrations that were not exercised. Do not present records or mock output as real agent results.
