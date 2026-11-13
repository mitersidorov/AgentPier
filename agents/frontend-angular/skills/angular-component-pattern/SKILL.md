---
name: angular-component-pattern
description: Angular-only; Create or extend an Angular component using the nearest project example and version-compatible APIs.
---

# Angular component pattern

Use only when the target task/application is actually Angular. This skill does not apply to AgentPier's static HTML/CSS/JavaScript dashboard, even if included in the session prompt. Follow the profile's approval and result contract.

Use the closest analogous component as the final authority. Check the Angular version and existing project conventions before selecting APIs.

- Prefer focused components with clear inputs, outputs, and responsibility boundaries.
- Reuse existing shared components, directives, pipes, design tokens, and layout utilities before creating new ones.
- Follow the project's input/output, dependency-injection, signal/observable, and change-detection patterns.
- Keep transport calls and domain transformations out of presentation-only components.
- Clean up subscriptions and event listeners using the project's established lifecycle pattern.
- Guard DOM, window, storage, and other browser-only work if server rendering is used.
- Use semantic HTML, accessible labels, keyboard interaction, visible focus, and the project's responsive breakpoints.
- Run focused component tests and the relevant formatter/linter/build checks.
