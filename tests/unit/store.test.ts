import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAdd = vi.fn();
const mockGet = vi.fn();
const mockDelete = vi.fn();
const mockUpdate = vi.fn();
const mockQuery = vi.fn();

const mockCollection = {
    add: mockAdd,
    get: mockGet,
    delete: mockDelete,
    update: mockUpdate,
    query: mockQuery,
};

const mockGetOrCreateCollection = vi.fn().mockResolvedValue(mockCollection);

vi.mock("chromadb", () => ({
    ChromaClient: class MockChromaClient {
        getOrCreateCollection = mockGetOrCreateCollection;
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
                metadatas: [expect.objectContaining({ tags: ["greeting", "test"] })],
            });
        });

        it("handles empty tags", async () => {
            mockAdd.mockResolvedValueOnce(undefined);

            const piece = await store.addPiece("No tags", []);

            expect(piece.tags).toEqual([]);
            expect(mockAdd).toHaveBeenCalledWith(
                expect.objectContaining({
                    metadatas: [expect.objectContaining({ tags: [] })],
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
                metadatas: [{ tags: ["old"] }],
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
                metadatas: [expect.objectContaining({ tags: ["new"] })],
            });
        });

        it("updates only tags without re-embedding when content is undefined", async () => {
            mockGet.mockResolvedValueOnce({
                ids: ["id-1"],
                documents: ["Existing content"],
                metadatas: [{ tags: ["old"] }],
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
                metadatas: [expect.objectContaining({ tags: ["newtag"] })],
            });
        });

        it("updates only content and preserves existing tags", async () => {
            mockGet.mockResolvedValueOnce({
                ids: ["id-1"],
                documents: ["Old content"],
                metadatas: [{ tags: ["keep-me"] }],
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
                    metadatas: [expect.objectContaining({ tags: ["keep-me"] })],
                }),
            );
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
                metadatas: [{ tags: [] }],
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
                metadatas: [{ tags: [] }],
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
                metadatas: [[{ tags: ["a"] }, { tags: ["b"] }]],
                distances: [[0.2, 0.5]],
            });

            const results = await store.queryPieces("search text");

            expect(results).toHaveLength(2);
            expect(results[0]).toEqual({
                piece: { id: "id-1", content: "Doc one", tags: ["a"] },
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
                    where: { tags: { $contains: "python" } },
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
                            { tags: { $contains: "python" } },
                            { tags: { $contains: "rag" } },
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
    });
});
