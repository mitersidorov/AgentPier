---
name: frontend-review-checklist
description: Review static or framework frontend changes for correctness, accessibility, security, and verification.
---

# Frontend review

Inspect the concrete diff and nearest implementation. Use for static HTML/CSS/JavaScript as well as framework frontends; Angular checks apply only to an actual Angular task/application.

- Placement/reuse: existing markup, scripts, styles, tokens, components, and API boundaries; no unnecessary framework or abstraction.
- UI behavior: semantic markup, keyboard/focus operation, accessible names, responsive layout, and loading/empty/error/success states.
- Data/security: correct read/error contracts, safe DOM updates, listener cleanup, no secrets in browser artifacts, and no generated-file edits. AgentPier's dashboard stays read-only and never proxies MCP writes.
- Static hosting: asset URLs, direct navigation, Nginx fallback/proxy behavior, and caching only where affected by the diff.
- Angular only: installed-version compatibility, change detection, subscriptions, forms, and routing. Check SSR/hydration/cache consistency only when configured.
- Verification/docs: exact applicable tests and runtime observations, missing checks, and README updates when needed.

Report actionable defects with severity and file/line evidence using the profile's agent-result format. Separate confirmed defects from unverified risks; do not label deliberate local conventions as defects.

## Instruction and release review

For instruction-only changes, review consistency and applicability across `orchestrator/instructions.md`, repository instructions, both profiles and affected skills. Scan changed instructions for English-only content and run `git diff --check`; do not require unrelated application/runtime checks.

For Git/release work, use the canonical explicit operation scopes and actual host permissions. Installed `git`/`gh` do not require a Manager GitHub client. Local review is not a submitted GitHub review; commit, push, PR, submitted review and merge each need explicit user scope, possibly in one instruction. Check the selected branch, full tracked/untracked inventory, staged/unstaged diffs and exclusions without exposing credentials. Preserve unrelated work and ignored reports. Distinguish policy authorization from Manager's current no-publish handoff/network restrictions; report blocked actions and unverified remote results rather than claiming a release or bypassing restrictions.
