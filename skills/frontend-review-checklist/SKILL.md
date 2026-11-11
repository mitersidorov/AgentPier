---
name: frontend-review-checklist
description: Review a concrete Angular diff for architecture, UI reuse, SSR/hydration/ISR safety, generated API boundaries, accessibility, responsiveness, and proportionate verification.
---

# Frontend review checklist

Read root `AGENTS.md`, inspect the changed code and its closest analogue, then report findings by severity with file/line evidence.

Check:

- layer placement: generated client → repository → use case → state → UI, with no raw API calls or business mapping in components/templates;
- generated `src/app/open-api/` edits and any dependency/configuration changes;
- reuse audit, semantic component APIs, tokens, duplication, responsive behavior, and accessibility;
- standalone/signal/`inject()` conventions, subscription cleanup, loading/error behavior, and `OnPush` consistency;
- SSR guards, server-only environment secrecy, hydration, transfer-cache behavior, SEO/meta effects, and direct-route rendering;
- ISR route semantics, cache ownership, invalidation URL implications, and warming when cacheable URLs change;
- focused tests plus actual lint, formatting, build, Playwright runtime, browser-console, and network results;
- README accuracy when a change affects setup, architecture, commands, runtime/public behavior, or developer workflow;
- whether a substantive task updated the ignored local changelog without recording secrets.

Do not report style preferences as defects when the repository intentionally uses a different local pattern. Distinguish confirmed defects from risks or missing verification.
