---
name: implement-angular-feature
description: Angular-only; Implement an Angular feature using the target repository's established component, data, state, API, and rendering conventions.
---

# Implement an Angular feature

Use only when the target task/application is actually Angular. This skill does not apply to AgentPier's static HTML/CSS/JavaScript dashboard, even if included in the session prompt. Follow the profile's approval and result contract.

Read the target repository instructions and inspect the nearest feature before choosing files or abstractions.

1. Confirm the approved behavior and API contract. Identify the Angular version, router, rendering mode, styles, and test commands.
2. Search for a reusable component, service, state pattern, or nearby feature before adding one.
3. Keep data access and transformations in the project's established layers; keep templates and presentation components focused.
4. Use generated API clients through their intended boundary. Do not hand-edit generated files.
5. Assess SSR, hydration, browser-only APIs, and caching only as they apply to this application's configuration.
6. Follow adjacent code for standalone components, signals, dependency injection, change detection, and subscription cleanup; do not impose a pattern unsupported by the installed version.
7. Include accessible labels and keyboard interactions, responsive layout, and meaningful loading/empty/error/success states.
8. Run focused tests and the relevant documented lint/build/runtime checks. Report exact results and any unverified behavior.

Do not add a state library, request wrapper, cache layer, or dependency without an approved need.
