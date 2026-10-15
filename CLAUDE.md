

## Private GitHits usage runtime

Install the private MasterMind `tools/githits-usage` package and invoke its `install.mjs` with an absolute Node 24 executable. Load the two non-secret absolute paths from its ignored `data/environment.json` before starting the agent: `GITHITS_USAGE_NODE` (the executable) and `GITHITS_USAGE_HOME` (the tool directory). The tracked MCP entry invokes that private executable and `mcp.mjs` directly; it requires neither Node on PATH nor a repository-root working directory.

For headless authentication, also set `GITHITS_API_TOKEN` in the environment. Interactive OAuth is handled by the private bridge. Never put a token or usage ledger into this repository. Missing private runtime paths stop the tool; do not restore a direct unaccounted hosted fallback. The product runtime is unchanged.
