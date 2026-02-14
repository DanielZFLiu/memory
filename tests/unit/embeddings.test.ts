import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEmbed = vi.fn();

vi.mock("ollama", () => ({
    Ollama: class MockOllama {
        embed = mockEmbed;
    },
}));

import { EmbeddingClient } from "../../src/embeddings";

describe("EmbeddingClient", () => {
    let client: EmbeddingClient;

    beforeEach(() => {
        vi.clearAllMocks();
        client = new EmbeddingClient("http://localhost:11434", "test-model");
    });

    describe("embed", () => {
        it("returns the first embedding vector", async () => {
            const fakeVector = [0.1, 0.2, 0.3];
            mockEmbed.mockResolvedValueOnce({ embeddings: [fakeVector] });

            const result = await client.embed("hello world");

            expect(result).toEqual(fakeVector);
            expect(mockEmbed).toHaveBeenCalledWith({
                model: "test-model",
                input: "hello world",
            });
        });

        it("calls Ollama embed with the correct model", async () => {
            mockEmbed.mockResolvedValueOnce({ embeddings: [[1, 2]] });
            await client.embed("test");

            expect(mockEmbed).toHaveBeenCalledWith({
                model: "test-model",
                input: "test",
            });
        });
    });

    describe("embedBatch", () => {
        it("returns all embedding vectors", async () => {
            const fakeVectors = [
                [0.1, 0.2],
                [0.3, 0.4],
            ];
            mockEmbed.mockResolvedValueOnce({ embeddings: fakeVectors });

            const result = await client.embedBatch(["hello", "world"]);

            expect(result).toEqual(fakeVectors);
            expect(mockEmbed).toHaveBeenCalledWith({
                model: "test-model",
                input: ["hello", "world"],
            });
        });

        it("handles single text in batch", async () => {
            mockEmbed.mockResolvedValueOnce({ embeddings: [[0.5, 0.6]] });

            const result = await client.embedBatch(["single"]);

            expect(result).toEqual([[0.5, 0.6]]);
        });
    });
});
