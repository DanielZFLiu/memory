# MCP Server

Use Memory as a standalone Model Context Protocol server over stdio.

## Start from a local clone

```bash
npm install
npm run build
node ./dist/main.js
```

Memory MCP communicates over stdio, so it does not open an HTTP port.

## Run via `npx`

In an MCP client configuration, you can run the published package directly:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@danielzfliu/memory"]
    }
  }
}
```

If you are running from a local clone instead:

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["c:/path/to/memory/dist/main.js"]
    }
  }
}
```

## Available tools

| Tool | Description |
|------|-------------|
| `add_piece` | Add a new piece with optional title, tags, and collection |
| `get_piece` | Retrieve a piece by id |
| `update_piece` | Update piece content, title, and/or tags; `title: null` clears the title |
| `delete_piece` | Delete a piece by id |
| `query_pieces` | Semantic search over stored pieces; supports optional hybrid search |
| `rag_query` | Retrieve relevant pieces and generate a grounded answer with citations |
| `list_collections` | List all collection names in the memory store |
| `delete_collection` | Delete an entire collection and all its pieces |

All piece-level tools accept an optional `collection` parameter to target a specific collection instead of the default collection.

There is no separate `create_collection` MCP tool. Collections are created implicitly the first time an agent writes to a new collection.

## Configuration

The MCP server uses the same runtime configuration as the library and REST API. See [Configuration](./configuration.md).
