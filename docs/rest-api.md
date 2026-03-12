# REST API

Use Memory as a standalone HTTP service.

## Start the server

### Development

```bash
npm install
npm run dev:http
```

### Production-style run

```bash
npm install
npm run build
npm run start:http
```

The server listens on `http://localhost:3000` by default. Set `PORT` to change it.

## API contract

Base URL: `http://localhost:3000`

All request bodies are JSON. Success responses are also JSON unless the status is `204 No Content`.

### Shared response shapes

`Piece`

| Field | Type | Description |
|------|------|-------------|
| `id` | `string` | Server-generated UUID |
| `content` | `string` | Stored text content |
| `title` | `string` | Optional human-readable title |
| `tags` | `string[]` | Tags associated with the piece |

Example:

```json
{
  "id": "2f7b8d6a-0f34-4a1f-85c0-5a7f4cce7c4d",
  "title": "TypeScript overview",
  "content": "TypeScript is a typed superset of JavaScript.",
  "tags": ["typescript", "programming"]
}
```

`QueryResult`

```json
{
  "piece": {
    "id": "2f7b8d6a-0f34-4a1f-85c0-5a7f4cce7c4d",
    "title": "TypeScript overview",
    "content": "TypeScript is a typed superset of JavaScript.",
    "tags": ["typescript", "programming"]
  },
  "score": 0.87
}
```

`RagResult`

```json
{
  "answer": "TypeScript adds a type system on top of JavaScript. [1]",
  "sources": [
    {
      "piece": {
        "id": "2f7b8d6a-0f34-4a1f-85c0-5a7f4cce7c4d",
        "title": "TypeScript overview",
        "content": "TypeScript is a typed superset of JavaScript.",
        "tags": ["typescript", "programming"]
      },
      "score": 0.87
    }
  ]
}
```

`ErrorResponse`

```json
{
  "error": "content (string) is required"
}
```

`ServiceUnavailableResponse`

```json
{
  "error": "Failed to connect to ChromaDB",
  "details": "Error: ..."
}
```

> **Multi-collection:** All piece and query endpoints accept an optional `collection` parameter to target a specific collection. For `POST` and `PUT`, pass it in the JSON body. For `GET` and `DELETE`, pass it as a query parameter. Omitting it uses the default collection.

### `POST /pieces`

Create a new piece.

Request body:

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `content` | `string` | Yes | Piece text to store |
| `title` | `string` | No | Optional title |
| `tags` | `string[]` | No | Optional tags; defaults to `[]` |
| `collection` | `string` | No | Optional target collection |

Responses:

| Status | Body |
|--------|------|
| `201` | `Piece` |
| `400` | `ErrorResponse` |
| `500` | `ErrorResponse` |
| `503` | `ServiceUnavailableResponse` |

Example:

```bash
curl -X POST http://localhost:3000/pieces \
  -H "Content-Type: application/json" \
  -d '{"title": "TypeScript overview", "content": "TypeScript is a typed superset of JavaScript.", "tags": ["typescript", "programming"]}'
```

### `GET /pieces/:id`

Fetch a piece by ID.

Query parameters:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `collection` | `string` | No | Optional target collection |

Responses:

| Status | Body |
|--------|------|
| `200` | `Piece` |
| `404` | `ErrorResponse` with `"Piece not found"` |
| `500` | `ErrorResponse` |
| `503` | `ServiceUnavailableResponse` |

Example:

```bash
curl http://localhost:3000/pieces/<id>
curl http://localhost:3000/pieces/<id>?collection=agent-alice
```

### `PUT /pieces/:id`

Update an existing piece. Any omitted field keeps its current value.

Request body:

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `content` | `string` | No | Updated piece content |
| `title` | `string \| null` | No | Updated title; pass `null` to clear it |
| `tags` | `string[]` | No | Replacement tag list |
| `collection` | `string` | No | Optional target collection |

Responses:

| Status | Body |
|--------|------|
| `200` | `Piece` |
| `400` | `ErrorResponse` |
| `404` | `ErrorResponse` with `"Piece not found"` |
| `500` | `ErrorResponse` |
| `503` | `ServiceUnavailableResponse` |

Example:

```bash
curl -X PUT http://localhost:3000/pieces/<id> \
  -H "Content-Type: application/json" \
  -d '{"title": "Updated title", "content": "Updated content.", "tags": ["new-tag"]}'
```

### `DELETE /pieces/:id`

Delete a piece by ID.

Query parameters:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `collection` | `string` | No | Optional target collection |

Responses:

| Status | Body |
|--------|------|
| `204` | No body |
| `500` | `ErrorResponse` |
| `503` | `ServiceUnavailableResponse` |

Example:

```bash
curl -X DELETE http://localhost:3000/pieces/<id>
curl -X DELETE http://localhost:3000/pieces/<id>?collection=agent-alice
```

### `POST /query`

Run semantic search over stored pieces.

Request body:

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `query` | `string` | Yes | Search query |
| `tags` | `string[]` | No | Restrict matches to pieces containing these tags |
| `topK` | `number` | No | Positive integer result count; defaults to `10` |
| `useHybridSearch` | `boolean` | No | When `true`, combine vector and keyword ranking |
| `collection` | `string` | No | Optional target collection |

Responses:

| Status | Body |
|--------|------|
| `200` | `QueryResult[]` |
| `400` | `ErrorResponse` |
| `500` | `ErrorResponse` |
| `503` | `ServiceUnavailableResponse` |

Example:

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

With hybrid search:

```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is TypeScript?", "topK": 5, "useHybridSearch": true}'
```

### `POST /rag`

Run retrieval and then ask the configured generation model to answer using only the retrieved context.

Request body:

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `query` | `string` | Yes | User question |
| `tags` | `string[]` | No | Restrict retrieval to matching tags |
| `topK` | `number` | No | Positive integer source count; defaults to `10` |
| `useHybridSearch` | `boolean` | No | When `true`, combine vector and keyword ranking before generation |
| `collection` | `string` | No | Optional target collection |

Responses:

| Status | Body |
|--------|------|
| `200` | `RagResult` |
| `400` | `ErrorResponse` |
| `500` | `ErrorResponse` |
| `503` | `ServiceUnavailableResponse` |

Example:

```bash
curl -X POST http://localhost:3000/rag \
  -H "Content-Type: application/json" \
  -d '{"query": "Explain TypeScript", "tags": ["programming"], "topK": 5}'
```

If no relevant pieces are found, the server still returns `200` with an answer explaining that there is not enough context and `sources: []`.

### `GET /collections`

List available collections.

Responses:

| Status | Body |
|--------|------|
| `200` | `{ "collections": string[] }` |
| `500` | `ErrorResponse` |
| `503` | `ServiceUnavailableResponse` |

Example:

```bash
curl http://localhost:3000/collections
```

### `DELETE /collections/:name`

Delete a collection by name.

Responses:

| Status | Body |
|--------|------|
| `204` | No body |
| `500` | `ErrorResponse` |
| `503` | `ServiceUnavailableResponse` |

Example:

```bash
curl -X DELETE http://localhost:3000/collections/agent-alice
```
