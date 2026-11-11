---
name: implement-angular-feature
description: Implement a production Angular feature in this repository while preserving its data/domain/state/UI layers, generated API boundary, SSR, and ISR behavior.
---

# Implement Angular feature

Read root `AGENTS.md`, then inspect the closest existing feature before choosing files or abstractions.

1. Classify the change: isolated UI, normal feature, or high-risk rendering/cache/state architecture. For the last category, produce a concrete plan and wait for approval before changing code.
2. Audit reuse in `src/app/shared/components`, the target feature, and similar features. Reuse first; add a small semantic variant only when it stays clear. Create a component only for a genuinely new boundary.
3. Place work in the existing layers: generated OpenAPI service → data repository → domain use case → signal `StateModel` → page/component. Do not put raw BFF calls or business mapping in templates/components.
4. Inspect `src/app/open-api/` before any request. It is generated. Use the represented service through a repository; regenerate only through a repository command when the API contract changed.
5. Assess SSR before implementation: initial/SEO data must remain server-renderable when analogous pages do; browser-only data must use project guards. Then assess the existing transfer cache, state lifetime, ISR HTML cache, invalidation, and warm-up before changing request or route behavior.
6. Implement in the surrounding code style. Use standalone imports, `inject()`, signal APIs and `$` property names as the nearest code does. Pass `DestroyRef` to state operations that subscribe.
7. Test the behavior at the narrowest meaningful layer, inspect the diff, and run lint/format/build as relevant. Use `verify-frontend-runtime` and `npm run test:e2e` for visible or SSR-sensitive work. Append a short result to `.local-context/CHANGELOG.md` for substantive tasks.

Do not add packages, a state library, a request wrapper, or cache layer without explicit approval.
