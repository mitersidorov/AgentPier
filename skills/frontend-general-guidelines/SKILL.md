# Frontend project workflow

Use these guidelines for frontend repositories that are not covered by a framework-specific project skill.

- Identify the actual framework, build system, router, component conventions and supported browsers before editing.
- Keep data access, domain state and presentation in the layers already used by the project.
- Preserve the existing generated API boundary. Do not hand-edit generated files.
- Use current design tokens and shared UI components. Keep keyboard navigation, labels, focus and contrast intact.
- Handle loading, empty, error and success states, and check the narrowest supported viewport.
- Run the repository's documented checks and report the exact results. Do not invent a test or build command when the repository has no package manifest.
- Follow local project instructions and approved task scope. Never push, create a pull request or merge unless the user separately asks.
