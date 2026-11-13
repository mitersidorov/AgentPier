# Domain model

The MVP persists records in the MySQL `manager_records` table. Each row has a UUID, a `kind`, an optional `project_id`, an optional display name, JSON `data`, and timestamps. TypeORM migrations create and evolve the table; `synchronize` stays off. Domain associations live in typed JSON payload fields for now rather than relational foreign keys.

```text
Project
├── Applications ── Repository references ── Local Git clones / remotes
├── Versioned project instruction records (architecture, stack, application)
├── Confirmed project memory
└── Tasks
    ├── verbatim original request
    ├── Analysis results and agent events
    ├── Draft plan → explicitly approved plan
    └── Subtasks → Codex sessions → messages, branches and results

Stack profiles and their versioned instructions/skills
├── Backend NestJS
└── Frontend Angular (more profiles can be added by directory)
Backup journal → compressed object in the configured S3-compatible bucket
```

Current record kinds include `project`, `app`, `repository`, `agent-profile`, `instruction`, `skill`, `memory`, `task`, `subtask`, `session`, `agent-message`, `agent-event`, and `backup`. A project may have multiple applications and multiple repositories. An application can refer to its repository through `repositoryId`; the repository stores its local path and optional Git remote URL.

## Provenance and approval

The original request is stored verbatim in the task payload. Analysis output is stored with the originating profile, Codex session/thread IDs, and its lifecycle status. A draft plan is stored separately from the approved plan. Only the MCP approval tool with `userConfirmed: true` can persist an approved plan; execution checks the `approved` state and retained plan before creating subtasks.

Project instructions are separate `instruction` records, classified as `architecture`, `stack`, or `application`. MCP creates them as drafts unless the user explicitly confirms them; confirmed records carry `source: user_confirmed`, `confirmedAt`, a monotonic content `version`, and a SHA-256 `contentHash`. Only confirmed instructions are injected into analysis and execution prompts. Editing content without re-confirming returns it to draft. Legacy `project.instructions` and `project.constraints` metadata remain backward-compatible data but are not injected as project instructions. Memory records use `source` and `status`; MCP defaults new memory to draft and requires explicit user confirmation to mark it confirmed. Agent output remains an agent result unless a user separately promotes it. Session records keep project instruction versions and hashes used at launch.

## Instruction loading

The source of truth is `agents/<profile>/AGENTS.md`, the profile's `agents/<profile>/skills/<skill>/SKILL.md` files, `orchestrator/instructions.md`, and project instruction records. `AgentProfileService` reads the selected profile and its declared nested skills on each launch, then hashes their contents. The orchestrator adds project constraints and confirmed memory to the new session's developer instructions. The two initial profile directories are `backend-nestjs` and `frontend-angular`; each profile is reusable across projects with the corresponding stack. New profiles are discovered from their own directory without Manager business-logic changes.

## Local paths and Git

Project, application, and repository records store absolute Mac paths. The Manager validates that paths exist, resolves symlinks, and requires application/repository paths to remain within the registered project root. Docker does not mount the checkout. The Mac app-server resolves the same path passed in `thread/start`, `turn/start`, and `command/exec`.

Analysis uses the app-server read-only sandbox. Each executable approved step must name the user's target branch. Execution only runs when that branch is already checked out; Manager never infers, creates, or switches branches. It preserves checked-out files and serializes steps sharing one repository. Git commands run through the app-server on the host. The Manager reports branch/status/diff; it does not commit or push. Remote clone creation and GitHub MCP operations are not implemented in this local MVP.

## Backup records

A backup journal row records backup type, timestamp, bucket key, size, checksum, restore verification, retention outcome, and sanitized errors. The backup payload is a consistent logical MySQL snapshot compressed with gzip. The isolated restore database is verified table by table after downloading and validating the object.

## Schema boundary

The generic record table is an MVP storage choice, not a claim of relational FK enforcement. Before adding new entity tables or columns, use the NestJS profile's `agents/backend-nestjs/skills/manage-typeorm-migration/SKILL.md` when the target application uses TypeORM. Back up data before manually applying destructive schema changes.
