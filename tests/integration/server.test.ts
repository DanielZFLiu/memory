import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import {
    createInMemoryCollection,
    deterministicEmbedding,
} from "../helpers/in-memory-collection";

const mockEmbed = vi.fn(async (params: { model: string; input: string | string[] }) => {
    const inputs = Array.isArray(params.input) ? params.input : [params.input];
    return { embeddings: inputs.map((t) => deterministicEmbedding(t)) };
});

const mockChat = vi.fn(async (..._args: unknown[]) => ({
    message: { content: "Mocked LLM response based on provided context." },
}));

const collectionMap = new Map<string, ReturnType<typeof createInMemoryCollection>>();
const defaultCollection = createInMemoryCollection();
collectionMap.set("integration-test", defaultCollection);

const mockGetOrCreateCollection = vi.fn(async (params: { name: string }) => {
    let col = collectionMap.get(params.name);
    if (!col) {
        col = createInMemoryCollection();
        collectionMap.set(params.name, col);
    }
    return col;
});
const mockListCollections = vi.fn(async () => Array.from(collectionMap.keys()));
const mockDeleteCollectionFn = vi.fn(async (params: { name: string }) => {
    collectionMap.delete(params.name);
});

vi.mock("chromadb", () => ({
    ChromaClient: class {
        getOrCreateCollection = mockGetOrCreateCollection;
        listCollections = mockListCollections;
        deleteCollection = mockDeleteCollectionFn;
    },
    Collection: class {},
    IncludeEnum: {
        Documents: "documents",
        Metadatas: "metadatas",
        Distances: "distances",
    },
}));

vi.mock("ollama", () => ({
    Ollama: class {
        embed = mockEmbed;
        chat = mockChat;
    },
}));

import { createServer } from "../../src/server";

// ---------------------------------------------------------------------------
// Shared seed data used by semantic search, hybrid search, etc.
// ---------------------------------------------------------------------------

const SEARCH_SEED_DATA = [
    {
        content: "TypeScript is a typed superset of JavaScript.",
        tags: ["typescript", "programming"],
    },
    {
        content: "Python is widely used for data science and ML.",
        tags: ["python", "programming", "data-science"],
    },
    {
        content: "Express.js is a minimal web framework for Node.js.",
        tags: ["javascript", "web", "node"],
    },
    {
        content: "ChromaDB is an open-source vector database.",
        tags: ["database", "ai", "vectors"],
    },
];

async function seedSearchData(app: ReturnType<typeof createServer>) {
    for (const piece of SEARCH_SEED_DATA) {
        await request(app).post("/pieces").send(piece);
    }
}

// ---------------------------------------------------------------------------
// Integration tests — exercise the full HTTP → server → store → rag stack
// ---------------------------------------------------------------------------

describe("Integration: Full API Stack", () => {
    let app: ReturnType<typeof createServer>;

    beforeEach(() => {
        vi.clearAllMocks();
        collectionMap.clear();
        const freshDefault = createInMemoryCollection();
        collectionMap.set("integration-test", freshDefault);
        mockGetOrCreateCollection.mockImplementation(async (params: { name: string }) => {
            let col = collectionMap.get(params.name);
            if (!col) {
                col = createInMemoryCollection();
                collectionMap.set(params.name, col);
            }
            return col;
        });
        mockListCollections.mockImplementation(async () => Array.from(collectionMap.keys()));
        mockDeleteCollectionFn.mockImplementation(async (params: { name: string }) => {
            collectionMap.delete(params.name);
        });
        app = createServer({
            collectionName: "integration-test",
        });
    });

    // -------------------------------------------------------------------
    // CRUD Lifecycle
    // -------------------------------------------------------------------

    describe("CRUD lifecycle", () => {
        it("creates, reads, updates, and deletes a piece end-to-end", async () => {
            // CREATE
            const createRes = await request(app)
                .post("/pieces")
                .send({
                    title: "TypeScript overview",
                    content: "TypeScript is a typed superset of JavaScript.",
                    tags: ["typescript", "programming"],
                });

            expect(createRes.status).toBe(201);
            expect(createRes.body).toHaveProperty("id");
            expect(createRes.body.title).toBe("TypeScript overview");
            expect(createRes.body.content).toBe(
                "TypeScript is a typed superset of JavaScript.",
            );
            expect(createRes.body.tags).toEqual(["typescript", "programming"]);

            const pieceId = createRes.body.id;

            // READ
            const getRes = await request(app).get(`/pieces/${pieceId}`);

            expect(getRes.status).toBe(200);
            expect(getRes.body.id).toBe(pieceId);
            expect(getRes.body.title).toBe("TypeScript overview");
            expect(getRes.body.content).toBe(
                "TypeScript is a typed superset of JavaScript.",
            );

            // UPDATE content + tags
            const updateRes = await request(app)
                .put(`/pieces/${pieceId}`)
                .send({
                    title: "TypeScript summary",
                    content: "TypeScript adds static types to JavaScript.",
                    tags: ["typescript"],
                });

            expect(updateRes.status).toBe(200);
            expect(updateRes.body.title).toBe("TypeScript summary");
            expect(updateRes.body.content).toBe(
                "TypeScript adds static types to JavaScript.",
            );
            expect(updateRes.body.tags).toEqual(["typescript"]);

            // READ after update
            const getAfterUpdate = await request(app).get(
                `/pieces/${pieceId}`,
            );
            expect(getAfterUpdate.body.title).toBe("TypeScript summary");
            expect(getAfterUpdate.body.content).toBe(
                "TypeScript adds static types to JavaScript.",
            );

            // DELETE
            const deleteRes = await request(app).delete(`/pieces/${pieceId}`);
            expect(deleteRes.status).toBe(204);

            // READ after delete
            const getAfterDelete = await request(app).get(
                `/pieces/${pieceId}`,
            );
            expect(getAfterDelete.status).toBe(404);
        });

        it("creates multiple pieces and retrieves each independently", async () => {
            const pieces = [
                { content: "Piece A", tags: ["a"] },
                { content: "Piece B", tags: ["b"] },
                { content: "Piece C", tags: ["c"] },
            ];

            const ids: string[] = [];
            for (const p of pieces) {
                const res = await request(app).post("/pieces").send(p);
                expect(res.status).toBe(201);
                ids.push(res.body.id);
            }

            // Each piece should be independently retrievable
            for (let i = 0; i < pieces.length; i++) {
                const res = await request(app).get(`/pieces/${ids[i]}`);
                expect(res.status).toBe(200);
                expect(res.body.content).toBe(pieces[i].content);
                expect(res.body.tags).toEqual(pieces[i].tags);
            }
        });
    });

    // -------------------------------------------------------------------
    // Semantic Search
    // -------------------------------------------------------------------

    describe("semantic search", () => {
        beforeEach(async () => {
            await seedSearchData(app);
        });

        it("returns results with correct structure", async () => {
            const res = await request(app)
                .post("/query")
                .send({ query: "TypeScript", topK: 2 });

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBeLessThanOrEqual(2);

            for (const result of res.body) {
                expect(result).toHaveProperty("piece");
                expect(result).toHaveProperty("score");
                expect(result.piece).toHaveProperty("id");
                expect(result.piece).toHaveProperty("content");
                expect(result.piece).toHaveProperty("tags");
                expect(typeof result.score).toBe("number");
            }
        });

        it("returns scores in non-increasing order", async () => {
            const res = await request(app)
                .post("/query")
                .send({ query: "programming language", topK: 4 });

            expect(res.status).toBe(200);

            for (let i = 1; i < res.body.length; i++) {
                expect(res.body[i].score).toBeLessThanOrEqual(
                    res.body[i - 1].score,
                );
            }
        });

        it("respects topK parameter", async () => {
            const res = await request(app)
                .post("/query")
                .send({ query: "programming", topK: 1 });

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
        });

        it("filters results by single tag", async () => {
            const res = await request(app)
                .post("/query")
                .send({ query: "programming", tags: ["python"], topK: 10 });

            expect(res.status).toBe(200);

            for (const result of res.body) {
                expect(result.piece.tags).toContain("python");
            }
        });

        it("filters results by multiple tags (AND logic)", async () => {
            const res = await request(app)
                .post("/query")
                .send({
                    query: "programming",
                    tags: ["python", "programming"],
                    topK: 10,
                });

            expect(res.status).toBe(200);

            for (const result of res.body) {
                expect(result.piece.tags).toContain("python");
                expect(result.piece.tags).toContain("programming");
            }
        });

        it("returns empty array for non-matching tag filter", async () => {
            const res = await request(app)
                .post("/query")
                .send({
                    query: "anything",
                    tags: ["nonexistent-tag-xyz"],
                    topK: 10,
                });

            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it("can retrieve a piece by title terms", async () => {
            await request(app).post("/pieces").send({
                title: "ZXQV retrieval title",
                content: "Body text without the special title phrase.",
                tags: ["title-search"],
            });

            const res = await request(app)
                .post("/query")
                .send({ query: "ZXQV retrieval title", topK: 5 });

            expect(res.status).toBe(200);
            expect(
                res.body.some(
                    (result: { piece: { title?: string } }) =>
                        result.piece.title === "ZXQV retrieval title",
                ),
            ).toBe(true);
        });
    });

    // -------------------------------------------------------------------
    // Hybrid Search
    // -------------------------------------------------------------------

    describe("hybrid search", () => {
        beforeEach(async () => {
            await seedSearchData(app);
        });

        it("returns results with correct structure when hybrid search is enabled", async () => {
            const res = await request(app)
                .post("/query")
                .send({ query: "TypeScript", topK: 2, useHybridSearch: true });

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBeLessThanOrEqual(2);

            for (const result of res.body) {
                expect(result).toHaveProperty("piece");
                expect(result).toHaveProperty("score");
                expect(typeof result.score).toBe("number");
            }
        });

        it("boosts keyword-matching results over pure vector results", async () => {
            const res = await request(app)
                .post("/query")
                .send({ query: "ChromaDB vector database", topK: 4, useHybridSearch: true });

            expect(res.status).toBe(200);
            // The ChromaDB piece should rank highly because it matches keywords
            expect(
                res.body.some(
                    (r: { piece: { content: string } }) =>
                        r.piece.content.includes("ChromaDB"),
                ),
            ).toBe(true);
        });

        it("respects tag filters with hybrid search", async () => {
            const res = await request(app)
                .post("/query")
                .send({
                    query: "programming language",
                    tags: ["python"],
                    topK: 10,
                    useHybridSearch: true,
                });

            expect(res.status).toBe(200);
            for (const result of res.body) {
                expect(result.piece.tags).toContain("python");
            }
        });

        it("rejects non-boolean useHybridSearch", async () => {
            const res = await request(app)
                .post("/query")
                .send({ query: "test", useHybridSearch: "yes" });

            expect(res.status).toBe(400);
        });

        it("works with RAG endpoint", async () => {
            const res = await request(app)
                .post("/rag")
                .send({ query: "What is ChromaDB?", topK: 3, useHybridSearch: true });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("answer");
            expect(res.body).toHaveProperty("sources");
        });

        it("rejects non-boolean useHybridSearch on RAG endpoint", async () => {
            const res = await request(app)
                .post("/rag")
                .send({ query: "test", useHybridSearch: 123 });

            expect(res.status).toBe(400);
        });
    });

    // -------------------------------------------------------------------
    // RAG Pipeline
    // -------------------------------------------------------------------

    describe("RAG pipeline", () => {
        beforeEach(async () => {
            await request(app).post("/pieces").send({
                content: "RAG combines retrieval with generation.",
                tags: ["ai", "rag"],
            });
            await request(app).post("/pieces").send({
                content: "TypeScript is a typed superset of JavaScript.",
                tags: ["programming"],
            });
        });

        it("returns answer and sources", async () => {
            const res = await request(app)
                .post("/rag")
                .send({ query: "What is RAG?", topK: 5 });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("answer");
            expect(res.body).toHaveProperty("sources");
            expect(typeof res.body.answer).toBe("string");
            expect(Array.isArray(res.body.sources)).toBe(true);
            expect(res.body.sources.length).toBeGreaterThan(0);
        });

        it("calls the LLM with context from retrieved pieces", async () => {
            await request(app)
                .post("/rag")
                .send({ query: "What is RAG?", topK: 5 });

            expect(mockChat).toHaveBeenCalledTimes(1);
            const chatArgs = mockChat.mock.calls[0]?.[0] as {
                model: string;
                messages: { role: string; content: string }[];
            } | undefined;
            expect(chatArgs).toBeDefined();
            expect(chatArgs!.messages).toHaveLength(2);
            expect(chatArgs!.messages[0].role).toBe("system");
            expect(chatArgs!.messages[1].role).toBe("user");
            expect(chatArgs!.messages[1].content).toContain("Context:");
            expect(chatArgs!.messages[1].content).toContain("Question:");
        });

        it("filters RAG sources by tags", async () => {
            const res = await request(app)
                .post("/rag")
                .send({ query: "Tell me about AI", tags: ["ai"], topK: 5 });

            expect(res.status).toBe(200);
            for (const source of res.body.sources) {
                expect(source.piece.tags).toContain("ai");
            }
        });

        it("returns no-context answer when tag filter matches nothing", async () => {
            const res = await request(app)
                .post("/rag")
                .send({
                    query: "test",
                    tags: ["nonexistent-tag"],
                    topK: 5,
                });

            expect(res.status).toBe(200);
            expect(res.body.sources).toEqual([]);
            expect(res.body.answer).toContain("don't have enough context");
            // LLM should NOT be called when there are no sources
            expect(mockChat).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------
    // Input Validation (end-to-end)
    // -------------------------------------------------------------------

    describe("input validation", () => {
        it("rejects POST /pieces with missing content", async () => {
            const res = await request(app).post("/pieces").send({});
            expect(res.status).toBe(400);
        });

        it("rejects POST /pieces with non-string content", async () => {
            const res = await request(app)
                .post("/pieces")
                .send({ content: 42 });
            expect(res.status).toBe(400);
        });

        it("rejects POST /pieces with non-string title", async () => {
            const res = await request(app)
                .post("/pieces")
                .send({ content: "ok", title: 42 });
            expect(res.status).toBe(400);
        });

        it("rejects POST /pieces with invalid tags", async () => {
            const res = await request(app)
                .post("/pieces")
                .send({ content: "ok", tags: ["good", 123] });
            expect(res.status).toBe(400);
        });

        it("rejects PUT /pieces with invalid title type", async () => {
            const createRes = await request(app)
                .post("/pieces")
                .send({ content: "Original content", tags: ["old"] });

            const res = await request(app)
                .put(`/pieces/${createRes.body.id}`)
                .send({ title: { nope: true } });
            expect(res.status).toBe(400);
        });

        it("rejects PUT /pieces with invalid tags", async () => {
            const createRes = await request(app)
                .post("/pieces")
                .send({ content: "Original content", tags: ["old"] });

            const res = await request(app)
                .put(`/pieces/${createRes.body.id}`)
                .send({ tags: ["good", 123] });
            expect(res.status).toBe(400);
        });

        it("rejects POST /query with missing query", async () => {
            const res = await request(app).post("/query").send({});
            expect(res.status).toBe(400);
        });

        it("rejects POST /query with non-string query", async () => {
            const res = await request(app)
                .post("/query")
                .send({ query: true });
            expect(res.status).toBe(400);
        });

        it("rejects POST /query with invalid tags", async () => {
            const res = await request(app)
                .post("/query")
                .send({ query: "test", tags: ["good", 123] });
            expect(res.status).toBe(400);
        });

        it("rejects POST /query with invalid topK", async () => {
            const res = await request(app)
                .post("/query")
                .send({ query: "test", topK: 0 });
            expect(res.status).toBe(400);
        });

        it("rejects POST /rag with missing query", async () => {
            const res = await request(app).post("/rag").send({});
            expect(res.status).toBe(400);
        });

        it("rejects POST /rag with non-string query", async () => {
            const res = await request(app)
                .post("/rag")
                .send({ query: 123 });
            expect(res.status).toBe(400);
        });

        it("rejects POST /rag with invalid tags", async () => {
            const res = await request(app)
                .post("/rag")
                .send({ query: "test", tags: ["good", 123] });
            expect(res.status).toBe(400);
        });

        it("rejects POST /rag with invalid topK", async () => {
            const res = await request(app)
                .post("/rag")
                .send({ query: "test", topK: -1 });
            expect(res.status).toBe(400);
        });
    });

    // -------------------------------------------------------------------
    // Edge Cases
    // -------------------------------------------------------------------

    describe("edge cases", () => {
        it("handles piece with empty tags", async () => {
            const res = await request(app)
                .post("/pieces")
                .send({ content: "No tags at all", tags: [] });

            expect(res.status).toBe(201);
            expect(res.body.tags).toEqual([]);
        });

        it("handles piece with no tags field (defaults to empty)", async () => {
            const res = await request(app)
                .post("/pieces")
                .send({ content: "Tags omitted" });

            expect(res.status).toBe(201);
            expect(res.body.tags).toEqual([]);
        });

        it("handles piece title when provided", async () => {
            const res = await request(app)
                .post("/pieces")
                .send({
                    title: "Unicode note",
                    content: "Tagged content",
                    tags: ["example"],
                });

            expect(res.status).toBe(201);
            expect(res.body.title).toBe("Unicode note");

            const getRes = await request(app).get(`/pieces/${res.body.id}`);
            expect(getRes.status).toBe(200);
            expect(getRes.body.title).toBe("Unicode note");
        });

        it("handles unicode content", async () => {
            const content = "日本語テスト — emoji 🚀";
            const res = await request(app)
                .post("/pieces")
                .send({ content, tags: ["unicode"] });

            expect(res.status).toBe(201);
            expect(res.body.content).toBe(content);

            // Verify retrieval
            const getRes = await request(app).get(
                `/pieces/${res.body.id}`,
            );
            expect(getRes.body.content).toBe(content);
        });

        it("handles update with only tags (no content)", async () => {
            const createRes = await request(app)
                .post("/pieces")
                .send({ content: "Original content", tags: ["old"] });

            const updateRes = await request(app)
                .put(`/pieces/${createRes.body.id}`)
                .send({ tags: ["new"] });

            expect(updateRes.status).toBe(200);
            expect(updateRes.body.content).toBe("Original content");
            expect(updateRes.body.tags).toEqual(["new"]);
        });

        it("clears title when update sends null", async () => {
            const createRes = await request(app)
                .post("/pieces")
                .send({
                    title: "Original title",
                    content: "Original content",
                    tags: ["old"],
                });

            const updateRes = await request(app)
                .put(`/pieces/${createRes.body.id}`)
                .send({ title: null });

            expect(updateRes.status).toBe(200);
            expect(updateRes.body).not.toHaveProperty("title");

            const getRes = await request(app).get(`/pieces/${createRes.body.id}`);
            expect(getRes.status).toBe(200);
            expect(getRes.body).not.toHaveProperty("title");
        });

        it("returns 404 for GET on nonexistent piece", async () => {
            const res = await request(app).get("/pieces/does-not-exist");
            expect(res.status).toBe(404);
        });

        it("returns 404 for PUT on nonexistent piece", async () => {
            const res = await request(app)
                .put("/pieces/does-not-exist")
                .send({ content: "x" });
            expect(res.status).toBe(404);
        });

        it("returns 204 for DELETE on nonexistent piece", async () => {
            const res = await request(app).delete("/pieces/does-not-exist");
            expect(res.status).toBe(204);
        });

        it("query returns empty array when collection is empty", async () => {
            const res = await request(app)
                .post("/query")
                .send({ query: "anything", topK: 5 });

            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });
    });

    // -------------------------------------------------------------------
    // Initialization
    // -------------------------------------------------------------------

    describe("initialization", () => {
        it("initializes ChromaDB collection on first request", async () => {
            await request(app).post("/query").send({ query: "test" });

            expect(mockGetOrCreateCollection).toHaveBeenCalledWith({
                name: "integration-test",
                metadata: { "hnsw:space": "cosine" },
            });
        });

        it("returns 503 when ChromaDB is unreachable", async () => {
            mockGetOrCreateCollection.mockRejectedValueOnce(
                new Error("ECONNREFUSED"),
            );

            const failApp = createServer();
            const res = await request(failApp).get("/pieces/any");

            expect(res.status).toBe(503);
            expect(res.body.error).toContain("Failed to connect to ChromaDB");
        });
    });

    // -------------------------------------------------------------------
    // Multi-Collection
    // -------------------------------------------------------------------

    describe("multi-collection", () => {
        it("isolates pieces between collections", async () => {
            // Add piece to default collection
            const defaultRes = await request(app)
                .post("/pieces")
                .send({ content: "Default piece", tags: ["default"] });
            expect(defaultRes.status).toBe(201);

            // Add piece to agent-alice collection
            const aliceRes = await request(app)
                .post("/pieces")
                .send({ content: "Alice piece", tags: ["alice"], collection: "agent-alice" });
            expect(aliceRes.status).toBe(201);

            // GET from default — should find the default piece
            const getDefault = await request(app).get(`/pieces/${defaultRes.body.id}`);
            expect(getDefault.status).toBe(200);
            expect(getDefault.body.content).toBe("Default piece");

            // GET from agent-alice — should find Alice's piece
            const getAlice = await request(app).get(`/pieces/${aliceRes.body.id}?collection=agent-alice`);
            expect(getAlice.status).toBe(200);
            expect(getAlice.body.content).toBe("Alice piece");

            // GET Alice's piece from default collection — should NOT find it
            const crossGet = await request(app).get(`/pieces/${aliceRes.body.id}`);
            expect(crossGet.status).toBe(404);
        });

        it("searches within the specified collection only", async () => {
            await request(app)
                .post("/pieces")
                .send({ content: "TypeScript is great", tags: ["ts"] });

            await request(app)
                .post("/pieces")
                .send({ content: "Python is great", tags: ["py"], collection: "agent-bob" });

            // Query default collection
            const defaultResults = await request(app)
                .post("/query")
                .send({ query: "programming", topK: 10 });
            expect(defaultResults.status).toBe(200);
            expect(defaultResults.body.some((r: { piece: { content: string } }) =>
                r.piece.content.includes("TypeScript"),
            )).toBe(true);
            expect(defaultResults.body.some((r: { piece: { content: string } }) =>
                r.piece.content.includes("Python"),
            )).toBe(false);

            // Query agent-bob collection
            const bobResults = await request(app)
                .post("/query")
                .send({ query: "programming", topK: 10, collection: "agent-bob" });
            expect(bobResults.status).toBe(200);
            expect(bobResults.body.some((r: { piece: { content: string } }) =>
                r.piece.content.includes("Python"),
            )).toBe(true);
            expect(bobResults.body.some((r: { piece: { content: string } }) =>
                r.piece.content.includes("TypeScript"),
            )).toBe(false);
        });

        it("lists all collections", async () => {
            // Access a second collection to create it
            await request(app)
                .post("/pieces")
                .send({ content: "test", tags: [], collection: "agent-alice" });

            const res = await request(app).get("/collections");
            expect(res.status).toBe(200);
            expect(res.body.collections).toContain("integration-test");
            expect(res.body.collections).toContain("agent-alice");
        });

        it("deletes a collection", async () => {
            // Create a collection
            await request(app)
                .post("/pieces")
                .send({ content: "temp", tags: [], collection: "to-delete" });

            // Verify it exists
            let listRes = await request(app).get("/collections");
            expect(listRes.body.collections).toContain("to-delete");

            // Delete it
            const deleteRes = await request(app).delete("/collections/to-delete");
            expect(deleteRes.status).toBe(204);

            // Verify it's gone
            listRes = await request(app).get("/collections");
            expect(listRes.body.collections).not.toContain("to-delete");
        });

        it("updates a piece in a specific collection", async () => {
            const createRes = await request(app)
                .post("/pieces")
                .send({ content: "Original", tags: ["x"], collection: "agent-alice" });

            const updateRes = await request(app)
                .put(`/pieces/${createRes.body.id}`)
                .send({ content: "Updated", collection: "agent-alice" });

            expect(updateRes.status).toBe(200);
            expect(updateRes.body.content).toBe("Updated");
        });

        it("deletes a piece from a specific collection", async () => {
            const createRes = await request(app)
                .post("/pieces")
                .send({ content: "To delete", tags: [], collection: "agent-alice" });

            const deleteRes = await request(app)
                .delete(`/pieces/${createRes.body.id}?collection=agent-alice`);
            expect(deleteRes.status).toBe(204);

            const getRes = await request(app)
                .get(`/pieces/${createRes.body.id}?collection=agent-alice`);
            expect(getRes.status).toBe(404);
        });

        it("RAG query targets the specified collection", async () => {
            await request(app)
                .post("/pieces")
                .send({ content: "RAG info for Alice's agent", tags: ["ai"], collection: "agent-alice" });

            const res = await request(app)
                .post("/rag")
                .send({ query: "RAG", topK: 5, collection: "agent-alice" });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("answer");
            expect(res.body.sources.length).toBeGreaterThan(0);
            expect(res.body.sources[0].piece.content).toContain("Alice");
        });
    });
});
