# Domain model

The MVP persists records in the MySQL `manager_records` table. Each row has a UUID, a `kind`, an optional `project_id`, an optional display name, JSON `data`, and timestamps. TypeORM migrations create and evolve the table; `synchronize` stays off. Domain associations live in typed JSON payload fields for now rather than relational foreign keys.

```text
Project
├── Applications ── Repository references ── Local Git clones / remotes
├── Project instructions and constraints
├── Confirmed project memory
└── Tasks
    ├── verbatim original request
    ├── Analysis results and agent events
    ├── Draft plan → explicitly approved plan
    └── Subtasks → Codex sessions → messages, branches and results

Global Manager context and versioned instructions/skills
Universal profiles: backend, frontend (more profiles can be added by directory)
Backup journal → S3-compatible object
```

Current record kinds include `project`, `app`, `repository`, `agent-profile`, `instruction`, `skill`, `memory`, `task`, `subtask`, `session`, `agent-message`, `agent-event`, and `backup`. A project may have multiple applications and multiple repositories. An application can refer to its repository through `repositoryId`; the repository stores its local path and optional Git remote URL.

## Provenance and approval

The original request is stored verbatim in the task payload. Analysis output is stored with the originating profile, Codex session/thread IDs, and its lifecycle status. A draft plan is stored separately from the approved plan. Only the MCP approval tool with `userConfirmed: true` can persist an approved plan; execution checks the `approved` state and retained plan before creating subtasks.

Memory records use `source` and `status`. MCP updates default new memory to `source: draft` and `status: draft`. An explicit user decision is required to mark it confirmed. Agent output remains an agent result unless a user separately promotes it. Session records keep hashes of the profile and project-instruction versions used at launch.

## Instruction loading

The source of truth is `agents/<profile>/AGENTS.md`, `skills/`, `orchestrator/instructions.md`, and project instruction records. `AgentProfileService` reads these files on each launch, selects the skills listed in the profile's `skills` comment, and hashes their contents. The orchestrator adds project constraints and confirmed memory to the new session's developer instructions. There are exactly two profile directories at startup: `backend` and `frontend`.

## Local paths and Git

Project, application, and repository records store absolute Mac paths. The Manager validates that paths exist, resolves symlinks, and requires application/repository paths to remain within the registered project root. Docker does not mount the checkout. The Mac app-server resolves the same path passed in `thread/start`, `turn/start`, and `command/exec`.

Analysis uses the app-server read-only sandbox. Execution creates a new branch for each approved step, preserves the checked-out user's files, and serializes steps sharing one repository. Git commands run through the app-server on the host. The Manager reports branch/status/diff; it does not commit or push. Remote clone creation and GitHub MCP operations are not implemented in this local MVP.

## Backup records

A backup journal row records backup type, timestamp, configured bucket, object key, size, checksum, restore verification, retention outcome, and sanitized errors. The backup payload is a consistent logical MySQL snapshot compressed with gzip. The isolated restore database is verified table by table after download.

## Schema boundary

The generic record table is an MVP storage choice, not a claim of relational FK enforcement. Before adding new entity tables or columns, create and verify a TypeORM migration with `skills/manage-typeorm-migration/SKILL.md`. Back up data before manually applying destructive schema changes.
