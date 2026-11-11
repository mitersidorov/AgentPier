---
name: verify-frontend-runtime
description: Perform runtime QA for this Angular SSR frontend, including built-server checks, direct navigation, hydration, console/network inspection, responsiveness, and cache behavior when relevant.
---

# Verify frontend runtime

Use the smallest relevant verification set, then record commands and outcomes.

1. Run focused unit tests when behavior changed, then `npm run lint`, `npm run format:check`, and `npm run build` as applicable.
2. For visible/SSR work, run `npm run test:e2e`. Playwright builds and launches the SSR output, waits for `/health`, directly loads routes, checks browser and same-origin failed-network signals, and captures screenshots plus all failed requests at mobile, tablet, and desktop Chromium viewports. Review non-origin failures rather than hiding them.
3. Extend `e2e/` for changed flows. Retain artifact screenshots for exploratory QA; use `toHaveScreenshot` baselines only for deterministic content, and update them intentionally with `npm run test:e2e:update`.
4. When routes/data affect cache behavior, verify the correct ISR behavior and, only with safe test credentials/authorization, the appropriate invalidation endpoint. Confirm that a new URL shape is covered by BFF invalidation/warm-up expectations.

`ng serve` is useful for iteration but does not replace `npm run test:e2e` against the built Express/ISR runtime. Append substantive QA results to `.local-context/CHANGELOG.md`; do not expose secrets there or in test artifacts.
