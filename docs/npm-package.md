# npm Package

Install Memory into your own Node.js or TypeScript project:

```bash
npm install @danielzfliu/memory
```

## Programmatic usage

The examples below are written in TypeScript.

### Use `PieceStore` and `RagPipeline`

```typescript
import { PieceStore, RagPipeline, MemoryConfig } from "@danielzfliu/memory";

async function main() {
    const config: MemoryConfig = {
        chromaUrl: "http://localhost:8000",
        ollamaUrl: "http://localhost:11434",
        embeddingModel: "nomic-embed-text-v2-moe:latest",
    };

    const store = new PieceStore(config);
    await store.init();

    await store.addPiece(
        "TypeScript is a typed superset of JavaScript.",
        ["typescript", "programming"],
        "TypeScript overview",
    );

    const results = await store.queryPieces("typed languages", { topK: 5 });
    console.log("results", results);

    const filtered = await store.queryPieces("typed languages", {
        tags: ["typescript"],
        topK: 5,
    });
    console.log("filtered", filtered);

    const hybrid = await store.queryPieces("typed languages", {
        topK: 5,
        useHybridSearch: true,
    });
    console.log("hybrid", hybrid);

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

### Embed the REST API in your own Express app

`createServer` returns a configured Express app you can mount or extend:

```typescript
import { createServer } from "@danielzfliu/memory";

const app = createServer({
    chromaUrl: "http://localhost:8000",
    ollamaUrl: "http://localhost:11434",
});

app.listen(4000, () => console.log("Running on :4000"));
```

## Public exports

| Export | Description |
|--------|-------------|
| `PieceStore` | CRUD and semantic search over tagged text pieces |
| `RagPipeline` | Retrieve-then-generate pipeline using `PieceStore` and Ollama |
| `EmbeddingClient` | Low-level Ollama embedding wrapper |
| `MemoryMcpServer` | MCP server class for stdio transport |
| `createServer` | Express app factory with REST endpoints pre-configured |
| `MemoryConfig` | Configuration interface |
| `DEFAULT_MEMORY_CONFIG` | Default resolved configuration values |
| `Piece` | `{ id, content, title?, tags }` |
| `QueryOptions` | `{ tags?, topK?, useHybridSearch? }` |
| `QueryResult` | `{ piece, score }` |
| `RagResult` | `{ answer, sources }` |

## Configuration

See [Configuration](./configuration.md) for defaults and environment variable overrides.
