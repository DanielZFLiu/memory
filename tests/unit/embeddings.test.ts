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

        it("handles empty string input", async () => {
            mockEmbed.mockResolvedValueOnce({ embeddings: [[0, 0, 0]] });

            const result = await client.embed("");

            expect(result).toEqual([0, 0, 0]);
            expect(mockEmbed).toHaveBeenCalledWith({
                model: "test-model",
                input: "",
            });
        });

        it("propagates errors from Ollama", async () => {
            mockEmbed.mockRejectedValueOnce(new Error("Connection refused"));

            await expect(client.embed("test")).rejects.toThrow(
                "Connection refused",
            );
        });

        it("is called exactly once per invocation", async () => {
            mockEmbed.mockResolvedValueOnce({ embeddings: [[1]] });

            await client.embed("single call");

            expect(mockEmbed).toHaveBeenCalledTimes(1);
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

        it("handles empty array input", async () => {
            mockEmbed.mockResolvedValueOnce({ embeddings: [] });

            const result = await client.embedBatch([]);

            expect(result).toEqual([]);
            expect(mockEmbed).toHaveBeenCalledWith({
                model: "test-model",
                input: [],
            });
        });

        it("propagates errors from Ollama", async () => {
            mockEmbed.mockRejectedValueOnce(new Error("Model not found"));

            await expect(
                client.embedBatch(["text1", "text2"]),
            ).rejects.toThrow("Model not found");
        });

        it("makes a single API call for multiple texts", async () => {
            mockEmbed.mockResolvedValueOnce({
                embeddings: [[1], [2], [3]],
            });

            await client.embedBatch(["a", "b", "c"]);

            expect(mockEmbed).toHaveBeenCalledTimes(1);
        });
    });

    describe("model configuration", () => {
        it("uses the model specified at construction time", async () => {
            const customClient = new EmbeddingClient(
                "http://custom:11434",
                "custom-model",
            );
            mockEmbed.mockResolvedValueOnce({ embeddings: [[1]] });

            await customClient.embed("test");

            expect(mockEmbed).toHaveBeenCalledWith({
                model: "custom-model",
                input: "test",
            });
        });
    });
});
