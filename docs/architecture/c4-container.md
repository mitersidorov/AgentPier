# C4 Container

```mermaid
C4Container
  title AgentPier local deployment
  Person(user, "User", "Uses browser, terminal and IDE")
  System_Ext(client, "ChatGPT / Codex MCP client", "MCP tools for the workflow")
  System_Ext(host, "Mac host", "Codex CLI/app-server and local Git checkouts")
  System_Boundary(compose, "Docker Compose on Mac") {
    Container(manager, "Manager", "NestJS / Node 22", "REST API, local UI, Streamable HTTP MCP, orchestration and backup jobs")
    ContainerDb(mysql, "MySQL", "MySQL 8.4", "Persistent project, memory, plan, session, task and backup records")
    Container(minio, "MinIO", "S3-compatible API", "Local backup objects for development and restore testing")
    Container(bucket, "Bucket initializer", "AWS CLI", "Creates the configured local bucket")
  }
  Rel(user, manager, "HTTP :3100")
  Rel(client, manager, "POST /mcp; hosted ChatGPT requires Secure MCP Tunnel")
  Rel(manager, mysql, "TypeORM; migrations; logical consistent snapshots")
  Rel(manager, minio, "S3 put/list/get/delete")
  Rel(bucket, minio, "Create bucket")
  Rel(manager, host, "WebSocket JSON-RPC and local Git commands")
  Rel(host, manager, "Exposes app-server :4500 and host filesystem paths")
```

Manager does not contain Codex CLI, mount project directories, or start a host agent. The app-server on the Mac resolves the absolute paths it receives from registered project/application records. HTTP readiness and health probes supplement a real WebSocket `initialize` request; only the latter proves a control connection.
