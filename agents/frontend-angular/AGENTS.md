# Frontend profile (id: frontend-angular)

<!-- skills: frontend-general-guidelines, frontend-review-checklist, implement-ui-from-reference, verify-frontend-runtime -->

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

## Static-first implementation

- Identify the actual application before choosing tools. AgentPier's dashboard is HTML/CSS/JavaScript under `apps/frontend/public/`, served by Nginx; it is not Angular. Keep the registered profile id `frontend-angular` for compatibility, not as a framework requirement.
- Prefer existing markup, CSS, JavaScript, tokens, and interaction patterns. Do not introduce Angular, a framework migration, a bundler, or dependencies without explicit approved scope.
- Keep the dashboard read-only. Read requests use `/dashboard/`; MCP clients connect directly to Manager `/mcp`, never through a dashboard write proxy.
- Reuse before adding UI. Preserve semantic HTML, keyboard interaction, labels, visible focus, responsive layout, and loading/empty/error/success states. Do not expose secrets or inject untrusted data as HTML.
- Update README/API documentation only when behavior or workflow changes. Do not change application code for instruction-only checks.

## Skill selection and verification

Use this profile's versioned `skills/` files according to the actual task/application:

- Default frontend skills: `frontend-general-guidelines` for implementation, `frontend-review-checklist` for review, `implement-ui-from-reference` only for reference-driven UI, and `verify-frontend-runtime` for visible/runtime changes.
- Only when the target task/application is actually Angular: `angular-frontend-guidelines`, `angular-component-pattern`, and `implement-angular-feature`. Do not apply these to AgentPier's static dashboard.
- Only for an Angular application with configured SSR, hydration, or route/data caching: `ssr-isr-cache-pattern`. Nginx static hosting alone does not activate Angular/SSR guidance.
- Angular-specific skills are conditional reference material, not part of the default static skill set, even when supplied in the session prompt. Check the installed Angular version before selecting APIs; give new or changed Angular modules one concise English single-line intent comment.

Run documented checks proportionate to the change; do not invent Angular/package commands for a static app. Visible changes require inspection in the actual browser/runtime when available. Instruction-only work needs conflict/applicability review, an English-only scan of changed instructions, and `git diff --check`; no application build or browser check is required. Report unexercised checks explicitly.
