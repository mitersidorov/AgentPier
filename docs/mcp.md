# Local MCP setup

AgentPier exposes Streamable HTTP MCP through its NestJS service at:

```text
http://localhost:3100/mcp
```

In Codex CLI, register the local endpoint with:

```sh
codex mcp add agentpier --url http://localhost:3100/mcp
codex mcp list
```

The exact registration was checked against the installed Codex CLI's `codex mcp add --help`. This registration targets local Codex clients on the Mac, not hosted ChatGPT.

## Tools

| Tool | Required inputs | Effect |
|---|---|---|
| `manager_status` | none | MySQL, Manager and live app-server status |
| `list_projects` | none | List projects |
| `register_project` | `name`, absolute Mac `path` | Create project |
| `update_project` | `projectId`, `data` | Update project metadata |
| `manage_applications` | `action`, `projectId`; `kind`, `data` for register; `recordId`, `data` for update | List or manage apps and repositories |
| `list_agents` | none | Read available profiles and instruction hashes |
| `get_project_context` | `projectId` | Read apps, project instructions and confirmed memory |
| `update_project_context` | `projectId`, `kind`, `data`; optional `recordId`, `userConfirmed` | Update project instructions or memory with provenance |
| `analyze_task` | `projectId`, verbatim `request` | Start new read-only Codex threads for registered apps |
| `get_analysis_results` | `taskId` | Read report, session IDs, messages and status |
| `save_plan` | `taskId`, `plan` | Save or revise a draft after analysis completes |
| `approve_plan` | `taskId`, final `plan`, `userConfirmed: true` | Persist user-approved plan |
| `execute_task` | `taskId` | Start approved dependency steps and local Git branches |
| `get_task_status` | `taskId` | Task, subtask, thread and reconnect state |
| `get_agent_messages` | `taskId` | Read agent messages and questions |
| `send_agent_message` | `taskId`, `sessionId`, and either `message` or question/answers | Reply or provide direction |
| `cancel_task` | `taskId` | Interrupt active work and preserve records |
| `get_task_results` | `taskId` | Results, branches and local diff/status summaries |
| `backup_database` | optional `verifyRestore` | Create S3 backup and optionally restore/verify in test DB |
| `get_backup_status` | none | Read backup journal |

Tools return JSON in an MCP text block. Tool failures return `isError: true` with a concrete explanation. No MCP authentication is required for the local-only loopback listener; do not expose the port to a network.

## ChatGPT limitation

The local endpoint is not directly reachable from hosted ChatGPT. OpenAI's current ChatGPT custom MCP documentation says ChatGPT connects to remote MCP servers; developer-machine servers need Secure MCP Tunnel. [OpenAI's connection guide](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) instructs users to provide a public HTTPS MCP endpoint or select a supported tunnel and its `tunnel_id` in the custom MCP connection setup. AgentPier does not create a tunnel or expose a public endpoint. The exact endpoint available through that UI is supplied by the user's Secure MCP Tunnel; it cannot be known from this local checkout. A ChatGPT live connection was therefore not claimed or tested.
