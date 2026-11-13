---
name: nestjs-domain-scaffold
description: Scaffold a NestJS domain/module that fits the target application's conventions.
---

# Scaffold a NestJS domain

Use when adding a domain boundary or a substantial new feature. Inspect the closest existing module first. Reuse its naming, folder layout, dependency-injection, persistence, validation, response, logging, and test patterns. Do not copy a template from another repository over local conventions.

Follow the profile's domain folder layout and module-comment convention. Scaffolding does not authorize implementation: use only the persisted approved scope and selected branch under `orchestrator/instructions.md`.

## Typical responsibilities

- A module wires the domain's providers, controllers, and required imports/exports.
- Controllers adapt transport input/output and delegate business rules.
- Services/use cases own application behavior and call persistence or integrations through the established interfaces.
- DTOs or schemas validate external input at the boundary.
- Entities/models and migrations are added only if required by the project's persistence technology.
- Tests focus on business behavior, boundary mapping, and failure cases appropriate to the domain.

## Workflow

1. Confirm the approved scope, API contract, owning repository, and dependencies.
2. Inspect neighboring modules and tests; write down the pattern being followed.
3. Create the smallest complete module, register it with the application, and preserve existing contracts.
4. Add schema changes through the project's migration workflow when applicable.
5. Update API documentation and README for user-visible behavior or setup changes.
6. Run the focused tests and documented checks; report incomplete runtime or integration verification.

Do not add a repository abstraction, ORM, global module, or new framework dependency unless the target project already uses it or the approved plan requires it.
