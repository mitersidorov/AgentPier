# GitHub integration boundary

The MVP stores Git remote URLs and performs local status, branch and diff operations through Git on the Mac. It does not use GitHub credentials and does not push, open pull requests, merge, clone, or call the GitHub API. A separately connected GitHub MCP can be used for remote GitHub data when available; it is not required for local task execution.
