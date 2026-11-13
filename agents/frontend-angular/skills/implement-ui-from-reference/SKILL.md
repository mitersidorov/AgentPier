---
name: implement-ui-from-reference
description: Implement a UI reference in the actual static or framework frontend using existing styles and accessible interactions.
---

# Implement UI from a reference

Use only for reference-driven UI work. Determine whether the target is static or framework-based before choosing files; AgentPier uses HTML/CSS/JavaScript, not Angular components.

1. Inspect the reference for page regions, states, interactions, and responsive changes.
2. Search existing markup, scripts, styles, tokens, and similar views before adding UI. Reuse the project's layout and breakpoints; do not introduce a parallel design system.
3. Keep API/state behavior in the existing boundaries and preserve the read-only contract where applicable.
4. Preserve semantic HTML, accessible names, keyboard interaction, visible focus, and required loading/empty/error/success states.
5. Apply Angular and SSR/hydration guidance only for an actual Angular application with those features configured.
6. Compare the rendered result with the reference at relevant viewport sizes. Report observed coverage and unavailable checks in the profile's result format; do not claim visual verification from source inspection.
