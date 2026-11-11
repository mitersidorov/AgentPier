# Angular frontend guide (conditional)

Apply these Angular-specific conventions only when the registered frontend is an Angular application. For other frameworks, use `skills/frontend-general-guidelines/SKILL.md` and follow the project's local instructions. Do not impose Angular architecture on React, Vue, or native clients.

## Architecture

- Angular 21 standalone application. Routes lazy-load components from `src/app/app.routes.ts`; server rendering is configured in `app.routes.server.ts`, `app.config.server.ts`, and `src/server.ts`.
- Feature code follows `data → domain → ui/state → ui/components|pages`. Inspect the closest feature before adding one. Put API orchestration in repositories, transformations in use cases, and view state in `StateModel` subclasses.
- `src/app/open-api/` is generated from the BFF OpenAPI document. Use its services through repositories. Never manually edit it; regenerate with `npm run generate:api:dev` or `npm run generate:api:prod` only when the contract is available. Those commands preserve the repository’s generated-TypeScript formatting and retain a production-safe fallback URL; runtime API origin is injected from the active Angular environment.

## Non-negotiable rules

- Treat SSR, hydration, HTTP transfer cache, and ISR as feature correctness. `src/server.ts` owns filesystem ISR cache, invalidation endpoints, and warm-up. Do not add a competing cache or casually change invalidation secrets/endpoints.
- Guard browser-only work with the established `PLATFORM_ID` / `isPlatformBrowser` pattern and use injected `DOCUMENT`/project abstractions where applicable. Preserve server-rendered primary and SEO content; existing publication related content is intentionally browser-only.
- Perform a reuse audit across `src/app/shared/components`, the current feature, and similar features before creating UI. Extend a component only with a semantic, backwards-compatible API.
- Use `inject()`, signal inputs/outputs, and `$` signal-property names where existing code does. Use `OnPush` where the analogous component does; do not introduce a new state or HTTP library.
- Reuse tokens in `src/app/shared/styles/`, Tailwind breakpoints, and current SCSS conventions. Project breakpoints are mobile `0`, tablet `748px`, desktop `1100px`.
- Do not add dependencies or commit/push without explicit approval.

## Verification and delivery

- Canonical checks: `npm run lint`, `npm run format:check`, `npm run test:vitest`, `npm run build`; run the focused subset proportionate to the change.
- Visible or SSR-sensitive work also needs Playwright against the built SSR runtime: `npm run test:e2e`. It launches the server, direct-loads routes, checks browser/network failures, and captures artifacts at mobile, tablet, and desktop sizes. Add deterministic visual snapshots only where suitable.
- Before any approved commit, review `README.md`. Update it when the change affects project setup, architecture, commands, runtime behavior, public behavior, or developer workflow; otherwise state explicitly that no README update is needed.
- Preserve unrelated working-tree changes. Report changed files, verification actually run, failures, cache/SSR implications, and unresolved risks.

## Local task memory

- When it exists, review ignored `.local-context/CHANGELOG.md` at the start of substantive work and append a concise completion/verification/risk note before handoff. The current request, working tree, and tracked documentation override it. Never store secrets or treat it as architectural truth.

## Skills and roles

Use the applicable versioned skill under `skills/`: `implement-angular-feature`, `frontend-review-checklist`, or `verify-frontend-runtime`. Agent profiles are sourced from `agents/` and session instructions from `orchestrator/instructions.md`.
