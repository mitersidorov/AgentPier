---
name: frontend-general-guidelines
description: Implement frontend changes using the actual static or framework application and its existing conventions.
---

# Frontend implementation

Use for static HTML/CSS/JavaScript and general frontend work. Framework-specific guidance applies only when the task/application uses that framework; profile approval and handoff rules still apply.

- Inspect the actual entry points, styling, scripts, hosting, and supported browsers. For AgentPier, start with `apps/frontend/public/` and the frontend Nginx configuration, not Angular tooling.
- Keep data access, state, and presentation in the existing layers. Preserve the read-only dashboard contract; do not introduce MCP writes or a new framework.
- Reuse existing markup, styles, tokens, and UI patterns before creating abstractions.
- Preserve semantic HTML, keyboard navigation, labels, focus, contrast, responsive layout, and loading/empty/error/success states.
- Render untrusted data safely; keep secrets out of browser code, URLs, and logs. Preserve generated API boundaries when present.
- Use documented checks only. Do not invent test/build commands for a static app without a package manifest. Use `verify-frontend-runtime` for visible/runtime changes and the profile's result format for handoff.
