# Architecture and local integration

## C4 Context

```mermaid
 C4Context
  title AgentPier system context
  Person(user, "User", "Reviews and approves plans and local changes")
  System(manager, "AgentPier Manager", "Local project, memory and workflow manager")
  System_Ext(chatgpt, "ChatGPT / Codex", "Discusses requests and calls local MCP")
  System_Ext(appserver, "Codex app-server on Mac", "Creates local Codex sessions (integration pending)")
  System_Ext(git, "Git and GitHub", "Local repositories; remote operations require separate approval")
  System_Ext(s3, "S3-compatible storage", "MinIO in local Compose; backup lifecycle pending")
  Rel(user, manager, "Uses dashboard and IDE")
  Rel(chatgpt, manager, "Streamable HTTP MCP")
  Rel(manager, appserver, "WebSocket handshake at host.docker.internal:4500")
  Rel(manager, git, "Local Git operations (not yet implemented)")
  Rel(manager, s3, "S3 backup/restore (not yet implemented)")
```

## C4 Container

```mermaid
 C4Container
  title AgentPier containers
  Person(user, "User")
  System_Ext(client, "ChatGPT / MCP client")
  System_Ext(host, "Mac host", "Codex app-server and checked-out projects")
  System_Boundary(ap, "Docker Compose") {
    Container(manager, "Manager", "NestJS 11 / Node 22", "API, local dashboard, MCP JSON-RPC endpoint")
    ContainerDb(mysql, "MySQL", "MySQL 8.4", "Persistent project/task records")
    Container(minio, "MinIO", "S3-compatible", "Local object storage; backup client pending")
  }
  Rel(user, manager, "Browser HTTP")
  Rel(client, manager, "HTTP /mcp")
  Rel(manager, mysql, "TypeORM and migrations")
  Rel(manager, minio, "S3-compatible configuration; no backup workflow yet")
  Rel(manager, host, "WebSocket reachability check to :4500")
```

## Readiness and WebSocket diagnosis

Manager requests `http://host.docker.internal:4500/readyz` and `/healthz`, then opens a genuine WebSocket handshake to `ws://host.docker.internal:4500`. HTTP success alone is not reported as a WebSocket connection. `/api/status` and the MCP `manager_status` tool return the handshake result and failure reason. If unavailable, start the app-server on the Mac and verify it listens on port 4500 and that Docker can reach it. Session protocol negotiation and thread/turn operations are not implemented yet.

The running session's `cwd` must be the absolute Mac path stored in the project/app record. Manager currently does not launch sessions, so the actual path mapping remains unverified. The app-server process on the host, not a Docker volume, provides host filesystem access.
