# Local MCP setup

AgentPier exposes Streamable HTTP MCP directly from the Manager container at:

```text
http://localhost:3100/mcp
```

In Codex CLI, register the local endpoint with:

```sh
codex mcp add agentpier --url http://localhost:3100/mcp
codex mcp list
```

The exact registration was checked against the installed Codex CLI's `codex mcp add --help`. This connects directly to Manager on the Mac. The dashboard runs on port 3101 and is not in this path.

## Tools

| Tool                     | Required inputs                                                                   | Effect                                                                      |
| ------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `manager_status`         | none                                                                              | MySQL, Manager and live app-server status                                   |
| `list_projects`          | none                                                                              | List projects                                                               |
| `register_project`       | `name`, absolute Mac `path`                                                       | Create project                                                              |
| `update_project`         | `projectId`, `data`                                                               | Update project metadata                                                     |
| `delete_project`         | `projectId`                                                                       | Wait for confirmed turn termination, then delete project records; keeps checkout files     |
| `manage_applications`    | `action`, `projectId`; `kind`, `data` for register; `recordId`, `data` for update | List or manage apps and repositories                                        |
| `list_agents`            | none                                                                              | Read available profiles, instruction hashes, and persisted default models   |
| `list_models`            | none                                                                              | Read the live Codex app-server model catalog                                |
| `update_agent_profile`   | `role`, optional `model` / `defaultReasoningEffort`                                                                    | Set a built-in profile model and/or supported effort               |
| `get_project_context`    | `projectId`                                                                       | Read apps, project instructions and confirmed memory                        |
| `update_project_context` | `projectId`, `kind`, `data`; optional `recordId`, `userConfirmed`                 | Update project instructions or memory with provenance                       |
| `analyze_task`           | `projectId`, verbatim `request`                                                   | Start new read-only Codex threads for registered apps                       |
| `get_analysis_results`   | `taskId`                                                                          | Read report, session IDs, messages and status                               |
| `save_plan`              | `taskId`, `plan`                                                                  | Save or revise a draft after analysis completes                             |
| `approve_plan`           | `taskId`, final `plan`, `userConfirmed: true`                                     | Persist user-approved plan                                                  |
| `execute_task`           | `taskId`                                                                          | Start approved steps on already-checked-out user-selected branches; never creates or switches branches |
| `get_task_status`        | `taskId`                                                                          | Task, subtask, thread and reconnect state                                   |
| `get_agent_messages`     | `taskId`                                                                          | Read agent messages and questions                                           |
| `send_agent_message`     | `taskId`, `sessionId`, and either `message` or question/answers                   | Reply or provide direction                                                  |
| `cancel_task`            | `taskId`                                                                          | Interrupt active work and preserve records                                  |
| `get_task_results`       | `taskId`                                                                          | Results, branches and local diff/status summaries                           |
| `backup_database`        | optional `verifyRestore`                                                          | Create an S3-compatible backup and optionally restore/verify in the test DB |
| `get_backup_status`      | none                                                                              | Read backup journal                                                         |

Tools return JSON in an MCP text block. Tool failures return `isError: true` with a concrete explanation. No MCP authentication is required for the local-only loopback listener; do not expose the port to a network.

### Input shapes

Tool arguments are validated against the MCP schemas and domain DTOs. Unknown properties are rejected, record IDs must be UUIDs, and nested objects are validated recursively.

- `update_project.data` accepts only `name`, `path`, `description`, `instructions`, and `constraints`.
- `manage_applications` list accepts only `action` and `projectId`. Register requires `kind` and `data` with a non-empty `name` and absolute `path`. For `kind: "app"`, data supports `name`, `purpose`, `description`, `path`, and `repositoryId`; for `kind: "repository"`, it supports `name`, `description`, `path`, and `remoteUrl`. Update requires `recordId` and a non-empty `data` object; when `kind` is supplied, the schema restricts data to that record type.
- `delete_project` requires a project UUID. Before starting the deletion transaction, Manager checks active analysis/execution tasks and running/waiting-for-user sessions, including detached sessions. It requests interruption of in-progress turns and polls Codex `thread/read` until each turn is confirmed `completed` or `interrupted` (up to 60 seconds per turn); an interrupt acknowledgement alone is insufficient. Locally cancelled/failed sessions with turn IDs are also verified because local status is not proof of external termination. Missing turn/session identifiers, failed or unknown external state, transport/interruption errors, or timeout abort the cascade: no project-owned records are deleted. Active tasks may remain marked cancelled to stop dependent scheduling, and normal lifecycle events may update retained history. Resolve the external work/state before retrying. Inactive projects with completed sessions need no app-server connection. This does not add database race guards or locks; concurrent new work is not serialized with deletion. After successful verification, it transactionally removes the project and all records whose `projectId` belongs to it, including task history; it never removes files from the local checkout or agent profiles.
- `update_project_context.data` supports `name`, `title`, `category` (`architecture`, `stack`, or `application`), `content`, `instructions`, `description`, `rationale`, `source`, `status`, `constraints`, `decisions`, and `acceptanceCriteria`.
- Use `kind: instruction` for project architecture/stack/application guidance. Confirm it with `userConfirmed: true`; confirmed records include provenance, a content version and a SHA-256 hash. Drafts are not injected into managed prompts; changing confirmed content requires reconfirmation.
- Plan objects require a non-empty `steps` array. Each step requires `title` and `description`; optional fields are `id`, `profile`, `appId`, `repositoryId`, `targetBranch`, `dependsOn`, and `checks`. Before approving, every executable step must have a user-selected `targetBranch`. If the user has not named one, ask and wait; never infer, create, or switch branches automatically. Execution proceeds only when the named branch is already checked out. Plans can also store `summary`, `decisions`, `constraints`, and `acceptanceCriteria`.
- `list_models` reads models directly from app-server `model/list`; `update_agent_profile` accepts only a model ID returned by that live catalog. `list_agents` and `GET /dashboard/agents` include each profile’s persisted `defaultModel`.
- `approve_plan` requires `userConfirmed: true`. `send_agent_message` accepts either a non-empty `message` or a `questionMessageId` with a non-empty map of text answers.

## ChatGPT limitation

Dashboard traffic uses the separate read-only presentation container on `localhost:3101`. MCP traffic goes directly to Manager at `localhost:3100/mcp`; the dashboard does not proxy MCP requests. If a supported secure tunnel is configured separately, it forwards ChatGPT requests directly to Manager port 3100.

The local endpoint is not directly reachable from hosted ChatGPT. OpenAI's current ChatGPT custom MCP documentation says ChatGPT connects to remote MCP servers; developer-machine servers need Secure MCP Tunnel. [OpenAI's connection guide](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) describes the supported connection options. AgentPier does not create a tunnel or expose a public endpoint. The exact endpoint available to the client is supplied by the user's tunnel and cannot be known from this local checkout. Follow the client's current UI instructions; AgentPier does not claim a GUI flow that has not been verified. A ChatGPT live connection was not claimed or tested.

## Runtime boundary

The MCP client calls Manager directly (or through a separately configured tunnel). Manager runs in Docker Compose and communicates with the Mac-hosted Codex app-server over WebSocket; the app-server resolves registered absolute Mac paths and operates on host checkouts/Git. The dashboard is a separate read-only view and is not an MCP proxy. Live app-server model-listing/session-start and browser/CUA GUI checks have not been completed in the current environment because of sandbox/tool connectivity limits; no successful WebStorm launch is claimed.

### Profile reasoning and task context

`update_agent_profile` accepts `role` and at least one of `model` or `defaultReasoningEffort`.
Model-only clients remain supported. Existing profiles default to `medium`; both model and effort are validated against the live `list_models` catalog (`supportedReasoningEfforts`). Unsupported pairs fail before starting work, without silently selecting another effort. `list_agents` and the read-only dashboard expose `defaultReasoningEffort`.

Analysis, execution and continued user turns pass the pinned model and `effort` through `turn/start`; `thread/start` does not receive an effort parameter. Session evidence includes `effectiveModel`, `effectiveReasoningEffort`, and `selectedSkills` (paths and SHA-256 hashes). Effective values record the accepted turn overrides, not an independent provider attestation.

Skills are selected by phase, task and application from the profile catalog. Angular/SSR guidance is conditional and excluded for static dashboards. Custom skills require their exact name in the task/application contract. Execution receives only declared `dependsOn` results as JSON contracts with `stepId`, `status`, a redacted summary capped at 4,000 characters, and a truncation flag; full results remain in task records.


### Managed session network policy

Ordinary managed `turn/start` and host `command/exec` requests keep network disabled.
An optional, non-empty `steps[].releaseOperations` array is persisted with the approved plan:
- `{ "type": "commit", "paths": ["relative/file.ts"] }`
- `{ "type": "push", "remote": "origin", "ref": "feature/work" }`
- `{ "type": "pr", "head": "owner/repo:feature/work", "base": "owner/repo:main", "action": "create" }` (`create` or `update`)
- `{ "type": "review", "pr": "https://github.com/owner/repo/pull/1", "action": "approve" }` (`comment`, `approve`, `request-changes`)
- `{ "type": "merge", "pr": "https://github.com/owner/repo/pull/1", "method": "squash" }` (`merge`, `squash`, `rebase`)

Scope belongs to the step's registered repository and selected `targetBranch`. Unknown operations,
missing targets, extra fields, null and empty scopes are rejected. Only explicitly approved typed
scope replaces the no-publish handoff and enables release turn/explicitly scoped host command
network access and the host-resolved Git directory writable root. Ordinary sessions are not broadened.
External/shared Git directories are unsupported and fail closed. Approval policy remains `never`.
No automated GitHub client or command-level operation enforcement is introduced. Continued turns
inherit the accepted policy; messages cannot add scope. Requested permissions are not proof of
host capability. Real MCP/WebSocket verification remains required before claiming live results.
