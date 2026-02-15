import { PieceStore } from "./store";
import { RagPipeline } from "./rag";
import { MemoryConfig, Piece, QueryResult, RagResult } from "./types";
import { resolveConfig } from "./config";
import packageJson from "../package.json";

// ──────────────────────────────────────────────────────────────────────────────
// JSON-RPC Types
// ──────────────────────────────────────────────────────────────────────────────

type JsonRpcId = string | number | null;

type JsonRpcErrorCode =
    | -32700 // Parse error
    | -32600 // Invalid Request
    | -32601 // Method not found
    | -32602 // Invalid params
    | -32603; // Internal error

interface JsonRpcRequest {
    jsonrpc: "2.0";
    id: JsonRpcId;
    method: string;
    params?: unknown;
}

interface JsonRpcNotification {
    jsonrpc: "2.0";
    method: string;
    params?: unknown;
}

interface JsonRpcTypedMessage {
    jsonrpc: "2.0";
    method: string;
    params?: unknown;
    id?: unknown;
}

interface JsonRpcError {
    code: JsonRpcErrorCode;
    message: string;
    data?: unknown;
}

interface JsonRpcResponse {
    jsonrpc: "2.0";
    id: JsonRpcId;
    result?: unknown;
    error?: JsonRpcError;
}

type JsonRpcCodedError = Error & { code?: JsonRpcErrorCode };

type ToolContentBlock = {
    type: "text";
    text: string;
};

interface ToolCallResult {
    content: ToolContentBlock[];
    isError?: boolean;
}

interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
        additionalProperties: boolean;
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// MCP Protocol Constants & Tool Definitions
// ──────────────────────────────────────────────────────────────────────────────

const MCP_PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "memory";
const SERVER_VERSION = packageJson.version;

const TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        name: "add_piece",
        description: "Add a tagged text piece to the memory store.",
        inputSchema: {
            type: "object",
            properties: {
                content: { type: "string", description: "Piece content" },
                tags: {
                    type: "array",
                    description: "Optional tags for filtering and retrieval",
                    items: { type: "string" },
                },
            },
            required: ["content"],
            additionalProperties: false,
        },
    },
    {
        name: "get_piece",
        description: "Get a piece by ID.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Piece ID" },
            },
            required: ["id"],
            additionalProperties: false,
        },
    },
    {
        name: "update_piece",
        description: "Update a piece's content and/or tags.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Piece ID" },
                content: {
                    type: "string",
                    description: "New content (optional)",
                },
                tags: {
                    type: "array",
                    description: "New tags (optional)",
                    items: { type: "string" },
                },
            },
            required: ["id"],
            additionalProperties: false,
        },
    },
    {
        name: "delete_piece",
        description: "Delete a piece by ID.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Piece ID" },
            },
            required: ["id"],
            additionalProperties: false,
        },
    },
    {
        name: "query_pieces",
        description: "Run semantic search over pieces.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Semantic query text" },
                tags: {
                    type: "array",
                    description: "Optional tag filter",
                    items: { type: "string" },
                },
                topK: {
                    type: "integer",
                    description: "Maximum number of results (default: 10)",
                },
            },
            required: ["query"],
            additionalProperties: false,
        },
    },
    {
        name: "rag_query",
        description: "Run full RAG: retrieve relevant pieces and generate an answer.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "User question" },
                tags: {
                    type: "array",
                    description: "Optional tag filter",
                    items: { type: "string" },
                },
                topK: {
                    type: "integer",
                    description: "Maximum number of retrieved sources",
                },
            },
            required: ["query"],
            additionalProperties: false,
        },
    },
];

// ──────────────────────────────────────────────────────────────────────────────
// Argument Validation Helpers
// ──────────────────────────────────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function isJsonRpcTypedMessage(value: unknown): value is JsonRpcTypedMessage {
    return (
        isObject(value) &&
        value.jsonrpc === "2.0" &&
        typeof value.method === "string"
    );
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
    return value === null || typeof value === "string" || typeof value === "number";
}

function asObject(value: unknown, fieldName: string): Record<string, unknown> {
    if (!isObject(value)) {
        throw new Error(`${fieldName} must be an object`);
    }
    return value;
}

function asRequiredString(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${fieldName} must be a non-empty string`);
    }
    return value;
}

function asOptionalString(value: unknown, fieldName: string): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "string") {
        throw new Error(`${fieldName} must be a string`);
    }
    return value;
}

function asOptionalStringArray(value: unknown, fieldName: string): string[] | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error(`${fieldName} must be an array of strings`);
    }
    return value;
}

function asOptionalTopK(value: unknown): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!Number.isInteger(value) || (value as number) <= 0) {
        throw new Error("topK must be a positive integer");
    }
    return value as number;
}

function toJsonText(payload: unknown): string {
    return JSON.stringify(payload, null, 2);
}

// ──────────────────────────────────────────────────────────────────────────────
// MCP Server
// ──────────────────────────────────────────────────────────────────────────────

export class MemoryMcpServer {
    private readonly store: PieceStore;
    private readonly rag: RagPipeline;
    private readonly input: NodeJS.ReadableStream;
    private readonly output: NodeJS.WritableStream;
    private readonly errorOutput: NodeJS.WritableStream;
    private buffer = Buffer.alloc(0);
    private initPromise: Promise<void> | null = null;

    constructor(
        config: MemoryConfig = {},
        input: NodeJS.ReadableStream = process.stdin,
        output: NodeJS.WritableStream = process.stdout,
        errorOutput: NodeJS.WritableStream = process.stderr,
    ) {
        const resolvedConfig = resolveConfig(config);
        this.store = new PieceStore(resolvedConfig);
        this.rag = new RagPipeline(
            this.store,
            resolvedConfig.ollamaUrl,
            resolvedConfig.generationModel,
        );
        this.input = input;
        this.output = output;
        this.errorOutput = errorOutput;
    }

    start() {
        this.input.on("data", (chunk) => {
            this.handleChunk(chunk);
        });

        this.input.on("error", (err) => {
            this.logError(`Input stream error: ${String(err)}`);
        });

        this.output.on("error", (err) => {
            this.logError(`Output stream error: ${String(err)}`);
        });

        this.input.resume();
    }

    private handleChunk(chunk: Buffer | string) {
        const chunkBuffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
        this.buffer = Buffer.concat([this.buffer, chunkBuffer]);

        while (true) {
            const headerEnd = this.buffer.indexOf("\r\n\r\n");
            if (headerEnd === -1) {
                return;
            }

            const rawHeaders = this.buffer.slice(0, headerEnd).toString("utf8");
            const match = /Content-Length:\s*(\d+)/i.exec(rawHeaders);
            if (!match) {
                this.sendErrorResponse(null, -32600, "Missing Content-Length header");
                this.buffer = Buffer.alloc(0);
                return;
            }

            const contentLength = Number(match[1]);
            const messageEnd = headerEnd + 4 + contentLength;
            if (this.buffer.length < messageEnd) {
                return;
            }

            const rawBody = this.buffer.slice(headerEnd + 4, messageEnd).toString("utf8");
            this.buffer = this.buffer.slice(messageEnd);

            let parsed: unknown;
            try {
                parsed = JSON.parse(rawBody);
            } catch {
                this.sendErrorResponse(null, -32700, "Invalid JSON payload");
                continue;
            }

            void this.handleMessage(parsed);
        }
    }

    private async handleMessage(payload: unknown): Promise<void> {
        if (!isJsonRpcTypedMessage(payload)) {
            this.sendErrorResponse(null, -32600, "Invalid JSON-RPC request");
            return;
        }

        const hasId = Object.prototype.hasOwnProperty.call(payload, "id");
        if (!hasId) {
            this.handleNotification({
                jsonrpc: "2.0",
                method: payload.method,
                params: payload.params,
            });
            return;
        }

        if (!isJsonRpcId(payload.id)) {
            this.sendErrorResponse(null, -32600, "Invalid JSON-RPC request id");
            return;
        }

        const request: JsonRpcRequest = {
            jsonrpc: "2.0",
            id: payload.id,
            method: payload.method,
            params: payload.params,
        };
        try {
            const result = await this.handleRequest(request.method, request.params);
            this.sendResultResponse(request.id, result);
        } catch (err) {
            const codedError = err as JsonRpcCodedError;
            this.sendErrorResponse(
                request.id,
                codedError.code ?? -32603,
                codedError.message ?? "Internal error",
            );
        }
    }

    private handleNotification(notification: JsonRpcNotification) {
        // notifications/initialized is sent by clients after initialize; no-op here.
        if (notification.method === "notifications/initialized") {
            return;
        }

        // Ignore other notifications for now.
    }

    private async handleRequest(method: string, params: unknown): Promise<unknown> {
        switch (method) {
            case "initialize":
                return {
                    protocolVersion: MCP_PROTOCOL_VERSION,
                    capabilities: {
                        tools: {},
                    },
                    serverInfo: {
                        name: SERVER_NAME,
                        version: SERVER_VERSION,
                    },
                };

            case "tools/list":
                return { tools: TOOL_DEFINITIONS };

            case "tools/call":
                return this.handleToolCall(params);

            case "ping":
                return {};

            default:
                throw this.jsonRpcError(-32601, `Method not found: ${method}`);
        }
    }

    private async handleToolCall(params: unknown): Promise<ToolCallResult> {
        try {
            const payload = asObject(params, "params");
            const toolName = asRequiredString(payload.name, "name");
            const toolArgs = asObject(payload.arguments ?? {}, "arguments");

            switch (toolName) {
                case "add_piece":
                    return this.wrapToolResult(
                        await this.addPieceTool(
                            asRequiredString(toolArgs.content, "content"),
                            asOptionalStringArray(toolArgs.tags, "tags") ?? [],
                        ),
                    );

                case "get_piece":
                    return this.wrapToolResult(
                        await this.getPieceTool(asRequiredString(toolArgs.id, "id")),
                    );

                case "update_piece":
                    return this.wrapToolResult(
                        await this.updatePieceTool(
                            asRequiredString(toolArgs.id, "id"),
                            asOptionalString(toolArgs.content, "content"),
                            asOptionalStringArray(toolArgs.tags, "tags"),
                        ),
                    );

                case "delete_piece":
                    return this.wrapToolResult(
                        await this.deletePieceTool(asRequiredString(toolArgs.id, "id")),
                    );

                case "query_pieces":
                    return this.wrapToolResult(
                        await this.queryPiecesTool(
                            asRequiredString(toolArgs.query, "query"),
                            asOptionalStringArray(toolArgs.tags, "tags"),
                            asOptionalTopK(toolArgs.topK),
                        ),
                    );

                case "rag_query":
                    return this.wrapToolResult(
                        await this.ragQueryTool(
                            asRequiredString(toolArgs.query, "query"),
                            asOptionalStringArray(toolArgs.tags, "tags"),
                            asOptionalTopK(toolArgs.topK),
                        ),
                    );

                default:
                    return this.wrapToolResult(
                        { error: `Unknown tool: ${toolName}` },
                        true,
                    );
            }
        } catch (err) {
            return this.wrapToolResult({ error: String(err) }, true);
        }
    }

    private async ensureStoreInitialized(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = this.store.init();
        }
        try {
            await this.initPromise;
        } catch (err) {
            this.initPromise = null;
            throw err;
        }
    }

    private async addPieceTool(content: string, tags: string[]): Promise<Piece> {
        await this.ensureStoreInitialized();
        return this.store.addPiece(content, tags);
    }

    private async getPieceTool(id: string): Promise<{ found: boolean; piece: Piece | null }> {
        await this.ensureStoreInitialized();
        const piece = await this.store.getPiece(id);
        return {
            found: !!piece,
            piece,
        };
    }

    private async updatePieceTool(
        id: string,
        content?: string,
        tags?: string[],
    ): Promise<{ found: boolean; piece: Piece | null }> {
        await this.ensureStoreInitialized();
        const piece = await this.store.updatePiece(id, content, tags);
        return {
            found: !!piece,
            piece,
        };
    }

    private async deletePieceTool(id: string): Promise<{ deleted: true; id: string }> {
        await this.ensureStoreInitialized();
        await this.store.deletePiece(id);
        return {
            deleted: true,
            id,
        };
    }

    private async queryPiecesTool(
        query: string,
        tags?: string[],
        topK?: number,
    ): Promise<QueryResult[]> {
        await this.ensureStoreInitialized();
        return this.store.queryPieces(query, { tags, topK });
    }

    private async ragQueryTool(
        query: string,
        tags?: string[],
        topK?: number,
    ): Promise<RagResult> {
        await this.ensureStoreInitialized();
        return this.rag.query(query, { tags, topK });
    }

    private wrapToolResult(payload: unknown, isError = false): ToolCallResult {
        return {
            content: [
                {
                    type: "text",
                    text: toJsonText(payload),
                },
            ],
            ...(isError ? { isError: true } : {}),
        };
    }

    private sendResultResponse(id: JsonRpcId, result: unknown) {
        this.sendMessage({
            jsonrpc: "2.0",
            id,
            result,
        });
    }

    private sendErrorResponse(
        id: JsonRpcId,
        code: JsonRpcErrorCode,
        message: string,
        data?: unknown,
    ) {
        this.sendMessage({
            jsonrpc: "2.0",
            id,
            error: {
                code,
                message,
                ...(data !== undefined ? { data } : {}),
            },
        });
    }

    private sendMessage(message: JsonRpcResponse) {
        const serialized = JSON.stringify(message);
        const framed = `Content-Length: ${Buffer.byteLength(serialized, "utf8")}\r\n\r\n${serialized}`;
        this.output.write(framed);
    }

    private jsonRpcError(code: JsonRpcErrorCode, message: string): Error {
        const err = new Error(message) as Error & { code?: JsonRpcErrorCode };
        err.code = code;
        return err;
    }

    private logError(message: string) {
        this.errorOutput.write(`[memory-mcp] ${message}\n`);
    }
}
