# Changelog

All significant changes to this project are recorded here.
Each entry is tagged with the branch it was made on.

---

## [delivery-workflow] — 2026-07-08

### Added
- `qa-runner` agent — boots the app against a real Docker-based Postgres/Redis/MinIO stack (`docker-compose.test.yml`) to catch runtime issues static review can't, before a change ships
- `coder` agent — merges the former `backend-architect`, `api-contracts`, and `migrations` agents into one full-stack implementation role covering modules, entities, API contracts, and migrations
- Four hooks in `.claude/settings.json`: auto-lint on save, a confirmation guard before hand-editing generated migration files, a hard block on `git push --force`/`git commit --amend`, and a build+test verification gate before every push
- A permission allowlist for recurring read-only/build commands (`npm test`, `npm run build`, `npx jest`, `npx tsc`) to cut down on approval prompts
- A "Plan Conformance" section in the `backend-review-checklist` skill so `code-reviewer` checks a change against the `system-analyst` plan it was built from
- `feature-implementation-workflow.puml` and its rendered `.png` — a full block-scheme diagram of the delivery workflow, embedded in `README.md`
- A human commit/push approval gate on `repo-publisher`, separate from `team-lead`'s own pre-publish approval question

### Updated
- Merged the `changelog` agent's responsibilities directly into `team-lead` — it now writes `CHANGELOG.md` itself, after the user approves the change and immediately before publish
- Merged `template-curator` into `template-maintainer`, which now owns both directions of template alignment: pulling upstream changes down (unchanged) and pushing new conventions up — the push direction no longer drafts a file change directly, it files a GitHub issue suggesting the update for a human to review instead
- `CLAUDE.md`'s "Never Touch Without Explicit Request" rule now carves out `docker-compose.test.yml` as a `qa-runner`-owned exception to the Docker/deployment-config restriction
- `README.md` — updated the agent table and delegation flow, added a "Local Verification (Docker)" section, and embedded the workflow diagram

### Removed
- `backend-architect`, `api-contracts`, and `migrations` agents (replaced by `coder`)
- `changelog` agent (folded into `team-lead`)
- `template-curator` agent (folded into `template-maintainer`)

---

## [delivery-workflow] — 2026-07-05

### Updated
- Added a `tools:` frontmatter allowlist to all 10 Claude agents so each is structurally restricted to only the tools its charter requires — `system-analyst` and `repo-publisher` lose `Edit`/`Write`, most specialists lose `Agent` access entirely, and `team-lead` is the only agent that can spawn other agents, scoped to a named list
- Reworded `template-curator`, `repo-publisher`, and `changelog` instructions that told them to invoke another agent directly, since their new tool lists no longer include `Agent` access — `team-lead` now sequences those handoffs instead

---

## [delivery-workflow] — 2026-07-04

### Added
- `team-lead` agent — single owner of the delivery workflow, classifies requests as informational/tiny-edit/substantive/template-sync and routes them accordingly, keeps `repo-publisher` as the terminal step
- `system-analyst` agent — planning-only role handling discovery, conflict detection, scope guard, and risk assessment for substantive changes; returns a plan without coding or invoking other agents
- `template-maintainer` agent — owns sync analysis between this project's Claude instructions and the upstream template repo, with a proposal-mode audit and a gated apply mode, tracking state in `.claude/template-sync-state.json`
- `.claude/settings.json` — `SessionStart` hook that has `team-lead` run one template-maintainer proposal-mode audit before the first substantive request each session

### Updated
- `CLAUDE.md` — added a "Delivery Workflow" section defining `team-lead` as the workflow owner, the allowed agent delegation paths, and no-recursion rules
- `README.md` — added a "Claude Agent Workflow" section documenting all agents and the delegation flow

---

## [changelog] — 2026-06-19

### Added
- changelog agent that creates and maintains this file — adds a dated, branch-tagged entry for every significant change before it is committed

---

## [linter] — 2026-06-08

### Added
- ESLint flat config (`eslint.config.mjs`) using typescript-eslint + prettier — all packages were already present in devDependencies but had no config backing them
- Prettier config (`.prettierrc`) with `singleQuote`, `trailingComma: all`, and `printWidth: 120` to match the existing codebase line lengths

### Updated
- All source files reformatted to the new rules — collapsed long import and call lines, added trailing newlines

---

## [claud-indtructions] — 2026-06-08

### Added
- `repo-publisher` agent — owns commit message format (`Added` / `Updated` / `Removed` style), push, and PR creation; never merges to main
- `template-curator` agent — judges whether a newly implemented pattern is project-specific or template-generic, and drafts the instruction update; delegates shipping to `repo-publisher`

### Updated
- `CLAUDE.md` maintenance rules now point to `template-curator` for deciding whether a new convention belongs in the shared template instructions

---

## [claud-indtructions] — 2026-04-13

### Added
- `CLAUDE.md` — full project instruction file covering stack, architecture rules, entity conventions, testing philosophy, migration policy, and canonical commands
- `backend-architect` agent — enforces module anatomy, entity conventions, service/controller boundaries, and logging patterns
- `api-contracts` agent — governs DTO file set, validation rules, pagination contract, Swagger requirements, and backward-compatibility rules
- `migrations` agent — covers entity placement, CLI-only generation policy, data source files, and schema safety
- `code-reviewer` agent — reviews changes against the template architecture using the `backend-review-checklist` skill
- `nestjs-domain-scaffold` skill — canonical directory layout and file templates for new domain modules
- `minimal-test-strategy` skill — default CRUD test set, test harness structure, and mocking conventions
- `integration-pattern` skill — HttpService usage, module wiring, and retry/backoff behavior for external HTTP integrations
- `auth-oauth-module-pattern` skill — JWT-based auth, role-based access control, hybrid guard pattern, and `@CurrentUser` decorator
- `typeorm-migration-workflow` skill — end-to-end migration workflow, safety rules, and post-generation checklist
- `backend-review-checklist` skill — full review checklist used by the `code-reviewer` agent

---

## [main] — 2026-04-13

### Added
- Production-ready NestJS 11 template with pre-wired infrastructure: PostgreSQL/TypeORM, Redis (ioredis), S3-compatible storage (AWS SDK v3), configurable HTTP client with retry/backoff, global exception filter, API key guard, and Swagger UI
- `health` domain module — `GET /health` returning app name, environment, and uptime
- Docker Secrets loader — reads `/run/secrets/` and injects values as environment variables

### Updated
- Error responses now include a machine-readable `errorCode` field
- Exception filter falls back to a string error code derived from the HTTP status when no explicit code is provided
- Production data source configured separately from the dev data source