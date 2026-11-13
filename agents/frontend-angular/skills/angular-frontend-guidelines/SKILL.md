---
name: angular-frontend-guidelines
description: Angular-only; Apply Angular-specific development practices while following the target application's own version and architecture.
---

# Angular frontend guidelines

Use only when the target task/application is actually Angular. This skill does not apply to AgentPier's static HTML/CSS/JavaScript dashboard, even if included in the session prompt. Follow the profile's approval and result contract.

Begin by identifying the installed Angular version, rendering mode, build system, and local component/state/API patterns. Follow the target project as the source of truth.

- Prefer the Angular APIs and component style supported by the installed version and used by nearby code.
- Keep components focused on presentation and local interaction; put data access and business transformations in the application's established layers.
- Reuse existing UI components, styles, and tokens. Preserve semantic HTML, keyboard access, visible focus, and responsive behavior.
- Use generated API clients through the application's established boundary. Do not edit generated code directly.
- Guard browser-only APIs when server rendering is enabled. Preserve hydration and server-rendered content.
- Keep loading, empty, error, and success states clear. Verify the supported viewport sizes and relevant routes.
- Avoid adding dependencies or new state/network abstractions without a demonstrated need and approval.
