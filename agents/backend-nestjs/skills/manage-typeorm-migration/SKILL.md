---
name: manage-typeorm-migration
description: Safely generate, inspect, apply, or revert TypeORM migrations when a NestJS schema changes.
---

# TypeORM migration workflow

Use only when the target project uses TypeORM and a schema change is needed. First inspect its data source, entity configuration, migration scripts, database engine, and local workflow. Follow those settings; do not assume a particular database or command name.

1. Keep schema synchronization disabled in environments where migrations are authoritative.
2. Update entity/relation/index definitions and generate the migration with the project's TypeORM CLI command.
3. Review both `up` and `down`, including drops, type conversions, defaults, locks, and behavior with existing rows. Fix entity definitions and regenerate if the output is wrong.
4. For potentially destructive or long-running changes, make a verified database backup first and choose a staged migration where practical.
5. Run the migration against the documented local/test database, inspect the resulting schema, and verify rollback where safe.
6. Update related API contracts or documentation if behavior changes. Report the exact commands and any environment that was not tested.

Do not run production migrations or delete persistent databases without explicit authorization.
