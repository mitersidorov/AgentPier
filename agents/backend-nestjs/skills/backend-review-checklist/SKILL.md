---
name: backend-review-checklist
description: Review NestJS changes for architecture fit, API behavior, security, persistence changes, tests, and documentation.
---

# NestJS backend review

Read the target repository's instructions and inspect the concrete diff with its surrounding modules. Report actionable findings with severity and file/line evidence. Follow local conventions; the checks below are prompts, not a replacement architecture.

- Boundaries: controllers are thin; domain rules and orchestration live in the existing service/domain layer; dependencies follow the module's established patterns.
- Contracts: request validation, response shape, error mapping, pagination, and compatibility match the API contract and neighboring endpoints.
- Security: authorization is applied where required; input is constrained; secrets and sensitive values do not enter logs or responses.
- Persistence: entity/schema changes have appropriate migrations for the repository's ORM and database; migrations are reversible where practical and do not silently discard data.
- Integrations: the existing transport, timeout, retry, and error-mapping conventions are used without duplicate client or retry layers.
- Reliability: asynchronous work, transactions, and external failures have explicit handling appropriate to the feature.
- Verification: focused tests and documented lint/build/runtime checks are run as appropriate. Distinguish verified behavior from risks or missing checks.
- Maintenance: relevant API docs and README are updated when public behavior or developer workflow changes.

Report confirmed defects separately from unverified risks. Do not flag a deliberate local convention as a violation solely because another project uses a different pattern.

## Instruction and release review

For instruction-only changes, review consistency and applicability across `orchestrator/instructions.md`, repository instructions, both profiles and affected skills. Scan changed instructions for English-only content and run `git diff --check`; do not require unrelated application/runtime checks.

For Git/release work, use the canonical explicit operation scopes and actual host permissions. Installed `git`/`gh` do not require a Manager GitHub client. Local review is not a submitted GitHub review; commit, push, PR, submitted review and merge each need explicit user scope, possibly in one instruction. Check the selected branch, full tracked/untracked inventory, staged/unstaged diffs and exclusions without exposing credentials. Preserve unrelated work and ignored reports. Distinguish policy authorization from Manager's current no-publish handoff/network restrictions; report blocked actions and unverified remote results rather than claiming a release or bypassing restrictions.
