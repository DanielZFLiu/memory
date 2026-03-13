# Configuration

All `MemoryConfig` fields are optional. Defaults are applied automatically.

| Option | Default | Description |
|--------|---------|-------------|
| `chromaUrl` | `http://localhost:8000` | ChromaDB server URL |
| `ollamaUrl` | `http://localhost:11434` | Ollama server URL |
| `embeddingModel` | `nomic-embed-text-v2-moe:latest` | Ollama model for embeddings |
| `generationModel` | `gemma3:latest` | Ollama model for RAG generation |
| `collectionName` | `pieces` | Default ChromaDB collection name |
| `requestLogging` | `off` | REST request logging mode: `off`, `metadata`, or `body` |

`generationModel` is used by `createServer` and `MemoryMcpServer`. When constructing `RagPipeline` directly, pass the model name to its constructor.

`requestLogging: "metadata"` logs method, URL, status, duration, and collection when present.

`requestLogging: "body"` additionally logs the JSON request body. This should stay opt-in because queries and stored content may be sensitive.

## Environment variable overrides

Runtime configuration can be overridden with either `MEMORY_*` or non-prefixed environment variable names:

| Config field | Supported environment variables |
|-------------|----------------------------------|
| `chromaUrl` | `MEMORY_CHROMA_URL`, `CHROMA_URL` |
| `ollamaUrl` | `MEMORY_OLLAMA_URL`, `OLLAMA_URL` |
| `embeddingModel` | `MEMORY_EMBEDDING_MODEL`, `EMBEDDING_MODEL` |
| `generationModel` | `MEMORY_GENERATION_MODEL`, `GENERATION_MODEL` |
| `collectionName` | `MEMORY_COLLECTION_NAME`, `COLLECTION_NAME` |
| `requestLogging` | `MEMORY_REQUEST_LOGGING`, `REQUEST_LOGGING` |

For `requestLogging`, supported values are `off`, `metadata`, and `body`.

## Example

```typescript
import { createServer } from "@danielzfliu/memory";

const app = createServer({
    chromaUrl: process.env.MEMORY_CHROMA_URL,
    ollamaUrl: process.env.MEMORY_OLLAMA_URL,
    collectionName: "agent-alice",
    requestLogging: "metadata",
});
```
