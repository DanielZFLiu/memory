import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAdd = vi.fn();
const mockGet = vi.fn();
const mockDelete = vi.fn();
const mockUpdate = vi.fn();
const mockQuery = vi.fn();

const tagKey = (tag: string) => `tag_${Buffer.from(tag, "utf8").toString("base64url")}`;

const mockCollection = {
    add: mockAdd,
    get: mockGet,
    delete: mockDelete,
    update: mockUpdate,
    query: mockQuery,
};

const mockGetOrCreateCollection = vi.fn().mockResolvedValue(mockCollection);
const mockListCollections = vi.fn().mockResolvedValue([]);
const mockDeleteCollection = vi.fn().mockResolvedValue(undefined);

vi.mock("chromadb", () => ({
    ChromaClient: class MockChromaClient {
        getOrCreateCollection = mockGetOrCreateCollection;
        listCollections = mockListCollections;
        deleteCollection = mockDeleteCollection;
    },
    Collection: class {},
    IncludeEnum: {
        Documents: "documents",
        Metadatas: "metadatas",
        Distances: "distances",
    },
}));

const mockEmbed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);

vi.mock("../../src/embeddings", () => ({
    EmbeddingClient: class MockEmbeddingClient {
        embed = mockEmbed;
    },
}));

vi.mock("uuid", () => ({
    v4: vi.fn().mockReturnValue("test-uuid-1234"),
}));

import { PieceStore } from "../../src/store";

describe("PieceStore", () => {
    let store: PieceStore;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockGetOrCreateCollection.mockResolvedValue(mockCollection);
        mockListCollections.mockResolvedValue([]);
        mockDeleteCollection.mockResolvedValue(undefined);
        mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);

        store = new PieceStore({
            chromaUrl: "http://localhost:8000",
            ollamaUrl: "http://localhost:11434",
            embeddingModel: "test-embed",
            collectionName: "test-pieces",
        });
        await store.init();
    });

    describe("constructor", () => {
        it("applies default config when no options provided", () => {
            const defaultStore = new PieceStore();
            // Should not throw — defaults are applied internally
            expect(defaultStore).toBeInstanceOf(PieceStore);
        });

        it("merges partial config with defaults", () => {
            const partialStore = new PieceStore({
                collectionName: "custom",
            });
            expect(partialStore).toBeInstanceOf(PieceStore);
        });
    });

    describe("init", () => {
        it("creates or gets the collection with cosine distance", async () => {
            expect(mockGetOrCreateCollection).toHaveBeenCalledWith({
                name: "test-pieces",
                metadata: { "hnsw:space": "cosine" },
            });
        });

        it("propagates errors from ChromaDB", async () => {
            mockGetOrCreateCollection.mockRejectedValueOnce(
                new Error("ChromaDB unreachable"),
            );
            const freshStore = new PieceStore();

            await expect(freshStore.init()).rejects.toThrow(
                "ChromaDB unreachable",
            );
        });
    });

    describe("addPiece", () => {
        it("embeds content and stores in ChromaDB with encoded tags", async () => {
            mockAdd.mockResolvedValueOnce(undefined);

            const piece = await store.addPiece("Hello world", [
                "greeting",
                "test",
            ]);

            expect(piece).toEqual({
                id: "test-uuid-1234",
                content: "Hello world",
                tags: ["greeting", "test"],
            });

            expect(mockEmbed).toHaveBeenCalledWith("Hello world");
            expect(mockAdd).toHaveBeenCalledWith({
                ids: ["test-uuid-1234"],
                embeddings: [[0.1, 0.2, 0.3]],
                documents: ["Hello world"],
                metadatas: [
                    expect.objectContaining({
                        tags: '["greeting","test"]',
                        [tagKey("greeting")]: true,
                        [tagKey("test")]: true,
                    }),
                ],
            });
        });

        it("handles empty tags", async () => {
            mockAdd.mockResolvedValueOnce(undefined);

            const piece = await store.addPiece("No tags", []);

            expect(piece.tags).toEqual([]);
            expect(mockAdd).toHaveBeenCalledWith(
                expect.objectContaining({
                    metadatas: [expect.objectContaining({ tags: "[]" })],
                }),
            );
        });

        it("stores and returns title when provided", async () => {
            mockAdd.mockResolvedValueOnce(undefined);

            const piece = await store.addPiece(
                "Hello world",
                ["greeting"],
                "Greeting note",
            );

            expect(piece).toEqual({
                id: "test-uuid-1234",
                content: "Hello world",
                title: "Greeting note",
                tags: ["greeting"],
            });
            expect(mockEmbed).toHaveBeenCalledWith("Greeting note\n\nHello world");
            expect(mockAdd).toHaveBeenCalledWith(
                expect.objectContaining({
                    metadatas: [
                        expect.objectContaining({
                            tags: '["greeting"]',
                            [tagKey("greeting")]: true,
                            title: "Greeting note",
                        }),
                    ],
                }),
            );
        });

        it("generates a unique UUID for each piece", async () => {
            mockAdd.mockResolvedValueOnce(undefined);

            const piece = await store.addPiece("content", ["tag"]);

            expect(piece.id).toBe("test-uuid-1234");
        });

        it("propagates embedding errors", async () => {
            mockEmbed.mockRejectedValueOnce(new Error("Ollama down"));

            await expect(
                store.addPiece("will fail", ["tag"]),
            ).rejects.toThrow("Ollama down");
            expect(mockAdd).not.toHaveBeenCalled();
        });

        it("propagates ChromaDB add errors", async () => {
            mockAdd.mockRejectedValueOnce(new Error("Collection full"));

            await expect(
                store.addPiece("will fail", ["tag"]),
            ).rejects.toThrow("Collection full");
        });
    });

    describe("getPiece", () => {
        it("returns piece when found", async () => {
            mockGet.mockResolvedValueOnce({
                ids: ["id-1"],
                documents: ["Some content"],
                metadatas: [{ tags: ["python", "rag"] }],
            });

            const piece = await store.getPiece("id-1");

            expect(piece).toEqual({
                id: "id-1",
                content: "Some content",
                tags: ["python", "rag"],
            });
        });

        it("passes correct include parameters", async () => {
            mockGet.mockResolvedValueOnce({
                ids: ["id-1"],
                documents: ["content"],
                metadatas: [{ tags: [] }],
            });

            await store.getPiece("id-1");

            expect(mockGet).toHaveBeenCalledWith({
                ids: ["id-1"],
                include: ["documents", "metadatas"],
            });
        });

        it("returns null when not found", async () => {
            mockGet.mockResolvedValueOnce({
                ids: [],
                documents: [],
                metadatas: [],
            });

            const piece = await store.getPiece("nonexistent");
            expect(piece).toBeNull();
        });

        it("handles null document gracefully", async () => {
            mockGet.mockResolvedValueOnce({
                ids: ["id-1"],
                documents: [null],
                metadatas: [{ tags: ["test"] }],
            });

            const piece = await store.getPiece("id-1");
            expect(piece?.content).toBe("");
        });

        it("handles null metadata gracefully", async () => {
            mockGet.mockResolvedValueOnce({
                ids: ["id-1"],
                documents: ["content"],
                metadatas: [null],
            });

            const piece = await store.getPiece("id-1");
            expect(piece?.tags).toEqual([]);
        });

        it("returns title when present in metadata", async () => {
            mockGet.mockResolvedValueOnce({
                ids: ["id-1"],
                documents: ["Some content"],
                metadatas: [{ tags: ["python"], title: "Python note" }],
            });

            const piece = await store.getPiece("id-1");

            expect(piece).toEqual({
                id: "id-1",
                content: "Some content",
                title: "Python note",
                tags: ["python"],
            });
        });

        it("propagates ChromaDB errors", async () => {
            mockGet.mockRejectedValueOnce(new Error("DB error"));

            await expect(store.getPiece("id-1")).rejects.toThrow("DB error");
        });
    });

    describe("deletePiece", () => {
        it("calls collection.delete with the correct id", async () => {
            mockDelete.mockResolvedValueOnce(undefined);

            await store.deletePiece("id-to-delete");

            expect(mockDelete).toHaveBeenCalledWith({ ids: ["id-to-delete"] });
        });

        it("propagates ChromaDB errors", async () => {
            mockDelete.mockRejectedValueOnce(new Error("Delete failed"));

            await expect(store.deletePiece("id-1")).rejects.toThrow(
                "Delete failed",
            );
        });
    });

    describe("updatePiece", () => {
        it("updates content and re-embeds", async () => {
            mockGet.mockResolvedValueOnce({
                ids: ["id-1"],
                documents: ["Old content"],
                metadatas: [{ tags: '["old"]' }],
            });
            mockUpdate.mockResolvedValueOnce(undefined);

            const result = await store.updatePiece("id-1", "New content", [
                "new",
            ]);

            expect(result).toEqual({
                id: "id-1",
                content: "New content",
                tags: ["new"],
            });
            expect(mockEmbed).toHaveBeenCalledWith("New content");
            expect(mockUpdate).toHaveBeenCalledWith({
                ids: ["id-1"],
                documents: ["New content"],
                embeddings: [[0.1, 0.2, 0.3]],
                metadatas: [
                    expect.objectContaining({
                        tags: '["new"]',
                        [tagKey("new")]: true,
                    }),
                ],
            });
        });

        it("updates only tags without re-embedding when content is undefined", async () => {
            mockGet.mockResolvedValueOnce({
                ids: ["id-1"],
                documents: ["Existing content"],
                metadatas: [{ tags: '["old"]' }],
            });
            mockUpdate.mockResolvedValueOnce(undefined);

            const result = await store.updatePiece("id-1", undefined, [
                "newtag",
            ]);

            expect(result).toEqual({
                id: "id-1",
                content: "Existing content",
                tags: ["newtag"],
            });
            expect(mockEmbed).not.toHaveBeenCalled();
            expect(mockUpdate).toHaveBeenCalledWith({
                ids: ["id-1"],
                metadatas: [
                    expect.objectContaining({
                        tags: '["newtag"]',
                        [tagKey("newtag")]: true,
                    }),
                ],
            });
        });

        it("updates only content and preserves existing tags", async () => {
            mockGet.mockResolvedValueOnce({
                ids: ["id-1"],
                documents: ["Old content"],
                metadatas: [{ tags: '["keep-me"]' }],
            });
            mockUpdate.mockResolvedValueOnce(undefined);

            const result = await store.updatePiece("id-1", "New content");

            expect(result).toEqual({
                id: "id-1",
                content: "New content",
                tags: ["keep-me"],
            });
            expect(mockEmbed).toHaveBeenCalledWith("New content");
            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    documents: ["New content"],
                    embeddings: [[0.1, 0.2, 0.3]],
                    metadatas: [
                        expect.objectContaining({
                            tags: '["keep-me"]',
                            [tagKey("keep-me")]: true,
                        }),
                    ],
                }),
            );
        });

        it("updates title and re-embeds when only title changes", async () => {
            mockGet.mockResolvedValueOnce({
                ids: ["id-1"],
                documents: ["Existing content"],
                metadatas: [{ tags: '["keep-me"]', title: "Old title" }],
            });
            mockUpdate.mockResolvedValueOnce(undefined);

            const result = await store.updatePiece(
                "id-1",
                undefined,
                undefined,
                "New title",
            );

            expect(result).toEqual({
                id: "id-1",
                content: "Existing content",
                title: "New title",
                tags: ["keep-me"],
            });
            expect(mockEmbed).toHaveBeenCalledWith("New title\n\nExisting content");
            expect(mockUpdate).toHaveBeenCalledWith({
                ids: ["id-1"],
                embeddings: [[0.1, 0.2, 0.3]],
                metadatas: [
                    expect.objectContaining({
                        tags: '["keep-me"]',
                        [tagKey("keep-me")]: true,
                        title: "New title",
                    }),
                ],
            });
        });

        it("clears title when null is provided", async () => {
            mockGet.mockResolvedValueOnce({
                ids: ["id-1"],
                documents: ["Existing content"],
                metadatas: [{ tags: '["keep-me"]', title: "Old title" }],
            });
            mockUpdate.mockResolvedValueOnce(undefined);

            const result = await store.updatePiece(
                "id-1",
                undefined,
                undefined,
                null,
            );

            expect(result).toEqual({
                id: "id-1",
                content: "Existing content",
                tags: ["keep-me"],
            });
            expect(mockEmbed).toHaveBeenCalledWith("Existing content");
            expect(mockUpdate).toHaveBeenCalledWith({
                ids: ["id-1"],
                embeddings: [[0.1, 0.2, 0.3]],
                metadatas: [
                    expect.objectContaining({
                        tags: '["keep-me"]',
                        [tagKey("keep-me")]: true,
                    }),
                ],
            });
            expect(mockUpdate.mock.calls[0][0].metadatas[0]).not.toHaveProperty("title");
        });

        it("preserves title in the embedding when content changes", async () => {
            mockGet.mockResolvedValueOnce({
                ids: ["id-1"],
                documents: ["Old content"],
                metadatas: [{ tags: '["keep-me"]', title: "Existing title" }],
            });
            mockUpdate.mockResolvedValueOnce(undefined);

            await store.updatePiece("id-1", "New content");

            expect(mockEmbed).toHaveBeenCalledWith("Existing title\n\nNew content");
        });

        it("returns null if piece does not exist", async () => {
            mockGet.mockResolvedValueOnce({
                ids: [],
                documents: [],
                metadatas: [],
            });

            const result = await store.updatePiece("nonexistent", "content");
            expect(result).toBeNull();
            expect(mockUpdate).not.toHaveBeenCalled();
        });

        it("propagates embedding errors during content update", async () => {
            mockGet.mockResolvedValueOnce({
                ids: ["id-1"],
                documents: ["Old"],
                metadatas: [{ tags: "[]" }],
            });
            mockEmbed.mockRejectedValueOnce(new Error("Embed failed"));

            await expect(
                store.updatePiece("id-1", "New content"),
            ).rejects.toThrow("Embed failed");
            expect(mockUpdate).not.toHaveBeenCalled();
        });

        it("propagates ChromaDB update errors", async () => {
            mockGet.mockResolvedValueOnce({
                ids: ["id-1"],
                documents: ["Old"],
                metadatas: [{ tags: "[]" }],
            });
            mockUpdate.mockRejectedValueOnce(new Error("Update failed"));

            await expect(
                store.updatePiece("id-1", undefined, ["tag"]),
            ).rejects.toThrow("Update failed");
        });
    });

    describe("queryPieces", () => {
        it("returns scored results from semantic search", async () => {
            mockQuery.mockResolvedValueOnce({
                ids: [["id-1", "id-2"]],
                documents: [["Doc one", "Doc two"]],
                metadatas: [[{ tags: ["a"], title: "Doc A" }, { tags: ["b"] }]],
                distances: [[0.2, 0.5]],
            });

            const results = await store.queryPieces("search text");

            expect(results).toHaveLength(2);
            expect(results[0]).toEqual({
                piece: {
                    id: "id-1",
                    content: "Doc one",
                    title: "Doc A",
                    tags: ["a"],
                },
                score: 0.8, // 1 - 0.2
            });
            expect(results[1]).toEqual({
                piece: { id: "id-2", content: "Doc two", tags: ["b"] },
                score: 0.5, // 1 - 0.5
            });
        });

        it("embeds the query text for vector search", async () => {
            mockQuery.mockResolvedValueOnce({
                ids: [[]],
                documents: [[]],
                metadatas: [[]],
                distances: [[]],
            });

            await store.queryPieces("my search query");

            expect(mockEmbed).toHaveBeenCalledWith("my search query");
        });

        it("passes correct include parameters", async () => {
            mockQuery.mockResolvedValueOnce({
                ids: [[]],
                documents: [[]],
                metadatas: [[]],
                distances: [[]],
            });

            await store.queryPieces("test");

            expect(mockQuery).toHaveBeenCalledWith(
                expect.objectContaining({
                    include: ["documents", "metadatas", "distances"],
                }),
            );
        });

        it("passes topK to nResults", async () => {
            mockQuery.mockResolvedValueOnce({
                ids: [[]],
                documents: [[]],
                metadatas: [[]],
                distances: [[]],
            });

            await store.queryPieces("test", { topK: 3 });

            expect(mockQuery).toHaveBeenCalledWith(
                expect.objectContaining({ nResults: 3 }),
            );
        });

        it("builds single-tag where clause", async () => {
            mockQuery.mockResolvedValueOnce({
                ids: [[]],
                documents: [[]],
                metadatas: [[]],
                distances: [[]],
            });

            await store.queryPieces("test", { tags: ["python"] });

            expect(mockQuery).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { [tagKey("python")]: true },
                }),
            );
        });

        it("builds multi-tag $and where clause", async () => {
            mockQuery.mockResolvedValueOnce({
                ids: [[]],
                documents: [[]],
                metadatas: [[]],
                distances: [[]],
            });

            await store.queryPieces("test", { tags: ["python", "rag"] });

            expect(mockQuery).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        $and: [
                            { [tagKey("python")]: true },
                            { [tagKey("rag")]: true },
                        ],
                    },
                }),
            );
        });

        it("passes no where clause when tags are empty", async () => {
            mockQuery.mockResolvedValueOnce({
                ids: [[]],
                documents: [[]],
                metadatas: [[]],
                distances: [[]],
            });

            await store.queryPieces("test", { tags: [] });

            expect(mockQuery).toHaveBeenCalledWith(
                expect.objectContaining({ where: undefined }),
            );
        });

        it("defaults topK to 10", async () => {
            mockQuery.mockResolvedValueOnce({
                ids: [[]],
                documents: [[]],
                metadatas: [[]],
                distances: [[]],
            });

            await store.queryPieces("test");

            expect(mockQuery).toHaveBeenCalledWith(
                expect.objectContaining({ nResults: 10 }),
            );
        });

        it("returns empty array when no results", async () => {
            mockQuery.mockResolvedValueOnce({
                ids: [[]],
                documents: [[]],
                metadatas: [[]],
                distances: [[]],
            });

            const results = await store.queryPieces("nothing here");

            expect(results).toEqual([]);
        });

        it("handles null documents in results gracefully", async () => {
            mockQuery.mockResolvedValueOnce({
                ids: [["id-1"]],
                documents: [[null]],
                metadatas: [[{ tags: ["a"] }]],
                distances: [[0.1]],
            });

            const results = await store.queryPieces("test");

            expect(results[0].piece.content).toBe("");
        });

        it("handles missing distances gracefully", async () => {
            mockQuery.mockResolvedValueOnce({
                ids: [["id-1"]],
                documents: [["Doc"]],
                metadatas: [[{ tags: [] }]],
                distances: undefined,
            });

            const results = await store.queryPieces("test");

            expect(results[0].score).toBe(1); // 1 - 0 (default)
        });

        it("propagates embedding errors", async () => {
            mockEmbed.mockRejectedValueOnce(new Error("Embed failed"));

            await expect(store.queryPieces("test")).rejects.toThrow(
                "Embed failed",
            );
            expect(mockQuery).not.toHaveBeenCalled();
        });

        it("propagates ChromaDB query errors", async () => {
            mockQuery.mockRejectedValueOnce(new Error("Query failed"));

            await expect(store.queryPieces("test")).rejects.toThrow(
                "Query failed",
            );
        });

        describe("hybrid search", () => {
            it("over-fetches 3x topK when hybrid search is enabled", async () => {
                mockQuery.mockResolvedValueOnce({
                    ids: [[]],
                    documents: [[]],
                    metadatas: [[]],
                    distances: [[]],
                });

                await store.queryPieces("test", { topK: 5, useHybridSearch: true });

                expect(mockQuery).toHaveBeenCalledWith(
                    expect.objectContaining({ nResults: 15 }),
                );
            });

            it("does not over-fetch when hybrid search is disabled", async () => {
                mockQuery.mockResolvedValueOnce({
                    ids: [[]],
                    documents: [[]],
                    metadatas: [[]],
                    distances: [[]],
                });

                await store.queryPieces("test", { topK: 5, useHybridSearch: false });

                expect(mockQuery).toHaveBeenCalledWith(
                    expect.objectContaining({ nResults: 5 }),
                );
            });

            it("boosts results that match query keywords", async () => {
                mockQuery.mockResolvedValueOnce({
                    ids: [["id-1", "id-2", "id-3"]],
                    documents: [
                        [
                            "Semantically similar but no keyword overlap",
                            "TypeScript is a typed language",
                            "Another document without keywords",
                        ],
                    ],
                    metadatas: [[{ tags: ["a"] }, { tags: ["b"] }, { tags: ["c"] }]],
                    distances: [[0.1, 0.2, 0.3]],
                });

                const results = await store.queryPieces("TypeScript typed", {
                    topK: 3,
                    useHybridSearch: true,
                });

                expect(results).toHaveLength(3);
                // id-2 contains both "TypeScript" and "typed", should be ranked higher
                // than id-1 which has better vector score but no keyword match
                const ids = results.map((r) => r.piece.id);
                expect(ids.indexOf("id-2")).toBeLessThan(ids.indexOf("id-3"));
            });

            it("returns at most topK results after fusion", async () => {
                mockQuery.mockResolvedValueOnce({
                    ids: [["id-1", "id-2", "id-3", "id-4", "id-5", "id-6"]],
                    documents: [["A", "B", "C", "D", "E", "F"]],
                    metadatas: [
                        [
                            { tags: [] },
                            { tags: [] },
                            { tags: [] },
                            { tags: [] },
                            { tags: [] },
                            { tags: [] },
                        ],
                    ],
                    distances: [[0.1, 0.2, 0.3, 0.4, 0.5, 0.6]],
                });

                const results = await store.queryPieces("test", {
                    topK: 2,
                    useHybridSearch: true,
                });

                expect(results).toHaveLength(2);
            });

            it("returns RRF scores instead of cosine similarity when hybrid is enabled", async () => {
                mockQuery.mockResolvedValueOnce({
                    ids: [["id-1"]],
                    documents: [["Some content"]],
                    metadatas: [[{ tags: [] }]],
                    distances: [[0.2]],
                });

                const results = await store.queryPieces("content", {
                    topK: 5,
                    useHybridSearch: true,
                });

                expect(results).toHaveLength(1);
                // RRF score is not 1 - distance; it's 1/(k+rank) based
                expect(results[0].score).not.toBe(0.8);
            });

            it("includes title in keyword matching", async () => {
                mockQuery.mockResolvedValueOnce({
                    ids: [["id-1", "id-2"]],
                    documents: [
                        ["generic body text", "generic body text"],
                    ],
                    metadatas: [
                        [
                            { tags: ["a"], title: "ChromaDB guide" },
                            { tags: ["b"] },
                        ],
                    ],
                    distances: [[0.3, 0.1]],
                });

                const results = await store.queryPieces("ChromaDB", {
                    topK: 2,
                    useHybridSearch: true,
                });

                // id-1 has "ChromaDB" in title, so should be boosted despite worse vector score
                expect(results[0].piece.id).toBe("id-1");
            });

            it("returns empty array when no results even with hybrid enabled", async () => {
                mockQuery.mockResolvedValueOnce({
                    ids: [[]],
                    documents: [[]],
                    metadatas: [[]],
                    distances: [[]],
                });

                const results = await store.queryPieces("nothing", {
                    useHybridSearch: true,
                });

                expect(results).toEqual([]);
            });

            it("respects tag filters with hybrid search", async () => {
                mockQuery.mockResolvedValueOnce({
                    ids: [["id-1"]],
                    documents: [["Python document"]],
                    metadatas: [[{ tags: '["python"]' }]],
                    distances: [[0.2]],
                });

                await store.queryPieces("Python", {
                    tags: ["python"],
                    topK: 5,
                    useHybridSearch: true,
                });

                expect(mockQuery).toHaveBeenCalledWith(
                    expect.objectContaining({
                        where: { [tagKey("python")]: true },
                        nResults: 15,
                    }),
                );
            });
        });
    });

    describe("uninitialized guard", () => {
        it("throws when calling addPiece before init", async () => {
            const uninitializedStore = new PieceStore();

            await expect(
                uninitializedStore.addPiece("test", []),
            ).rejects.toThrow("PieceStore not initialized. Call init() first.");
        });

        it("throws when calling getPiece before init", async () => {
            const uninitializedStore = new PieceStore();

            await expect(
                uninitializedStore.getPiece("id"),
            ).rejects.toThrow("PieceStore not initialized. Call init() first.");
        });

        it("throws when calling deletePiece before init", async () => {
            const uninitializedStore = new PieceStore();

            await expect(
                uninitializedStore.deletePiece("id"),
            ).rejects.toThrow("PieceStore not initialized. Call init() first.");
        });

        it("throws when calling updatePiece before init", async () => {
            const uninitializedStore = new PieceStore();

            await expect(
                uninitializedStore.updatePiece("id", "content"),
            ).rejects.toThrow("PieceStore not initialized. Call init() first.");
        });

        it("throws when calling queryPieces before init", async () => {
            const uninitializedStore = new PieceStore();

            await expect(
                uninitializedStore.queryPieces("query"),
            ).rejects.toThrow("PieceStore not initialized. Call init() first.");
        });

        it("throws when calling listCollections before init", async () => {
            const uninitializedStore = new PieceStore();

            await expect(
                uninitializedStore.listCollections(),
            ).rejects.toThrow("PieceStore not initialized. Call init() first.");
        });

        it("throws when calling deleteCollection before init", async () => {
            const uninitializedStore = new PieceStore();

            await expect(
                uninitializedStore.deleteCollection("test"),
            ).rejects.toThrow("PieceStore not initialized. Call init() first.");
        });
    });

    describe("multi-collection", () => {
        it("uses default collection when no collection param is provided", async () => {
            mockAdd.mockResolvedValueOnce(undefined);

            await store.addPiece("Hello", ["tag"]);

            expect(mockGetOrCreateCollection).toHaveBeenCalledWith({
                name: "test-pieces",
                metadata: { "hnsw:space": "cosine" },
            });
        });

        it("creates and caches a new collection when collection param is provided", async () => {
            const altCollection = {
                add: vi.fn().mockResolvedValue(undefined),
                get: vi.fn(),
                delete: vi.fn(),
                update: vi.fn(),
                query: vi.fn(),
            };
            mockGetOrCreateCollection.mockResolvedValueOnce(altCollection);

            await store.addPiece("Hello", ["tag"], undefined, "agent-alice");

            expect(mockGetOrCreateCollection).toHaveBeenCalledWith({
                name: "agent-alice",
                metadata: { "hnsw:space": "cosine" },
            });
            expect(altCollection.add).toHaveBeenCalled();
            expect(mockAdd).not.toHaveBeenCalled();
        });

        it("reuses cached collection on subsequent calls", async () => {
            const altCollection = {
                add: vi.fn().mockResolvedValue(undefined),
                get: vi.fn(),
                delete: vi.fn(),
                update: vi.fn(),
                query: vi.fn(),
            };
            mockGetOrCreateCollection.mockResolvedValueOnce(altCollection);

            await store.addPiece("First", ["tag"], undefined, "agent-alice");
            await store.addPiece("Second", ["tag"], undefined, "agent-alice");

            // getOrCreateCollection called once during init (default) + once for agent-alice
            // The second addPiece to agent-alice should reuse the cached collection
            const aliceCalls = mockGetOrCreateCollection.mock.calls.filter(
                (call: unknown[]) => (call[0] as { name: string }).name === "agent-alice",
            );
            expect(aliceCalls).toHaveLength(1);
            expect(altCollection.add).toHaveBeenCalledTimes(2);
        });

        it("isolates operations between collections", async () => {
            const altCollection = {
                add: vi.fn().mockResolvedValue(undefined),
                get: vi.fn().mockResolvedValue({
                    ids: ["alt-id"],
                    documents: ["Alt content"],
                    metadatas: [{ tags: '["alt"]' }],
                }),
                delete: vi.fn(),
                update: vi.fn(),
                query: vi.fn(),
            };
            mockGetOrCreateCollection.mockResolvedValueOnce(altCollection);

            mockGet.mockResolvedValueOnce({
                ids: ["default-id"],
                documents: ["Default content"],
                metadatas: [{ tags: '["default"]' }],
            });

            const defaultPiece = await store.getPiece("default-id");
            const altPiece = await store.getPiece("alt-id", "agent-alice");

            expect(mockGet).toHaveBeenCalledWith({
                ids: ["default-id"],
                include: ["documents", "metadatas"],
            });
            expect(altCollection.get).toHaveBeenCalledWith({
                ids: ["alt-id"],
                include: ["documents", "metadatas"],
            });
            expect(defaultPiece?.content).toBe("Default content");
            expect(altPiece?.content).toBe("Alt content");
        });

        it("passes collection param through to deletePiece", async () => {
            const altCollection = {
                add: vi.fn(),
                get: vi.fn(),
                delete: vi.fn().mockResolvedValue(undefined),
                update: vi.fn(),
                query: vi.fn(),
            };
            mockGetOrCreateCollection.mockResolvedValueOnce(altCollection);

            await store.deletePiece("some-id", "agent-alice");

            expect(altCollection.delete).toHaveBeenCalledWith({ ids: ["some-id"] });
            expect(mockDelete).not.toHaveBeenCalled();
        });

        it("passes collection param through to queryPieces", async () => {
            const altCollection = {
                add: vi.fn(),
                get: vi.fn(),
                delete: vi.fn(),
                update: vi.fn(),
                query: vi.fn().mockResolvedValue({
                    ids: [[]],
                    documents: [[]],
                    metadatas: [[]],
                    distances: [[]],
                }),
            };
            mockGetOrCreateCollection.mockResolvedValueOnce(altCollection);

            await store.queryPieces("test", {}, "agent-alice");

            expect(altCollection.query).toHaveBeenCalled();
            expect(mockQuery).not.toHaveBeenCalled();
        });
    });

    describe("listCollections", () => {
        it("returns collection names from ChromaDB", async () => {
            mockListCollections.mockResolvedValueOnce(["pieces", "agent-alice", "agent-bob"]);

            const result = await store.listCollections();

            expect(result).toEqual(["pieces", "agent-alice", "agent-bob"]);
            expect(mockListCollections).toHaveBeenCalledTimes(1);
        });

        it("returns empty array when no collections exist", async () => {
            mockListCollections.mockResolvedValueOnce([]);

            const result = await store.listCollections();

            expect(result).toEqual([]);
        });

        it("propagates ChromaDB errors", async () => {
            mockListCollections.mockRejectedValueOnce(new Error("DB error"));

            await expect(store.listCollections()).rejects.toThrow("DB error");
        });
    });

    describe("deleteCollection", () => {
        it("deletes the collection from ChromaDB", async () => {
            await store.deleteCollection("agent-alice");

            expect(mockDeleteCollection).toHaveBeenCalledWith({ name: "agent-alice" });
        });

        it("removes collection from cache after deletion", async () => {
            const altCollection = {
                add: vi.fn().mockResolvedValue(undefined),
                get: vi.fn(),
                delete: vi.fn(),
                update: vi.fn(),
                query: vi.fn(),
            };
            mockGetOrCreateCollection.mockResolvedValueOnce(altCollection);

            // Access to populate cache
            await store.addPiece("Hello", [], undefined, "agent-alice");

            // Delete the collection
            await store.deleteCollection("agent-alice");

            // Next access should call getOrCreateCollection again
            const newAltCollection = {
                add: vi.fn().mockResolvedValue(undefined),
                get: vi.fn(),
                delete: vi.fn(),
                update: vi.fn(),
                query: vi.fn(),
            };
            mockGetOrCreateCollection.mockResolvedValueOnce(newAltCollection);

            await store.addPiece("Hello again", [], undefined, "agent-alice");

            const aliceCalls = mockGetOrCreateCollection.mock.calls.filter(
                (call: unknown[]) => (call[0] as { name: string }).name === "agent-alice",
            );
            expect(aliceCalls).toHaveLength(2);
        });

        it("propagates ChromaDB errors", async () => {
            mockDeleteCollection.mockRejectedValueOnce(new Error("Delete failed"));

            await expect(store.deleteCollection("test")).rejects.toThrow("Delete failed");
        });
    });
});
