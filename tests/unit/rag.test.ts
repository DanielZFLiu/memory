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

        it("passes query options to store.queryPieces", async () => {
            mockQueryPieces.mockResolvedValueOnce([]);
            mockChat.mockResolvedValueOnce({
                message: { content: "No relevant information." },
            });

            await rag.query("test", { tags: ["python"], topK: 3 });

            expect(mockQueryPieces).toHaveBeenCalledWith("test", {
                tags: ["python"],
                topK: 3,
            });
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
            expect(mockChat).not.toHaveBeenCalled();
        });
    });
});
