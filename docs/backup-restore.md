# S3-compatible database backups

Manager writes scheduled and requested MySQL snapshots to the configured remote S3 bucket. For AWS S3, provide access key, secret, region, and bucket; leave `S3_ENDPOINT` empty so the AWS SDK uses the regional endpoint. For another remote S3-compatible provider, set its endpoint, credentials, region, bucket, path-style setting, and optional prefix in `.env`. Manager does not store backup objects in a local MinIO service.

Each backup operation:

1. Opens a repeatable-read MySQL transaction and captures table definitions and rows.
2. Encodes binary/date values, serializes and gzips the snapshot, then computes SHA-256.
3. Uploads the compressed snapshot to the configured bucket with the checksum as object metadata.
4. Saves an operation record with status, timing, object key, size, checksum, and sanitized errors.
5. Keeps the newest `BACKUP_RETENTION_COUNT` objects (5 by default) and deletes older ones.

For a full round trip, call MCP `backup_database` with `verifyRestore: true`. Manager downloads the uploaded object, validates SHA-256, restores it into the isolated `agentpier_restore_test` database, then compares row counts and normalized content checksums for every table.

Compose creates the isolated restore database and grants access on first initialization. On an already initialized MySQL volume, run:

```sh
docker compose exec -T mysql sh /docker-entrypoint-initdb.d/10-restore-test.sh
```

Review outcomes with `get_backup_status`. Set `BACKUP_SCHEDULE`, `BACKUP_RETENTION_COUNT`, `RESTORE_TEST_DB`, and S3 settings in `.env`. The dashboard and MCP `manager_status` show whether the configured bucket is reachable without exposing credentials. An HTTP 403 from `HeadBucket` means the bucket name or access policy needs checking; grant the backup credentials bucket listing and object read/write/delete permissions.

Schema changes should use the repository migration skill and be preceded by a verified backup when they can damage existing data. Verification restores only into the isolated test database; production restore automation is not provided.
