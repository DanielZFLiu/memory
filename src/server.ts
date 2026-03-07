import express, { Request, Response } from "express";
import { PieceStore } from "./store";
import { RagPipeline } from "./rag";
import { MemoryConfig } from "./types";
import { resolveConfig } from "./config";

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPositiveInteger(value: unknown): value is number {
    return Number.isInteger(value) && typeof value === "number" && value > 0;
}

function validateTitle(value: unknown, allowNull = false): string | null | undefined {
    if (value === undefined) return undefined;
    if (allowNull && value === null) return null;
    return typeof value === "string" ? value : undefined;
}

export function createServer(config: MemoryConfig = {}) {
    const resolvedConfig = resolveConfig(config);
    const app = express();
    app.use(express.json());

    const store = new PieceStore(resolvedConfig);
    const rag = new RagPipeline(
        store,
        resolvedConfig.ollamaUrl,
        resolvedConfig.generationModel,
    );

    // Middleware to ensure store is initialized (uses a cached promise to
    // avoid duplicate init() calls when concurrent requests arrive early)
    let initPromise: Promise<void> | null = null;
    app.use(async (_req, res, next) => {
        if (!initPromise) {
            initPromise = store.init();
        }
        try {
            await initPromise;
        } catch (err) {
            initPromise = null; // allow retry on next request
            res.status(503).json({
                error: "Failed to connect to ChromaDB",
                details: String(err),
            });
            return;
        }
        next();
    });

    // POST /pieces — Add a piece
    app.post("/pieces", async (req: Request, res: Response) => {
        try {
            const { content, title, tags } = req.body;
            if (!content || typeof content !== "string") {
                res.status(400).json({ error: "content (string) is required" });
                return;
            }
            if (title !== undefined && typeof title !== "string") {
                res.status(400).json({ error: "title must be a string when provided" });
                return;
            }
            if (tags !== undefined && !isStringArray(tags)) {
                res.status(400).json({ error: "tags must be an array of strings when provided" });
                return;
            }
            const piece = await store.addPiece(content, tags ?? [], title);
            res.status(201).json(piece);
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    // GET /pieces/:id — Get a piece by ID
    app.get("/pieces/:id", async (req: Request<{ id: string }>, res: Response) => {
        try {
            const { id } = req.params;
            const piece = await store.getPiece(id);
            if (!piece) {
                res.status(404).json({ error: "Piece not found" });
                return;
            }
            res.json(piece);
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    // PUT /pieces/:id — Update a piece
    app.put("/pieces/:id", async (req: Request<{ id: string }>, res: Response) => {
        try {
            const { id } = req.params;
            const { content, title, tags } = req.body;
            if (content !== undefined && typeof content !== "string") {
                res.status(400).json({ error: "content must be a string when provided" });
                return;
            }
            const validatedTitle = validateTitle(title, true);
            if (title !== undefined && validatedTitle === undefined) {
                res.status(400).json({ error: "title must be a string or null when provided" });
                return;
            }
            if (tags !== undefined && !isStringArray(tags)) {
                res.status(400).json({ error: "tags must be an array of strings when provided" });
                return;
            }
            const piece = await store.updatePiece(id, content, tags, validatedTitle);
            if (!piece) {
                res.status(404).json({ error: "Piece not found" });
                return;
            }
            res.json(piece);
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    // DELETE /pieces/:id — Delete a piece
    app.delete("/pieces/:id", async (req: Request<{ id: string }>, res: Response) => {
        try {
            const { id } = req.params;
            await store.deletePiece(id);
            res.status(204).send();
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    // POST /query — Semantic search
    app.post("/query", async (req: Request, res: Response) => {
        try {
            const { query, tags, topK, useHybridSearch } = req.body;
            if (!query || typeof query !== "string") {
                res.status(400).json({ error: "query (string) is required" });
                return;
            }
            if (tags !== undefined && !isStringArray(tags)) {
                res.status(400).json({ error: "tags must be an array of strings when provided" });
                return;
            }
            if (topK !== undefined && !isPositiveInteger(topK)) {
                res.status(400).json({ error: "topK must be a positive integer when provided" });
                return;
            }
            if (useHybridSearch !== undefined && typeof useHybridSearch !== "boolean") {
                res.status(400).json({ error: "useHybridSearch must be a boolean when provided" });
                return;
            }
            const results = await store.queryPieces(query, { tags, topK, useHybridSearch });
            res.json(results);
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    // POST /rag — Full RAG query
    app.post("/rag", async (req: Request, res: Response) => {
        try {
            const { query, tags, topK, useHybridSearch } = req.body;
            if (!query || typeof query !== "string") {
                res.status(400).json({ error: "query (string) is required" });
                return;
            }
            if (tags !== undefined && !isStringArray(tags)) {
                res.status(400).json({ error: "tags must be an array of strings when provided" });
                return;
            }
            if (topK !== undefined && !isPositiveInteger(topK)) {
                res.status(400).json({ error: "topK must be a positive integer when provided" });
                return;
            }
            if (useHybridSearch !== undefined && typeof useHybridSearch !== "boolean") {
                res.status(400).json({ error: "useHybridSearch must be a boolean when provided" });
                return;
            }
            const result = await rag.query(query, { tags, topK, useHybridSearch });
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    return app;
}
