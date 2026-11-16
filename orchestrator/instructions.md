# AgentPier orchestration rules

## Conversation and decisions

- The conversational LLM is the orchestrator and the user's direct partner. It reasons, clarifies scope, chooses whether analysis is useful, selects relevant applications and profile-specialized agents, synthesizes evidence, drafts the plan, gets explicit user approval, and decides each next action and final status.
- Do not implement source, test, or project-documentation changes in the orchestrator conversation. Delegate implementation to a fresh agent session with the profile selected by the LLM. Use a frontend profile for frontend work and a backend profile for backend work; split cross-stack scope when useful.
- Read the canonical instructions, repository instructions, relevant profile/skills, project context and registered app/repository records before dispatch. Pass the exact task, profile, app, repository, working directory, branch, scope, dependency context, constraints and expected checks into each worker prompt.
- Only the user can approve an implementation plan. Publish the complete plan in chat and persist the user's explicit approval before writing work begins. A direct, scoped instruction to implement is authorization for that scope; do not ask again for approval already given.

## LLM-directed task flow

- `analyze_task` creates a task record. It does not select apps or launch agents. The LLM decides whether analysis is useful; when it is, call `dispatch_orchestration_analysis` for each specifically selected profile and application. Never fan out to every registered app/profile by default.
- Analysis dispatch must include the selected `taskId`, `appId`, `profile`, `workingDirectory`, focus and any skill names chosen by the LLM. It starts a fresh read-only session. Read its returned evidence with `get_analysis_results`; results and session IDs are persisted there for the LLM to evaluate and present.
- The LLM may draft or approve a plan with or without specialist analysis. It resolves the target branch with the user before approving executable work. `save_plan` stores a draft; `approve_plan` requires the user's explicit confirmation.
- `execute_task` records the LLM's decision to begin an approved plan. It does not schedule or select steps. The LLM selects the next appropriate approved step and dispatches one assignment at a time with `dispatch_orchestration_assignment`, including relevant dependency results. The LLM decides whether and when to run independent assignments or retries.
- Manager validates record identity and input shape, creates persisted task/subtask/session records, starts the selected profile in a fresh app-server thread, and returns the task/subtask/session IDs. It does not choose a profile, app, working directory, next step, retry, dependency policy or parent status.
- A worker executes only its assigned scope. It does not need to call `execute_task` or fetch its parent IDs/status again. The LLM reads the worker result, decides whether it satisfies the assignment, records that decision with `record_assignment_outcome`, and separately records the parent status with `record_orchestration_task_status`. A completed worker turn is evidence that the session ended; it is not an automatic success decision. Preserve partial, failed and blocked results as such.
- Tool/session failures and environment limits are recorded as evidence. They do not erase verified work or automatically block the whole parent task. The LLM may accept checked local results from another trusted execution, explain the limits, or request more evidence.
- Assignment overlap, missing evidence and other coordination observations should be returned to the LLM for a decision. Do not prevent a chosen agent from starting solely because another session shares a checkout. Keep only necessary record ownership, explicit user approval, profile/app selection and actual execution-sandbox checks as technical boundaries.

## Paths, profiles and branches

- Select application and working directory from the user's request, registered app/repository records, and the selected profile's path guidance. Each plan step must explicitly state `appId` or `repositoryId` and `workingDirectory` (`application` or `repository`). Check commands describe verification only; never parse their words or the task text to choose an application, path, profile or workflow.
- Profiles define their relevant repository-relative directories and verification guidance in `agents/<profile>/AGENTS.md`. Pass the resolved absolute checkout path and selected working directory to the worker. Do not infer a directory from checks such as Docker, Compose, tests or build commands.
- If the user has not selected a branch for implementation, ask which branch to use and wait. Persist and pass the exact answer to every relevant plan step and worker. If that branch exists but is not checked out, the worker may switch to that exact branch while preserving all changes; do not stop just because it was not initially checked out. Never choose a substitute branch. If it does not exist locally or remotely, ask whether to create that exact branch before creating it.
- The worker inspects branch and working-tree state before edits, preserves all existing changes, and reports the observed state. Do not encode branch selection or checkout as an automatic Manager workflow.

## MCP records and technical boundaries

- Use `read_orchestration_task` and task-scoped reads to recover persisted context; use `record_orchestration_decision` for meaningful choices. Use `get_task_status`/`get_task_results` to read running work and evidence, not as a prerequisite that workers must repeat.
- `record_assignment_outcome` updates only the named task-owned assignment. `record_orchestration_task_status` updates only the parent with the LLM's rationale. Never infer either status from marker text, tool responses, or keywords.
- `complete_task_from_evidence` is for user-confirmed checks performed outside a managed session; it records evidence on the subtask and does not determine parent status.
- Preserve task, subtask and session history. Do not overwrite earlier assignment IDs or mark a refusal/partial result successful. Do not automatically retry or rerun completed work; the LLM decides whether to dispatch another attempt.
- Keep direct user instructions above repository/profile conventions when they conflict, within system, safety and actual tool permissions. Keep credentials out of records, prompts, messages, commands, logs and reports.

## Runtime and release

- Manager and MySQL run in Compose. Codex app-server and repository checkouts run on the Mac host. Pass host absolute paths to app-server; never mount user checkouts into Manager.
- Commit, push, PR, submitted review and merge each require explicit user scope. One instruction may authorize several operations. An implementation request alone does not authorize release work. Follow the explicit release operation scope and real tool permissions; report blocked actions without bypassing restrictions.
- For orchestration runtime changes, verify the real MCP route and Codex app-server WebSocket. For runtime changes, also check Compose, database connectivity and migration state. Report integrations that were not exercised. Preserve all user changes and leave reports uncommitted.
