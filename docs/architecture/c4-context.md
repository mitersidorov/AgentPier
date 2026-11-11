# C4 Context

```mermaid
C4Context
  title AgentPier local workflow context
  Person(user, "User", "Discusses the request, approves a plan, and reviews local changes")
  System(manager, "AgentPier Manager", "Stores project memory and coordinates Codex sessions")
  System_Ext(chatgpt, "ChatGPT / Codex client", "Discusses requests and calls Manager MCP")
  System_Ext(appserver, "Codex app-server on Mac", "Runs fresh local analysis and implementation threads")
  System_Ext(git, "Git and GitHub", "Git manages local clones and branches; remote GitHub actions require separate approval")
  System_Ext(s3, "S3-compatible storage", "Stores compressed, checksummed MySQL backups")
  Rel(user, manager, "Uses local dashboard and MCP client")
  Rel(chatgpt, manager, "Streamable HTTP MCP; ChatGPT needs a supported Secure MCP Tunnel to reach localhost")
  Rel(manager, appserver, "WebSocket JSON-RPC over host.docker.internal:4500")
  Rel(manager, git, "Runs local Git commands through app-server on the Mac")
  Rel(manager, s3, "Uploads, lists, downloads backups and enforces retention")
```

AgentPier remains local. ChatGPT's hosted custom MCP connection cannot connect directly to a loopback endpoint; see [MCP setup](../mcp.md) for the separately required tunnel condition.
