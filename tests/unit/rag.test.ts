import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();

vi.mock("ollama", () => ({
    Ollama: class MockOllama {
        chat = mockChat;
    },
}));

const mockQueryPieces = vi.fn();

vi.mock("../../src/store", () => ({
    PieceStore: class MockPieceStore {
        queryPieces = mockQueryPieces;
    },
}));

import { RagPipeline } from "../../src/rag";
import { PieceStore } from "../../src/store";

describe("RagPipeline", () => {
    let rag: RagPipeline;
    let mockStore: PieceStore;

    beforeEach(() => {
        vi.clearAllMocks();
        mockStore = new PieceStore();
        rag = new RagPipeline(mockStore, "http://localhost:11434", "test-llm");
    });

    describe("query", () => {
        it("retrieves pieces and generates an answer", async () => {
            mockQueryPieces.mockResolvedValueOnce([
                {
                    piece: {
                        id: "1",
                        content: "TypeScript is typed JS",
                        tags: ["ts"],
                    },
                    score: 0.9,
                },
            ]);
            mockChat.mockResolvedValueOnce({
                message: {
                    content: "TypeScript is a typed superset of JavaScript.",
                },
            });

            const result = await rag.query("What is TypeScript?");

            expect(result.answer).toBe(
                "TypeScript is a typed superset of JavaScript.",
            );
            expect(result.sources).toHaveLength(1);
            expect(result.sources[0].piece.id).toBe("1");
        });

        it("returns a well-formed RagResult structure", async () => {
            mockQueryPieces.mockResolvedValueOnce([
                {
                    piece: { id: "1", content: "Doc", tags: ["x"] },
                    score: 0.85,
                },
            ]);
            mockChat.mockResolvedValueOnce({
                message: { content: "Generated." },
            });

            const result = await rag.query("test");

            expect(result).toHaveProperty("answer");
            expect(result).toHaveProperty("sources");
            expect(typeof result.answer).toBe("string");
            expect(Array.isArray(result.sources)).toBe(true);
            expect(result.sources[0]).toHaveProperty("piece");
            expect(result.sources[0]).toHaveProperty("score");
        });

        it("passes query options to store.queryPieces", async () => {
            mockQueryPieces.mockResolvedValueOnce([
                {
                    piece: { id: "1", content: "Python doc", tags: ["python"] },
                    score: 0.8,
                },
            ]);
            mockChat.mockResolvedValueOnce({
                message: { content: "Some answer." },
            });

            await rag.query("test", { tags: ["python"], topK: 3 });

            expect(mockQueryPieces).toHaveBeenCalledWith("test", {
                tags: ["python"],
                topK: 3,
            });
        });

        it("passes default empty options to store.queryPieces", async () => {
            mockQueryPieces.mockResolvedValueOnce([]);

            await rag.query("test");

            expect(mockQueryPieces).toHaveBeenCalledWith("test", {});
        });

        it("builds context block with numbered sources and tags", async () => {
            mockQueryPieces.mockResolvedValueOnce([
                {
                    piece: { id: "1", content: "First doc", tags: ["a", "b"] },
                    score: 0.9,
                },
                {
                    piece: { id: "2", content: "Second doc", tags: ["c"] },
                    score: 0.7,
                },
            ]);
            mockChat.mockResolvedValueOnce({
                message: { content: "answer" },
            });

            await rag.query("question");

            const chatCall = mockChat.mock.calls[0][0];
            const userMessage = chatCall.messages[1].content;

            expect(userMessage).toContain("[1] (tags: a, b)\nFirst doc");
            expect(userMessage).toContain("[2] (tags: c)\nSecond doc");
            expect(userMessage).toContain("Question: question");
        });

        it("formats source with empty tags correctly", async () => {
            mockQueryPieces.mockResolvedValueOnce([
                {
                    piece: { id: "1", content: "No tags doc", tags: [] },
                    score: 0.9,
                },
            ]);
            mockChat.mockResolvedValueOnce({
                message: { content: "answer" },
            });

            await rag.query("question");

            const chatCall = mockChat.mock.calls[0][0];
            const userMessage = chatCall.messages[1].content;

            expect(userMessage).toContain("[1] (tags: )\nNo tags doc");
        });

        it("sends system prompt instructing citation", async () => {
            mockQueryPieces.mockResolvedValueOnce([
                {
                    piece: { id: "1", content: "Some doc", tags: ["a"] },
                    score: 0.8,
                },
            ]);
            mockChat.mockResolvedValueOnce({
                message: { content: "no info" },
            });

            await rag.query("anything");

            const chatCall = mockChat.mock.calls[0][0];
            const systemMessage = chatCall.messages[0];

            expect(systemMessage.role).toBe("system");
            expect(systemMessage.content).toContain("Cite sources");
        });

        it("sends exactly two messages: system and user", async () => {
            mockQueryPieces.mockResolvedValueOnce([
                {
                    piece: { id: "1", content: "Doc", tags: ["a"] },
                    score: 0.8,
                },
            ]);
            mockChat.mockResolvedValueOnce({
                message: { content: "ok" },
            });

            await rag.query("test");

            const chatCall = mockChat.mock.calls[0][0];
            expect(chatCall.messages).toHaveLength(2);
            expect(chatCall.messages[0].role).toBe("system");
            expect(chatCall.messages[1].role).toBe("user");
        });

        it("uses the configured model", async () => {
            mockQueryPieces.mockResolvedValueOnce([
                {
                    piece: { id: "1", content: "Some doc", tags: ["a"] },
                    score: 0.8,
                },
            ]);
            mockChat.mockResolvedValueOnce({
                message: { content: "ok" },
            });

            await rag.query("test");

            expect(mockChat).toHaveBeenCalledWith(
                expect.objectContaining({ model: "test-llm" }),
            );
        });

        it("handles empty sources gracefully without calling LLM", async () => {
            mockQueryPieces.mockResolvedValueOnce([]);

            const result = await rag.query("unknown topic");

            expect(result.sources).toEqual([]);
            expect(result.answer).toContain(
                "I don't have enough context to answer this question.",
            );
            expect(result.answer).toContain("No relevant pieces were found");
            expect(mockChat).not.toHaveBeenCalled();
        });

        it("preserves source scores in the result", async () => {
            mockQueryPieces.mockResolvedValueOnce([
                {
                    piece: { id: "1", content: "Doc 1", tags: ["a"] },
                    score: 0.95,
                },
                {
                    piece: { id: "2", content: "Doc 2", tags: ["b"] },
                    score: 0.72,
                },
            ]);
            mockChat.mockResolvedValueOnce({
                message: { content: "answer" },
            });

            const result = await rag.query("test");

            expect(result.sources[0].score).toBe(0.95);
            expect(result.sources[1].score).toBe(0.72);
        });
    });

    describe("error handling", () => {
        it("propagates errors from store.queryPieces", async () => {
            mockQueryPieces.mockRejectedValueOnce(
                new Error("Store unavailable"),
            );

            await expect(rag.query("test")).rejects.toThrow(
                "Store unavailable",
            );
            expect(mockChat).not.toHaveBeenCalled();
        });

        it("propagates errors from Ollama chat", async () => {
            mockQueryPieces.mockResolvedValueOnce([
                {
                    piece: { id: "1", content: "Doc", tags: [] },
                    score: 0.8,
                },
            ]);
            mockChat.mockRejectedValueOnce(new Error("LLM timeout"));

            await expect(rag.query("test")).rejects.toThrow("LLM timeout");
        });
    });
});
