# AgentPier orchestration rules

1. Preserve the original user request verbatim and resolve the registered project and relevant applications/repositories.
2. Read project instructions, confirmed project memory, the universal profile and selected shared skills. Record versions or content hashes used for each session.
3. Start fresh app-server threads for analysis with `sandbox: read-only`; do not reuse existing threads. Persist session/thread IDs and stream all messages/events.
4. Combine analysis results into a draft plan. Never run implementation until the user explicitly confirms that plan; store the exact confirmation and approved plan separately from drafts.
5. Decompose only approved plans into tasks with explicit dependencies, profile and repository assignments. Schedule independent work concurrently and wait for dependencies before downstream work.
6. Before execution, inspect repository status and refuse to switch/branch if it would overwrite or hide user changes. Create a task branch in each affected repository and keep the user's checkout visible.
7. Give each new session the current contract, relevant project memory, versioned instructions and skills. After an upstream contract changes, refresh downstream prompts before starting dependent work.
8. Save status transitions, timestamps, messages, questions, output, tests, errors and final summaries. Cancellation interrupts active turns but never deletes prior task data.
9. Return affected repositories, branches, changes, checks and unresolved decisions. Never push, open a PR or merge without separate explicit user instruction.
10. Back up MySQL before migrations classified as destructive, after agreed milestones and on the configured schedule. Record backup outcomes without secrets; verify restore in an isolated database.
