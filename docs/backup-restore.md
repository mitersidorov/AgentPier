# Backup and restore

Manager runs the configured cron schedule and accepts manual/milestone backup requests. The backup service:

1. Opens a repeatable-read MySQL transaction and captures table definitions and rows.
2. Encodes binary/date values, serializes and gzips the snapshot, then computes SHA-256.
3. Uploads the object to the configured S3 bucket/prefix with the checksum as metadata.
4. Saves an operation record with status, timing, object key, size and sanitized error text.
5. Applies the retention window to older objects.

For a full round trip, call MCP `backup_database` with `verifyRestore: true`. Manager downloads the uploaded object, checks its SHA-256, gunzips it, replaces tables in the isolated `agentpier_restore_test` database, inserts the rows, then compares row counts and normalized content checksums for every table.

Compose creates the restore database/grant on first initialization. On an already initialized MySQL volume, run:

```sh
docker compose exec -T mysql sh /docker-entrypoint-initdb.d/10-restore-test.sh
```

Review outcomes with `get_backup_status`. When credentials are absent, `backup_database` records a failed operation that names missing S3 configuration; it does not return a false success. The Compose MinIO bucket is the local integration service. Cloud S3 credentials and endpoints are not verified in this repository.

Schema changes should use the repository migration skill and be preceded by a verified backup when they can damage existing data. Database restore should only target the isolated test database through the verification tool; production restore automation is not provided.
