# Domain model

AgentPier uses a single versioned MySQL table for MVP domain records. Each record has a UUID, kind, optional project ID, display name, JSON payload and timestamps. The project link is a logical association in MVP; database-level foreign keys and per-kind relational tables are future schema work.

```text
Project ──< Application ──< Repository
   │             │                │
   ├──< Instruction / Skill        └── local path + remote URL
   ├──< confirmed Context / Memory
   └──< Task ──< Analysis/Result/Decision/Agent session (future)
                         └── approved plan (only after explicit user confirmation)
Agent profiles: Backend developer, Frontend developer
```

Kinds currently accepted: `project`, `app`, `repository`, `task`, `instruction`, `skill`, `memory`, `backup`, `agent-profile`. Manager seeds two profile records on boot. Task records preserve the user's exact request and distinguish `analysis` from `approved`; they do not imply that a Codex session was run.

## Knowledge provenance

Use `source` and `status` fields in memory payloads to distinguish `user_request`, `agent_output`, `draft` and `user_confirmed`. Only an explicit user decision may be marked confirmed. Generic JSON storage does not enforce this convention yet; callers must preserve provenance and avoid turning suggestions into facts.

## Local paths

Register an absolute project path. Application and repository paths must resolve within it; traversal outside the root is rejected. Multiple repository records can be attached to one project. The container does not mount host checkouts: it sends the literal Mac path to app-server, which runs on the Mac and resolves the path there. Session creation is not yet implemented.

## Domain gaps

Current MVP does not yet implement task dependency graphs, profile/session assignment, Git operations, analysis result lifecycle, safe session cancellation, or relational FK enforcement. These records and relationships must be added before describing the full orchestration flow as complete.
