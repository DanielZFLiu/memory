import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { PieceStore } from "./store";
import { RagPipeline } from "./rag";
import { MemoryConfig, Piece, QueryResult, RagResult } from "./types";
import { resolveConfig } from "./config";
import packageJson from "../package.json";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function toJsonText(payload: unknown): string {
    return JSON.stringify(payload, null, 2);
}

function toolResult(payload: unknown, isError = false): CallToolResult {
    return {
        content: [{ type: "text", text: toJsonText(payload) }],
        ...(isError ? { isError: true } : {}),
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// MCP Server
// ──────────────────────────────────────────────────────────────────────────────

export class MemoryMcpServer {
    private readonly mcpServer: McpServer;
    private readonly store: PieceStore;
    private readonly rag: RagPipeline;
    private initPromise: Promise<void> | null = null;

    constructor(config: MemoryConfig = {}) {
        const resolved = resolveConfig(config);
        this.store = new PieceStore(resolved);
        this.rag = new RagPipeline(
            this.store,
            resolved.ollamaUrl,
            resolved.generationModel,
        );

        this.mcpServer = new McpServer({
            name: "memory",
            version: packageJson.version,
        });

        this.registerTools();
    }

    /**
     * Start the server using the given transport (defaults to stdio).
     */
    async start(transport?: Transport): Promise<void> {
        const t = transport ?? new StdioServerTransport();
        await this.mcpServer.connect(t);
    }

    /**
     * Shut down the server and its transport.
     */
    async close(): Promise<void> {
        await this.mcpServer.close();
    }

    // ── Store lifecycle ─────────────────────────────────────────────────────

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

    // ── Tool registration ───────────────────────────────────────────────────

    private registerTools(): void {
        this.mcpServer.registerTool(
            "add_piece",
            {
                description: "Add a tagged text piece to the memory store.",
                inputSchema: z.object({
                    content: z.string().describe("Piece content"),
                    tags: z.array(z.string()).optional().describe("Optional tags for filtering and retrieval"),
                }),
            },
            async ({ content, tags }): Promise<CallToolResult> => {
                await this.ensureStoreInitialized();
                const piece: Piece = await this.store.addPiece(content, tags ?? []);
                return toolResult(piece);
            },
        );

        this.mcpServer.registerTool(
            "get_piece",
            {
                description: "Get a piece by ID.",
                inputSchema: z.object({
                    id: z.string().describe("Piece ID"),
                }),
            },
            async ({ id }): Promise<CallToolResult> => {
                await this.ensureStoreInitialized();
                const piece = await this.store.getPiece(id);
                return toolResult({ found: !!piece, piece });
            },
        );

        this.mcpServer.registerTool(
            "update_piece",
            {
                description: "Update a piece's content and/or tags.",
                inputSchema: z.object({
                    id: z.string().describe("Piece ID"),
                    content: z.string().optional().describe("New content (optional)"),
                    tags: z.array(z.string()).optional().describe("New tags (optional)"),
                }),
            },
            async ({ id, content, tags }): Promise<CallToolResult> => {
                await this.ensureStoreInitialized();
                const piece = await this.store.updatePiece(id, content, tags);
                return toolResult({ found: !!piece, piece });
            },
        );

        this.mcpServer.registerTool(
            "delete_piece",
            {
                description: "Delete a piece by ID.",
                inputSchema: z.object({
                    id: z.string().describe("Piece ID"),
                }),
            },
            async ({ id }): Promise<CallToolResult> => {
                await this.ensureStoreInitialized();
                await this.store.deletePiece(id);
                return toolResult({ deleted: true, id });
            },
        );

        this.mcpServer.registerTool(
            "query_pieces",
            {
                description: "Run semantic search over pieces.",
                inputSchema: z.object({
                    query: z.string().describe("Semantic query text"),
                    tags: z.array(z.string()).optional().describe("Optional tag filter"),
                    topK: z.number().int().positive().optional().describe("Maximum number of results (default: 10)"),
                }),
            },
            async ({ query, tags, topK }): Promise<CallToolResult> => {
                await this.ensureStoreInitialized();
                const results: QueryResult[] = await this.store.queryPieces(query, { tags, topK });
                return toolResult(results);
            },
        );

        this.mcpServer.registerTool(
            "rag_query",
            {
                description: "Run full RAG: retrieve relevant pieces and generate an answer.",
                inputSchema: z.object({
                    query: z.string().describe("User question"),
                    tags: z.array(z.string()).optional().describe("Optional tag filter"),
                    topK: z.number().int().positive().optional().describe("Maximum number of retrieved sources"),
                }),
            },
            async ({ query, tags, topK }): Promise<CallToolResult> => {
                await this.ensureStoreInitialized();
                const result: RagResult = await this.rag.query(query, { tags, topK });
                return toolResult(result);
            },
        );
    }
}
