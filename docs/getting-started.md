# Getting Started

## Prerequisites

- **Node.js** `>= 18`
- **Ollama** running locally
- **ChromaDB** server running locally

## Clone and install

```bash
git clone https://github.com/DanielZFLiu/memory.git
cd memory
npm install
```

## Set up Ollama

Install Ollama from [ollama.com](https://ollama.com), then pull the default models:

```bash
ollama pull nomic-embed-text-v2-moe:latest
ollama pull gemma3:latest
```

Start Ollama:

```bash
npm run ollama               # start Ollama on port 11434
npm run ollama:port -- 11435 # start Ollama on a custom port
```

## Set up ChromaDB

### Option 1: Docker

The repository includes `docker-compose.yml` for running ChromaDB and persisting data in `./chroma/`.

```bash
npm run docker:up
npm run docker:logs
npm run docker:down
```

This exposes ChromaDB on `http://localhost:8000`.

### Option 2: pip

```bash
pip install chromadb
chroma run --port 8000
```

You may need to add Python's Scripts directory to your `PATH` after installation.

### Option 3: npm helper script

If `chroma` is already available on your machine, you can also run:

```bash
npm run db               # start ChromaDB on port 8000
npm run db:port -- 8001  # start ChromaDB on a custom port
```

## Choose a usage mode

- [MCP Server](./mcp-server.md)
- [npm Package](./npm-package.md)
- [REST API](./rest-api.md)

If you want to see incoming REST API requests during local development, set `MEMORY_REQUEST_LOGGING=metadata` or `REQUEST_LOGGING=metadata` before starting the HTTP server. To log JSON request bodies as well, use `body` instead of `metadata`.

If you need to call the REST API from a browser-based frontend on a different origin, set `MEMORY_CORS_ORIGINS` or `CORS_ORIGINS` to a comma-separated allowlist such as `http://localhost:5173`. CORS remains disabled by default.

## Configuration

See [Configuration](./configuration.md) for runtime options and supported environment variables.

## Testing

```bash
npm test
npm run test:watch
npm run test:coverage
```
