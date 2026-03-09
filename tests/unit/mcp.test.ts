import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import packageJson from "../../package.json";

const mockInit = vi.fn();
const mockAddPiece = vi.fn();
const mockGetPiece = vi.fn();
const mockUpdatePiece = vi.fn();
const mockDeletePiece = vi.fn();
const mockQueryPieces = vi.fn();
const mockRagQuery = vi.fn();
const mockListCollections = vi.fn();
const mockDeleteCollection = vi.fn();

vi.mock("../../src/store", () => ({
    PieceStore: class MockPieceStore {
        init = mockInit;
        addPiece = mockAddPiece;
        getPiece = mockGetPiece;
        updatePiece = mockUpdatePiece;
        deletePiece = mockDeletePiece;
        queryPieces = mockQueryPieces;
        listCollections = mockListCollections;
        deleteCollection = mockDeleteCollection;
    },
}));

vi.mock("../../src/rag", () => ({
    RagPipeline: class MockRagPipeline {
        query = mockRagQuery;
    },
}));

import { MemoryMcpServer } from "../../src/mcp";

describe("MemoryMcpServer", () => {
    let server: MemoryMcpServer;
    let client: Client;

    beforeEach(async () => {
        vi.clearAllMocks();

        mockInit.mockResolvedValue(undefined);
        mockAddPiece.mockResolvedValue({
            id: "piece-1",
            content: "hello",
            title: "Greeting",
            tags: ["tag-1"],
        });
        mockGetPiece.mockResolvedValue(null);
        mockUpdatePiece.mockResolvedValue(null);
        mockDeletePiece.mockResolvedValue(undefined);
        mockQueryPieces.mockResolvedValue([]);
        mockRagQuery.mockResolvedValue({ answer: "No context", sources: [] });
        mockListCollections.mockResolvedValue(["pieces"]);
        mockDeleteCollection.mockResolvedValue(undefined);

        server = new MemoryMcpServer({});
        client = new Client({ name: "test-client", version: "1.0.0" });

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await Promise.all([
            server.start(serverTransport),
            client.connect(clientTransport),
        ]);
    });

    afterEach(async () => {
        await client.close();
        await server.close();
    });

    // -------------------------------------------------------------------
    // Protocol-level requests
    // -------------------------------------------------------------------

    it("returns MCP server info on initialize", () => {
        const serverVersion = client.getServerVersion();
        expect(serverVersion).toEqual({
            name: "memory",
            version: packageJson.version,
        });
    });

    it("lists all supported tools", async () => {
        const { tools } = await client.listTools();

        expect(tools.map((tool) => tool.name)).toEqual([
            "add_piece",
            "get_piece",
            "update_piece",
            "delete_piece",
            "query_pieces",
            "rag_query",
            "list_collections",
            "delete_collection",
        ]);
    });

    // -------------------------------------------------------------------
    // Tool calls
    // -------------------------------------------------------------------

    it("calls add_piece and returns a text result payload", async () => {
        const result = await client.callTool({
            name: "add_piece",
            arguments: { content: "hello", title: "Greeting", tags: ["tag-1"] },
        });

        expect(mockInit).toHaveBeenCalledTimes(1);
        expect(mockAddPiece).toHaveBeenCalledWith("hello", ["tag-1"], "Greeting", undefined);

        expect(result.isError).toBeFalsy();
        const content = result.content as Array<{ type: string; text: string }>;
        expect(content[0].type).toBe("text");
        expect(JSON.parse(content[0].text)).toEqual({
            id: "piece-1",
            content: "hello",
            title: "Greeting",
            tags: ["tag-1"],
        });
    });

    it("reuses store initialization across multiple tool calls", async () => {
        mockQueryPieces.mockResolvedValueOnce([
            {
                piece: {
                    id: "piece-1",
                    content: "hello",
                    tags: ["tag-1"],
                },
                score: 0.9,
            },
        ]);

        await client.callTool({
            name: "add_piece",
            arguments: { content: "hello", tags: ["tag-1"] },
        });

        await client.callTool({
            name: "query_pieces",
            arguments: { query: "hello", topK: 3 },
        });

        expect(mockInit).toHaveBeenCalledTimes(1);
        expect(mockQueryPieces).toHaveBeenCalledWith("hello", {
            tags: undefined,
            topK: 3,
            useHybridSearch: undefined,
        }, undefined);
    });

    it("passes null title through update_piece to clear existing title", async () => {
        await client.callTool({
            name: "update_piece",
            arguments: { id: "piece-1", title: null },
        });

        expect(mockInit).toHaveBeenCalledTimes(1);
        expect(mockUpdatePiece).toHaveBeenCalledWith(
            "piece-1",
            undefined,
            undefined,
            null,
            undefined,
        );
    });

    it("passes collection param to add_piece", async () => {
        const result = await client.callTool({
            name: "add_piece",
            arguments: { content: "hello", tags: ["tag-1"], collection: "agent-alice" },
        });

        expect(mockAddPiece).toHaveBeenCalledWith("hello", ["tag-1"], undefined, "agent-alice");
        expect(result.isError).toBeFalsy();
    });

    it("passes collection param to query_pieces", async () => {
        mockQueryPieces.mockResolvedValueOnce([]);

        await client.callTool({
            name: "query_pieces",
            arguments: { query: "test", collection: "agent-alice" },
        });

        expect(mockQueryPieces).toHaveBeenCalledWith(
            "test",
            { tags: undefined, topK: undefined, useHybridSearch: undefined },
            "agent-alice",
        );
    });

    it("calls list_collections and returns collection names", async () => {
        mockListCollections.mockResolvedValueOnce(["pieces", "agent-alice"]);

        const result = await client.callTool({
            name: "list_collections",
            arguments: {},
        });

        expect(mockInit).toHaveBeenCalledTimes(1);
        expect(mockListCollections).toHaveBeenCalledTimes(1);
        expect(result.isError).toBeFalsy();
        const content = result.content as Array<{ type: string; text: string }>;
        expect(JSON.parse(content[0].text)).toEqual({
            collections: ["pieces", "agent-alice"],
        });
    });

    it("calls delete_collection and returns confirmation", async () => {
        const result = await client.callTool({
            name: "delete_collection",
            arguments: { collection: "agent-alice" },
        });

        expect(mockInit).toHaveBeenCalledTimes(1);
        expect(mockDeleteCollection).toHaveBeenCalledWith("agent-alice");
        expect(result.isError).toBeFalsy();
        const content = result.content as Array<{ type: string; text: string }>;
        expect(JSON.parse(content[0].text)).toEqual({
            deleted: true,
            collection: "agent-alice",
        });
    });

    it("returns an error for unknown tools", async () => {
        const result = await client.callTool({
            name: "unknown_tool",
            arguments: {},
        });

        expect(result.isError).toBe(true);
    });
});
