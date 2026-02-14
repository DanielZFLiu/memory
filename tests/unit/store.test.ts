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

    describe("init", () => {
        it("creates or gets the collection with cosine distance", async () => {
            expect(mockGetOrCreateCollection).toHaveBeenCalledWith({
                name: "test-pieces",
                metadata: { "hnsw:space": "cosine" },
            });
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
    });

    describe("deletePiece", () => {
        it("calls collection.delete with the correct id", async () => {
            mockDelete.mockResolvedValueOnce(undefined);

            await store.deletePiece("id-to-delete");

            expect(mockDelete).toHaveBeenCalledWith({ ids: ["id-to-delete"] });
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

            // Only call with id and tags, content is undefined
            const result = await store.updatePiece("id-1", undefined, [
                "newtag",
            ]);

            expect(result).toEqual({
                id: "id-1",
                content: "Existing content",
                tags: ["newtag"],
            });
            // embed should only be called once during init/setup, not for this update
            expect(mockUpdate).toHaveBeenCalledWith({
                ids: ["id-1"],
                metadatas: [expect.objectContaining({ tags: ["newtag"] })],
            });
        });

        it("returns null if piece does not exist", async () => {
            mockGet.mockResolvedValueOnce({
                ids: [],
                documents: [],
                metadatas: [],
            });

            const result = await store.updatePiece("nonexistent", "content");
            expect(result).toBeNull();
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
    });

    describe("error handling", () => {
        it("throws when calling methods before init", async () => {
            const uninitializedStore = new PieceStore();

            await expect(
                uninitializedStore.addPiece("test", []),
            ).rejects.toThrow("PieceStore not initialized. Call init() first.");
        });
    });
});
