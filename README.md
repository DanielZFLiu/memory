# Memory
A fully local Node.js library and REST API for storing, searching, and querying tagged text pieces using ChromaDB for vector storage and Ollama for embeddings + generation.

## Prerequisites

- **Node.js** ≥ 18
- **Ollama** running locally ([install](https://ollama.com))
- **ChromaDB** server running locally

### Start Ollama & pull models

```bash
ollama pull nomic-embed-text-v2-moe
ollama pull llama3.2
npm run ollama
```

or on a specific port:

```bash
npm run ollama:port 11435
```

### Start ChromaDB
```bash
npm run db
```

or on a specific port:

```bash
npm run db:port 9000
```

**Windows note:** If `chroma` is not recognized, the `Scripts` directory may not be on your PATH. Either add it (e.g. `%APPDATA%\Python\Python3xx\Scripts`) or run the executable directly:
```powershell
& "$env:APPDATA\Python\Python313\Scripts\chroma.exe" run --port 8000
```

## Install

```bash
npm install
```

## Usage

### REST API Server

```bash
npm run dev
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

### Programmatic Usage (Library)

```typescript
import { PieceStore, RagPipeline, MemoryConfig } from "memory";

async function main() {
    const config: MemoryConfig = {
        chromaUrl: "http://localhost:8000",
        ollamaUrl: "http://localhost:11434",
        embeddingModel: "nomic-embed-text-v2-moe",
    };

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

    const rag = new RagPipeline(store, "http://localhost:11434", "llama3.2");
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

## Configuration (`MemoryConfig`)

| Option | Default | Description |
|--------|---------|-------------|
| `chromaUrl` | `http://localhost:8000` | ChromaDB server URL |
| `ollamaUrl` | `http://localhost:11434` | Ollama server URL |
| `embeddingModel` | `nomic-embed-text-v2-moe` | Ollama model for embeddings |
| `generationModel` | `llama3.2` | Ollama model for RAG generation |
| `collectionName` | `pieces` | ChromaDB collection name |

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
├── embeddings.ts   # Ollama embedding client
├── store.ts        # PieceStore — CRUD + semantic search + tag filtering
├── rag.ts          # RAG pipeline — retrieve → prompt → generate
├── server.ts       # Express REST API (app factory)
├── main.ts         # Server entry point (starts listening)
└── index.ts        # Library entry point (public exports)
tests/
├── helpers/        # Shared test fixtures (in-memory ChromaDB mock, etc.)
├── unit/           # Unit tests (embeddings, store, rag)
└── integration/    # API integration tests (supertest)
```