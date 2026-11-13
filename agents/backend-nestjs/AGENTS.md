# Backend NestJS profile

<!-- skills: backend-review-checklist, integration-pattern, manage-typeorm-migration, minimal-test-strategy, nestjs-domain-scaffold, verify-docker-runtime -->

## Orchestration and handoff

- Follow `orchestrator/instructions.md` for approval, branch selection, fresh threads, instruction priority, and session evidence. These rules apply to every managed implementation, regardless of task size; a skill never grants approval.
- Execute only the persisted, explicitly approved scope on its user-selected `targetBranch`. Never infer, create, or switch branches automatically; if the selected branch is not checked out, stop and ask the user to check it out. Preserve unrelated changes.
- Inspect `.local-context/current-task.md` when present; other local notes are historical. The current request, repository state, and confirmed project instructions override local notes.
- Communicate in the user's language; follow the target repository's language for source and documentation. Keep evidence concise and never include secrets.

Use these compact Markdown sections for both profiles (presentation conventions, not new API fields):

- **Task input:** verbatim request; approved plan/step and exact approval reference; application, repository/path, profile, `targetBranch`; current contract, dependency results, confirmed memory and instruction/skill versions or hashes; acceptance checks and exclusions. If approval or branch is missing, ask instead of implementing.
- **Agent result:** status (`completed`, `partial`, or `blocked`); repository/branch; completed and incomplete scope; changed files; checks with exact commands and outcomes; confirmed defects, unverified integrations/risks, and decisions needed. Do not repeat the full prompt or present mocks as live results.
- **User report:** outcome; affected repository/branch and key changes; checks actually run; remaining risks/decisions and local report path. Keep this shorter than the agent result and use the user's language.

Before handoff, review the scoped diff and write an ignored `reports/` Markdown report with completed/incomplete work, exact verification results, problems, risks, and final working-tree status. Never stage or commit reports. Follow the canonical Git and release scope rules: installed host `git`/`gh` may be used within actual permissions; commit, push, PR, submitted review, and merge each need explicit scope, which may be supplied together in one user instruction. Local read-only review does not authorize submitting a review. Direct user instructions override conflicting local conventions, not system/safety or sandbox restrictions.

Manager currently has no GitHub client or release API; its managed execution handoff forbids commit/push/PR/merge. Managed agent turns request network access while retaining their filesystem sandbox and `approvalPolicy: never`. Do not mistake policy permission for runtime capability or bypass restrictions. Use existing permitted host authentication without displaying credentials; keep secrets out of commands, URLs, prompts, records, logs, and reports. Before authorized release actions, inspect full untracked status plus staged/unstaged diffs and preserve all unrelated work. Report only observed results and explicitly identify blocked or unverified operations.

## Implementation

- Inspect the nearest module and tests before choosing abstractions. Prefer minimal, backward-compatible changes.
- Keep controllers thin and domain behavior in services. Keep controllers, services, entities, DTOs, types, and tests in their respective domain subfolders, even for a single file.
- Give each new or changed NestJS module one concise English single-line intent comment.
- Fail fast on missing credentials; never add insecure fallback values. Do not add dependencies or change environment, deployment, CORS, throttling, or production sources without explicit approval. Document new variables in `.env.example` without secrets.
- Update README/API documentation when behavior or workflow changes; update changelog at the publish stage. Do not change application code for instruction-only checks.

## Skill selection and verification

Load applicable versioned skills from this profile's `skills/` directory, not a root skills folder:

- `backend-review-checklist`: review a concrete NestJS diff.
- `integration-pattern`: add or change an external HTTP integration.
- `manage-typeorm-migration`: TypeORM schema changes only.
- `minimal-test-strategy`: design focused NestJS/Jest tests.
- `nestjs-domain-scaffold`: add a domain or substantial NestJS feature.
- `verify-docker-runtime`: changes involving container wiring, persistence, migrations, or external services.

Run narrow checks first; expand to lint/build/runtime when relevant. Instruction-only work needs conflict/applicability review, an English-only scan of changed instructions, and `git diff --check`, not unrelated application tests. Report checks not run and why.
