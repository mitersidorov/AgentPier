---
name: verify-frontend-runtime
description: Verify static or framework frontend behavior using its real hosting, browser, and available checks.
---

# Verify frontend runtime

Use for visible/runtime changes. Inspect actual entry points, hosting, routes, available scripts, and existing tests first. Do not assume Angular, SSR, Playwright, a package manifest, or a health route.

1. Run documented focused tests/lint/build checks where available. AgentPier's static files are copied into Nginx; do not run Angular builds for them.
2. Inspect the actual application in a browser at desktop and narrow viewports. Check affected interactions, direct navigation, asset loading, browser errors, and failed requests when available.
3. For affected AgentPier paths, verify read-only `/dashboard/` requests and hosting behavior; never use the dashboard as an MCP write proxy. Do not alter Nginx or deployment configuration without approved scope.
4. For actual Angular applications only, check configured SSR/hydration against the built server. Verify cache invalidation only when the task/application uses that cache and doing so is safe.
5. Use the profile's result format: exact commands/outcomes, route and viewport coverage, observed failures, and unexercised checks. Reuse established test artifacts; never claim browser checks without observing the rendered page.
