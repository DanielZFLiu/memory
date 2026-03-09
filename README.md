[![npm version](https://img.shields.io/npm/v/@danielzfliu/memory.svg)](https://www.npmjs.com/package/@danielzfliu/memory)

# Memory

A fully local MCP server and Node.js library for storing, semantically searching, and querying tagged/titled text with ChromaDB (vector storage) and Ollama (embeddings and generation).

Three ways to use Memory:

- MCP Server — Run Memory as a Model Context Protocol server over stdio and expose memory tools to MCP-compatible clients.
- npm Package — Install `@danielzfliu/memory` in your own project and use the classes directly (store, embeddings, RAG, and MCP server class).
- REST API Server — Run the standalone HTTP server with CRUD, semantic search, and RAG endpoints.

---

## Prerequisites

- **Node.js** ≥ 18
- **Ollama** running locally
- **ChromaDB** server running locally

### Setting up Ollama

Install Ollama ([install](https://ollama.com)) and pull the default models:

```bash
ollama pull nomic-embed-text-v2-moe:latest
ollama pull gemma3:latest
```

Then run:
```bash
npm run ollama                     # start Ollama on default port 11434
npm run ollama:port -- 11435       # start Ollama on a custom port
```

### Setting up ChromaDB

**Option 1: Docker**

The repo includes a Docker Compose file that runs ChromaDB and stores its data in `./chroma/`.

```bash
npm run docker:up       # start ChromaDB on port 8000
npm run docker:logs     # view logs
npm run docker:down     # stop ChromaDB
```

**Option 2: pip**

```bash
pip install chromadb
chroma run --port 8000  # start ChromaDB on port 8000
```

Note: You may need to add Python's Scripts folder to your PATH after installing.

---

## Option A: MCP Server

Use this option to run Memory as a standalone MCP server.

### 1. Setup

```bash
git clone https://github.com/DanielZFLiu/memory.git
cd memory
npm install
```

### 2. Build and run the MCP server

```bash
npm run build
node ./dist/main.js
```

Memory MCP communicates over stdio, so it does not bind an HTTP port.

### MCP Client Configuration

#### Claude Desktop (example)

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

If you are running from a local clone instead of npm:

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

### MCP Tools

| Tool | Description |
|------|-------------|
| `add_piece` | Add a new piece with optional title and tags |
| `get_piece` | Retrieve a piece by id |
| `update_piece` | Update piece content, title, and/or tags (`title: null` clears title) |
| `delete_piece` | Delete a piece by id |
| `query_pieces` | Semantic search over content, plus title when present. Supports hybrid search (vector + keyword via RRF). |
| `rag_query` | Retrieve + generate answer with citations using content and title context. Supports hybrid search. |
| `list_collections` | List all collection names in the memory store |
| `delete_collection` | Delete an entire collection and all its pieces |

All piece-level tools accept an optional `collection` parameter to target a specific collection instead of the default. This allows multiple agents to use isolated memory stores.

---

## Option B: npm Package

Use this option to integrate Memory into your own Node.js/TypeScript project.

### 1. Install

```bash
npm install @danielzfliu/memory
```

### 2. Programmatic usage

#### Using PieceStore and RagPipeline directly

```typescript
import { PieceStore, RagPipeline, MemoryConfig } from "@danielzfliu/memory";

async function main() {
    const config: MemoryConfig = {
        chromaUrl: "http://localhost:8000",
        ollamaUrl: "http://localhost:11434",
        embeddingModel: "nomic-embed-text-v2-moe:latest",
    };

    // Store: CRUD + semantic search
    const store = new PieceStore(config);
    await store.init();

    await store.addPiece(
        "TypeScript is a typed superset of JavaScript.",
        ["typescript", "programming"],
        "TypeScript overview",
    );
    await store.addPiece("Python is great for data science.", [
        "python",
        "data-science",
    ]);

    const results = await store.queryPieces("typed languages", { topK: 5 });
    console.log("results", results);

    const filtered = await store.queryPieces("typed languages", {
        tags: ["typescript"],
        topK: 5,
    });
    console.log("filtered", filtered);

    // Hybrid search: combines vector similarity with keyword matching via RRF
    const hybrid = await store.queryPieces("typed languages", {
        topK: 5,
        useHybridSearch: true,
    });
    console.log("hybrid", hybrid);

    // RAG: retrieve relevant pieces → generate an answer via Ollama
    const rag = new RagPipeline(store, config.ollamaUrl!, "gemma3:latest");
    const answer = await rag.query("What is TypeScript?", {
        tags: ["programming"],
    });
    console.log("answer", answer);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
```

#### Embedding the REST API in your own Express app

`createServer` returns a configured Express app you can mount or extend:

```typescript
import { createServer } from "@danielzfliu/memory";

const app = createServer({
    chromaUrl: "http://localhost:8000",
    ollamaUrl: "http://localhost:11434",
});

app.listen(4000, () => console.log("Running on :4000"));
```

---

## Option C: REST API Server

Use this option to run Memory as a standalone HTTP service.

### 1. Setup

```bash
git clone https://github.com/DanielZFLiu/memory.git
cd memory
npm install
```

### 2. Start the REST server

```bash
npm run dev:http
```

Server starts on `http://localhost:3000` by default (set `PORT` env var to change).

### API Endpoints

#### Add a piece
```bash
curl -X POST http://localhost:3000/pieces \
  -H "Content-Type: application/json" \
  -d '{"title": "TypeScript overview", "content": "TypeScript is a typed superset of JavaScript.", "tags": ["typescript", "programming"]}'
```

With a specific collection:
```bash
curl -X POST http://localhost:3000/pieces \
  -H "Content-Type: application/json" \
  -d '{"content": "Agent-specific memory.", "tags": ["agent"], "collection": "agent-alice"}'
```

#### Get a piece by ID
```bash
curl http://localhost:3000/pieces/<id>
curl http://localhost:3000/pieces/<id>?collection=agent-alice
```

#### Update a piece
```bash
curl -X PUT http://localhost:3000/pieces/<id> \
  -H "Content-Type: application/json" \
  -d '{"title": "Updated title", "content": "Updated content.", "tags": ["new-tag"]}'
```

Set `title` to `null` to clear it.

#### Delete a piece
```bash
curl -X DELETE http://localhost:3000/pieces/<id>
curl -X DELETE http://localhost:3000/pieces/<id>?collection=agent-alice
```

#### Semantic search
```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is TypeScript?", "topK": 5}'
```

With tag filtering:
```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is TypeScript?", "tags": ["programming"], "topK": 5}'
```

With hybrid search (vector + keyword via Reciprocal Rank Fusion):
```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is TypeScript?", "topK": 5, "useHybridSearch": true}'
```

#### RAG query (retrieve + generate)
```bash
curl -X POST http://localhost:3000/rag \
  -H "Content-Type: application/json" \
  -d '{"query": "Explain TypeScript", "tags": ["programming"], "topK": 5}'
```

Returns:
```json
{
  "answer": "Generated answer based on retrieved context...",
  "sources": [
    {
      "piece": { "id": "...", "title": "...", "content": "...", "tags": ["..."] },
      "score": 0.87
    }
  ]
}
```

#### List collections
```bash
curl http://localhost:3000/collections
```

#### Delete a collection
```bash
curl -X DELETE http://localhost:3000/collections/agent-alice
```

> **Multi-collection:** All piece and query endpoints accept an optional `collection` parameter (in the request body for POST/PUT, as a query string for GET/DELETE) to target a specific collection. Omitting it uses the default collection.

---

## Exports

| Export | Description |
|--------|-------------|
| `PieceStore` | CRUD + semantic search over tagged text pieces |
| `RagPipeline` | Retrieve-then-generate pipeline using `PieceStore` + Ollama |
| `EmbeddingClient` | Low-level Ollama embedding wrapper |
| `MemoryMcpServer` | MCP server class (stdio transport) exposing memory tools |
| `createServer` | Express app factory with all REST endpoints pre-configured |
| `MemoryConfig` | Configuration interface (all fields optional with defaults) |
| `DEFAULT_MEMORY_CONFIG` | The default values for `MemoryConfig` |
| `Piece` | `{ id, content, title?, tags }` |
| `QueryOptions` | `{ tags?, topK?, useHybridSearch? }` |
| `QueryResult` | `{ piece, score }` |
| `RagResult` | `{ answer, sources }` |

---

## Configuration (`MemoryConfig`)

All fields are optional. Defaults are applied automatically.

| Option | Default | Description |
|--------|---------|-------------|
| `chromaUrl` | `http://localhost:8000` | ChromaDB server URL |
| `ollamaUrl` | `http://localhost:11434` | Ollama server URL |
| `embeddingModel` | `nomic-embed-text-v2-moe:latest` | Ollama model for embeddings |
| `generationModel` | `gemma3:latest` | Ollama model for RAG generation |
| `collectionName` | `pieces` | ChromaDB collection name |

> **Note:** `generationModel` is used by `createServer` and `MemoryMcpServer`. When constructing `RagPipeline` directly, you pass the model name to its constructor.

Environment variables with the names above can override these defaults at runtime.

## Testing

```bash
npm test              # run all tests
npm run test:watch    # watch mode
npm run test:coverage # with coverage report
```