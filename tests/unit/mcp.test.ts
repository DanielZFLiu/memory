import { describe, it, expect, vi, beforeEach } from "vitest";
import { PassThrough } from "stream";
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

function encodeMessage(message: unknown): Buffer {
    const serialized = JSON.stringify(message);
    return Buffer.from(
        `Content-Length: ${Buffer.byteLength(serialized, "utf8")}\r\n\r\n${serialized}`,
        "utf8",
    );
}

function decodeMessages(buffer: Buffer): Array<Record<string, unknown>> {
    const messages: Array<Record<string, unknown>> = [];
    let cursor = 0;

    while (cursor < buffer.length) {
        const headerEnd = buffer.indexOf("\r\n\r\n", cursor, "utf8");
        if (headerEnd === -1) {
            break;
        }

        const rawHeaders = buffer.slice(cursor, headerEnd).toString("utf8");
        const match = /Content-Length:\s*(\d+)/i.exec(rawHeaders);
        if (!match) {
            break;
        }

        const contentLength = Number(match[1]);
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + contentLength;
        if (buffer.length < bodyEnd) {
            break;
        }

        messages.push(JSON.parse(buffer.slice(bodyStart, bodyEnd).toString("utf8")));
        cursor = bodyEnd;
    }

    return messages;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function waitFor(
    assertion: () => boolean,
    timeoutMs = 400,
    pollIntervalMs = 5,
): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (assertion()) {
            return;
        }
        await delay(pollIntervalMs);
    }
    throw new Error("Timed out waiting for MCP response");
}

describe("MemoryMcpServer", () => {
    let input: PassThrough;
    let output: PassThrough;
    let errorOutput: PassThrough;
    let outputBuffer: Buffer;

    beforeEach(() => {
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

        input = new PassThrough();
        output = new PassThrough();
        errorOutput = new PassThrough();
        outputBuffer = Buffer.alloc(0);

        output.on("data", (chunk) => {
            const asBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
            outputBuffer = Buffer.concat([outputBuffer, asBuffer]);
        });

        const server = new MemoryMcpServer({}, input, output, errorOutput);
        server.start();
    });

    // -------------------------------------------------------------------
    // Protocol-level requests
    // -------------------------------------------------------------------

    it("returns MCP server info on initialize", async () => {
        const request = {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "test-client", version: "1.0.0" },
            },
        };

        input.write(encodeMessage(request));

        await waitFor(() => decodeMessages(outputBuffer).length === 1);
        const response = decodeMessages(outputBuffer)[0];

        expect(response.id).toBe(1);
        expect(response.result).toEqual({
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: {
                name: "memory",
                version: packageJson.version,
            },
        });
    });

    it("lists all supported tools", async () => {
        input.write(
            encodeMessage({
                jsonrpc: "2.0",
                id: 2,
                method: "tools/list",
            }),
        );

        await waitFor(() => decodeMessages(outputBuffer).length === 1);
        const response = decodeMessages(outputBuffer)[0];
        const tools = (response.result as { tools: Array<{ name: string }> }).tools;

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
        input.write(
            encodeMessage({
                jsonrpc: "2.0",
                id: 3,
                method: "tools/call",
                params: {
                    name: "add_piece",
                    arguments: {
                        content: "hello",
                        tags: ["tag-1"],
                    },
                },
            }),
        );

        await waitFor(() => decodeMessages(outputBuffer).length === 1);
        const response = decodeMessages(outputBuffer)[0];

        expect(mockInit).toHaveBeenCalledTimes(1);
        expect(mockAddPiece).toHaveBeenCalledWith("hello", ["tag-1"]);

        const result = response.result as {
            content: Array<{ type: string; text: string }>;
            isError?: boolean;
        };
        expect(result.isError).toBeUndefined();
        expect(result.content[0].type).toBe("text");
        expect(JSON.parse(result.content[0].text)).toEqual({
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

        input.write(
            encodeMessage({
                jsonrpc: "2.0",
                id: 4,
                method: "tools/call",
                params: {
                    name: "add_piece",
                    arguments: {
                        content: "hello",
                        tags: ["tag-1"],
                    },
                },
            }),
        );

        input.write(
            encodeMessage({
                jsonrpc: "2.0",
                id: 5,
                method: "tools/call",
                params: {
                    name: "query_pieces",
                    arguments: {
                        query: "hello",
                        topK: 3,
                    },
                },
            }),
        );

        await waitFor(() => decodeMessages(outputBuffer).length === 2);

        expect(mockInit).toHaveBeenCalledTimes(1);
        expect(mockQueryPieces).toHaveBeenCalledWith("hello", {
            tags: undefined,
            topK: 3,
        });
    });

    it("returns tool-level errors for unknown tools", async () => {
        input.write(
            encodeMessage({
                jsonrpc: "2.0",
                id: 6,
                method: "tools/call",
                params: {
                    name: "unknown_tool",
                    arguments: {},
                },
            }),
        );

        await waitFor(() => decodeMessages(outputBuffer).length === 1);
        const response = decodeMessages(outputBuffer)[0];

        const result = response.result as {
            content: Array<{ type: string; text: string }>;
            isError?: boolean;
        };
        expect(result.isError).toBe(true);
        expect(JSON.parse(result.content[0].text)).toEqual({
            error: "Unknown tool: unknown_tool",
        });
    });

    it("ignores notifications without writing responses", async () => {
        input.write(
            encodeMessage({
                jsonrpc: "2.0",
                method: "notifications/initialized",
            }),
        );

        await delay(30);
        expect(decodeMessages(outputBuffer)).toHaveLength(0);
    });
});
