---
name: ssr-isr-cache-pattern
description: Angular-only; Safely change Angular rendering or route data when the target app uses SSR, hydration, or incremental caching.
---

# Angular SSR, hydration, and cache behavior

Use only when the target task/application is actually Angular. This skill does not apply to AgentPier's static HTML/CSS/JavaScript dashboard, even if included in the session prompt. Follow the profile's approval and result contract. SSR/hydration/cache guidance additionally requires that feature to be configured in the target Angular application.

Apply only when the target application has server rendering, hydration, transfer caching, ISR, or another route/data cache. Inspect its actual server configuration and closest route before changing behavior.

- Preserve the existing split between server-renderable content and browser-only interactions.
- Guard browser globals and DOM APIs on server execution.
- Keep server and client initial markup/data consistent to avoid hydration errors.
- Identify every cache layer already in use before adding or changing caching; avoid duplicate caches.
- When routes or API data change, check whether cache keys, invalidation, revalidation, or warm-up behavior also changes.
- Never send server secrets into browser bundles or rendered HTML.
- Verify direct route loads and hydrated navigation against the built server where the project supports them.

Do not assume a specific rendering mode, cache library, filesystem path, endpoint, or revalidation interval.
