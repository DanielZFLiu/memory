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

vi.mock("../../src/store", () => ({
    PieceStore: class MockPieceStore {
        init = mockInit;
        addPiece = mockAddPiece;
        getPiece = mockGetPiece;
        updatePiece = mockUpdatePiece;
        deletePiece = mockDeletePiece;
        queryPieces = mockQueryPieces;
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
            tags: ["tag-1"],
        });
        mockGetPiece.mockResolvedValue(null);
        mockUpdatePiece.mockResolvedValue(null);
        mockDeletePiece.mockResolvedValue(undefined);
        mockQueryPieces.mockResolvedValue([]);
        mockRagQuery.mockResolvedValue({ answer: "No context", sources: [] });

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
        ]);
    });

    // -------------------------------------------------------------------
    // Tool calls
    // -------------------------------------------------------------------

    it("calls add_piece and returns a text result payload", async () => {
        const result = await client.callTool({
            name: "add_piece",
            arguments: { content: "hello", tags: ["tag-1"] },
        });

        expect(mockInit).toHaveBeenCalledTimes(1);
        expect(mockAddPiece).toHaveBeenCalledWith("hello", ["tag-1"]);

        expect(result.isError).toBeFalsy();
        const content = result.content as Array<{ type: string; text: string }>;
        expect(content[0].type).toBe("text");
        expect(JSON.parse(content[0].text)).toEqual({
            id: "piece-1",
            content: "hello",
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
