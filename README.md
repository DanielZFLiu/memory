[![npm version](https://img.shields.io/npm/v/@danielzfliu/memory.svg)](https://www.npmjs.com/package/@danielzfliu/memory)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-red.svg)](LICENSE)

# Memory

A fully local MCP server, Node.js library, and REST API for storing, semantically searching, and querying tagged or titled text with ChromaDB and Ollama.

## Documentation

- [Docs index](./docs/README.md)
- [Getting Started](./docs/getting-started.md)
- [MCP Server](./docs/mcp-server.md)
- [npm Package](./docs/npm-package.md)
- [REST API](./docs/rest-api.md)
- [Configuration](./docs/configuration.md)

## Usage modes

| Mode | What it does | Docs |
|------|---------------|------|
| MCP Server | Runs Memory over stdio for MCP-compatible clients | [MCP Server](./docs/mcp-server.md) |
| npm Package | Lets you use `PieceStore`, `RagPipeline`, `createServer`, and related types directly | [npm Package](./docs/npm-package.md) |
| REST API | Runs the standalone HTTP server with CRUD, semantic search, and RAG endpoints | [REST API](./docs/rest-api.md) |

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/DanielZFLiu/memory.git
cd memory
npm install
```

### 2. Start local dependencies

```bash
npm run docker:up
npm run ollama
```

By default, Memory expects:

- ChromaDB at `http://localhost:8000`
- Ollama at `http://localhost:11434`
- `nomic-embed-text-v2-moe:latest` for embeddings
- `gemma3:latest` for generation

See [Getting Started](./docs/getting-started.md) for alternative setup options, including custom ports and non-Docker ChromaDB.

### 3. Choose how to run Memory

Run the MCP server:

```bash
npm run build
node ./dist/main.js
```

Run the REST API in development:

```bash
npm run dev:http
```

Use it as a package in your own project:

```bash
npm install @danielzfliu/memory
```

## Configuration

Runtime configuration is documented in [Configuration](./docs/configuration.md), including supported `MEMORY_*` and non-prefixed environment variable overrides.

## Development

```bash
npm test
npm run test:watch
npm run test:coverage
```
