# Local MCP setup

AgentPier exposes Streamable HTTP MCP from Manager at:

```text
http://localhost:3100/mcp
```

Register it with Codex CLI:

```sh
codex mcp add agentpier --url http://localhost:3100/mcp
codex mcp list
```

Manager is the MCP endpoint. The static dashboard on port 3101 is read-only and does not proxy MCP requests.

## LLM-directed workflow

The conversational LLM is the orchestrator. It chooses whether analysis is useful, which registered app and specialist profile to use, how to divide a plan, which approved step to dispatch next, and how to interpret results. Manager stores records and starts the exact assignment requested by the LLM; it does not route by task/check words, fan out to all apps, schedule dependency graphs, retry work, or choose parent status.

1. Call `analyze_task` to create a task record. It does not start a session.
2. When specialist input is useful, call `dispatch_orchestration_analysis` for each selected application/profile. It starts a fresh read-only session and returns task/session/thread IDs. `get_analysis_results` exposes persisted session results to the orchestrator.
3. The LLM synthesizes evidence, discusses and publishes a complete plan in chat, and gets explicit user approval. `save_plan` stores a draft; `approve_plan` requires `userConfirmed: true`. Analysis is optional; a plan can be drafted without it.
4. The LLM records its decision to begin with `execute_task`, then dispatches one chosen approved plan step at a time through `dispatch_orchestration_assignment`. Each dispatch starts a fresh workspace-write session and returns immediately with its task/subtask/session context. The LLM decides what to dispatch next and whether another attempt is warranted.
5. `get_task_status` and `get_task_results` expose running and completed work. When a worker turn ends, Manager stores its text and local diff/status evidence on the subtask as `awaiting_outcome`; an errored turn is stored as `blocked`. The LLM evaluates that evidence, writes its assignment assessment with `record_assignment_outcome`, and separately chooses and records parent status with `record_orchestration_task_status`.

Workers receive persisted task/subtask IDs, exact profile and application, repository and absolute working directory, user-selected branch, approved scope, dependency context and checks. They work directly in the assigned application and do not need to call `execute_task` or `get_task_status` for their parent plan. A completed app-server turn is not by itself an LLM decision that the assignment succeeded. `AGENTPIER_RESULT` is useful worker-report formatting; Manager does not parse that marker to infer task status. Tool/session failures and environment limits are recorded for the LLM to assess, and do not erase independently verified local work.

## Orchestration tools

| Tool                                | Required arguments                                        | Behavior                                                                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analyze_task`                      | `projectId`, `request`                                    | Create a task record; no app/profile selection or agent dispatch.                                                                                                                         |
| `dispatch_orchestration_analysis`   | `taskId`, `appId`, `profile`, `workingDirectory`, `focus` | Start one LLM-selected read-only analysis session. Optional: `repositoryId`, `skills`.                                                                                                    |
| `get_analysis_results`              | `taskId`                                                  | Return persisted analysis sessions and their result text. The response includes at most 500 analysis session records; `sessionsTruncated: true` means at least one additional analysis session exists. |
| `save_plan`                         | `taskId`, `plan`                                          | Save/replace the LLM's plan draft.                                                                                                                                                        |
| `approve_plan`                      | `taskId`, `plan`, `userConfirmed: true`                   | Persist the plan after explicit user approval.                                                                                                                                            |
| `execute_task`                      | `taskId`, `decision`                                      | Persist the LLM's decision to begin; does not select or schedule plan steps.                                                                                                              |
| `dispatch_orchestration_assignment` | `taskId`, `stepId`, `dependencies`                        | Start the exact approved step selected by the LLM.                                                                                                                                        |
| `record_assignment_outcome`         | `taskId`, `subtaskId`, `status`, `outcome`, `evidence`    | Persist the LLM's assessment on that assignment only.                                                                                                                                     |
| `record_orchestration_task_status`  | `taskId`, `status`, `decision`                            | Persist the LLM's separate parent-task status and rationale.                                                                                                                              |
| `read_orchestration_task`           | `taskId`                                                  | Read persisted plan, analysis and orchestration decisions.                                                                                                                                |
| `record_orchestration_decision`     | `taskId`, `decision`                                      | Append an LLM decision without starting work.                                                                                                                                             |

`dispatch_orchestration_analysis` requires the LLM to select a registered application, profile, and `workingDirectory` (`application` or `repository`). Its optional `skills` list uses exact names from the selected profile. If omitted, the profile's declared skills are supplied; no task-word matching selects skills or directories.

Each plan step requires `title`, `description`, and an explicit `workingDirectory` (`application` or `repository`). Set `appId` and/or `repositoryId`, `profile`, `targetBranch`, and any LLM-selected `skills`, dependencies, checks and runtime capabilities. Profile instructions describe their repository-relative source directories. The `checks` list is used only as worker verification guidance; Manager never parses it to choose a directory, app, profile, or workflow.

The LLM asks the user for a target branch if none is selected. The exact user answer is passed to the worker. If the branch exists locally or remotely but is not checked out, the worker can select that exact branch while preserving existing work. If the exact branch does not exist, ask before creating it. Never substitute a branch.

Manager performs lightweight input/record validation and records session/outcome evidence. It does not block dispatch because another session may share the checkout; the LLM coordinates overlapping work. Assignment outcomes never infer or update parent status. Failed or incomplete assignments must not be recorded as successful.

## Other MCP tools

| Tool                                                                                             | Purpose                                                                                                                  |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `manager_status`                                                                                 | Check Manager, MySQL, backup storage and app-server connectivity.                                                        |
| `list_projects`, `register_project`, `update_project`, `delete_project`                          | Manage project records. Updating project metadata does not alter checkout files.                                         |
| `manage_applications`                                                                            | List, create or update registered applications and repositories.                                                         |
| `list_agents`, `list_models`, `update_agent_profile`                                             | Inspect specialist profiles and live models; set a profile's default model/reasoning effort.                             |
| `get_project_context`, `update_project_context`                                                  | Read or explicitly update project instructions and confirmed memory.                                                     |
| `get_task_status`, `get_task_results`, `get_agent_messages`, `send_agent_message`, `cancel_task` | Inspect ongoing work, reply to agent questions, or interrupt sessions while retaining records.                           |
| `complete_task_from_evidence`                                                                    | Record checks the user explicitly confirms were completed outside the managed session; it does not choose parent status. |
| `backup_database`, `get_backup_status`                                                           | Create or inspect a MySQL backup and optional isolated restore verification.                                             |

Tool arguments are validated against MCP schemas and domain DTOs; record IDs must be UUIDs and unknown input properties are rejected. Project/application paths are absolute host paths. Never put credentials or secrets in records, prompts, messages, commands, logs or reports.

`executionCapabilities` currently supports `docker`. When the approved step needs the local Docker daemon, the LLM can include that capability; Manager passes the configured local Unix socket to that session's workspace-write sandbox. Remote Docker contexts are unsupported. Ordinary sessions keep network disabled. Release operations require separate explicit typed scope in the approved plan and actual host permissions.

`complete_task_from_evidence` requires `userConfirmed: true`, a task-owned subtask, and non-empty evidence. It updates that subtask only; the LLM chooses the parent status separately. There is no automatic retry, marker reconciliation, or parent completion from worker text.

## Runtime boundary

Manager, MySQL and the dashboard run in Docker Compose. The Codex app-server and repository checkouts run on the Mac host. Manager passes host absolute paths to the app-server; user checkouts are never mounted into the Manager container. Check live availability using `manager_status` and the actual MCP route; do not infer WebSocket or agent execution success from HTTP health alone.

Hosted ChatGPT cannot directly reach a loopback endpoint. A separately configured secure MCP tunnel may forward requests to Manager. AgentPier does not expose a public endpoint or create that tunnel; follow the MCP client’s current connection documentation.

### Model and skill context

`list_agents` exposes profile skills, instruction versions and configured defaults. The LLM selects a profile and optional exact skill names from that profile. Manager does not select skills from task/application keywords. Session records include the chosen profile/model/skills and their hashes. A `dispatch_orchestration_assignment` includes dependency context supplied by the LLM. Manager passes that context through without independently verifying its provenance or truth; the worker cannot recover context by recursively querying its parent task.

### Managed session capabilities

Ordinary managed turns and host `command/exec` keep network access disabled. A plan step may declare typed `releaseOperations` for specifically approved commit, push, PR, review, or merge actions; this metadata does not bypass host authentication or tool permissions. Without such explicit scope, release actions are not authorized. Docker access is separate from release scope and requires the approved `docker` capability.
