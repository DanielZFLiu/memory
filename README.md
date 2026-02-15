[![npm version](https://img.shields.io/npm/v/@danielzfliu/memory.svg)](https://www.npmjs.com/package/@danielzfliu/memory)

# Memory

A fully local MCP server and Node.js library for storing, semantically searching, and querying tagged text with ChromaDB (vector storage) and Ollama (embeddings and generation).

Three ways to use Memory:

- MCP Server — Run Memory as a Model Context Protocol server over stdio and expose memory tools to MCP-compatible clients.
- npm Package — Install `@danielzfliu/memory` in your own project and use the classes directly (store, embeddings, RAG, and MCP server class).
- REST API Server — Run the standalone HTTP server with CRUD, semantic search, and RAG endpoints.

---

## Prerequisites

- Node.js ≥ 18
- Ollama running locally ([install](https://ollama.com))
- ChromaDB server running locally

Pull the required models:
```bash
ollama pull nomic-embed-text-v2-moe
ollama pull llama3.2
```

---

## Option A: MCP Server (stdio)

Use this option to run Memory as a standalone MCP server.

### 1. Setup

```bash
git clone https://github.com/DanielZFLiu/memory.git
cd memory
npm install
```

### 2. Start external services

The repo includes convenience scripts for starting Ollama and ChromaDB:

```bash
npm run ollama                     # start Ollama on default port 11434
npm run ollama:port -- 11435       # start Ollama on a custom port

npm run db                         # start ChromaDB on default port 8000
npm run db:port -- 9000            # start ChromaDB on a custom port
```

### 3. Build and run the MCP server

```bash
npm install
npm run build
npx -y @danielzfliu/memory
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
| `add_piece` | Add a new piece with optional tags |
| `get_piece` | Retrieve a piece by id |
| `update_piece` | Update piece content and/or tags |
| `delete_piece` | Delete a piece by id |
| `query_pieces` | Semantic search with optional tag filtering |
| `rag_query` | Retrieve + generate answer with citations |

---

## Option B: npm Package

Use this option to integrate Memory into your own Node.js/TypeScript project.

### 1. Install

```bash
npm install @danielzfliu/memory
```

### 2. Start external services

You are responsible for running Ollama and ChromaDB yourself:

```bash
ollama serve                       # default port 11434
chroma run --port 8000             # default port 8000
```

**Windows note:** If `chroma` is not recognized, the `Scripts` directory may not be on your PATH. Either add it (e.g. `%APPDATA%\Python\Python3xx\Scripts`) or run the executable directly:
```powershell
& "$env:APPDATA\Python\Python313\Scripts\chroma.exe" run --port 8000
```

### 3. Programmatic usage

#### Using PieceStore and RagPipeline directly

```typescript
import { PieceStore, RagPipeline, MemoryConfig } from "@danielzfliu/memory";

async function main() {
    const config: MemoryConfig = {
        chromaUrl: "http://localhost:8000",
        ollamaUrl: "http://localhost:11434",
        embeddingModel: "nomic-embed-text-v2-moe",
    };

    // Store: CRUD + semantic search
    const store = new PieceStore(config);
    await store.init();

    await store.addPiece("TypeScript is a typed superset of JavaScript.", [
        "typescript",
        "programming",
    ]);
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

    // RAG: retrieve relevant pieces → generate an answer via Ollama
    const rag = new RagPipeline(store, config.ollamaUrl!, "llama3.2");
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

### 2. Start external services

The repo includes convenience scripts for starting Ollama and ChromaDB:

```bash
npm run ollama                     # start Ollama on default port 11434
npm run ollama:port -- 11435       # start Ollama on a custom port

npm run db                         # start ChromaDB on default port 8000
npm run db:port -- 9000            # start ChromaDB on a custom port
```

### 3. Start the REST server

```bash
npm run dev:http
```

Server starts on `http://localhost:3000` by default (set `PORT` env var to change).

### API Endpoints

#### Add a piece
```bash
curl -X POST http://localhost:3000/pieces \
  -H "Content-Type: application/json" \
  -d '{"content": "TypeScript is a typed superset of JavaScript.", "tags": ["typescript", "programming"]}'
```

#### Get a piece by ID
```bash
curl http://localhost:3000/pieces/<id>
```

#### Update a piece
```bash
curl -X PUT http://localhost:3000/pieces/<id> \
  -H "Content-Type: application/json" \
  -d '{"content": "Updated content.", "tags": ["new-tag"]}'
```

#### Delete a piece
```bash
curl -X DELETE http://localhost:3000/pieces/<id>
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
      "piece": { "id": "...", "content": "...", "tags": ["..."] },
      "score": 0.87
    }
  ]
}
```

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
| `Piece` | `{ id, content, tags }` |
| `QueryOptions` | `{ tags?, topK? }` |
| `QueryResult` | `{ piece, score }` |
| `RagResult` | `{ answer, sources }` |

---

## Configuration (`MemoryConfig`)

All fields are optional. Defaults are applied automatically.

| Option | Default | Description |
|--------|---------|-------------|
| `chromaUrl` | `http://localhost:8000` | ChromaDB server URL |
| `ollamaUrl` | `http://localhost:11434` | Ollama server URL |
| `embeddingModel` | `nomic-embed-text-v2-moe` | Ollama model for embeddings |
| `generationModel` | `llama3.2` | Ollama model for RAG generation (used by `createServer`) |
| `collectionName` | `pieces` | ChromaDB collection name |

> **Note:** `generationModel` is only used by `createServer`. When constructing `RagPipeline` directly, you pass the model name to its constructor.

## Testing

```bash
npm test              # run all tests
npm run test:watch    # watch mode
npm run test:coverage # with coverage report
```

## Project Structure

```
src/
├── types.ts        # Interfaces (MemoryConfig, Piece, QueryResult, etc.)
├── config.ts       # Default config values and config resolution
├── embeddings.ts   # Ollama embedding client
├── store.ts        # PieceStore — CRUD + semantic search + tag filtering
├── rag.ts          # RAG pipeline — retrieve → prompt → generate
├── mcp.ts          # MCP server (stdio) + tool handlers
├── server.ts       # Express REST API (app factory)
├── http-main.ts    # HTTP server entry point (starts listening)
├── main.ts         # MCP entry point (stdio)
└── index.ts        # Library entry point (public exports)
tests/
├── helpers/        # Shared test fixtures (in-memory ChromaDB mock, etc.)
├── unit/           # Unit tests (embeddings, store, rag)
├── manual/         # Manual api tests (used by ai agents with access to terminal)
└── integration/    # API integration tests (supertest)
```