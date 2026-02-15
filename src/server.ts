import express, { Request, Response } from "express";
import { PieceStore } from "./store";
import { RagPipeline } from "./rag";
import { MemoryConfig } from "./types";
import { resolveConfig } from "./config";

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
            const { content, tags } = req.body;
            if (!content || typeof content !== "string") {
                res.status(400).json({ error: "content (string) is required" });
                return;
            }
            const piece = await store.addPiece(content, tags ?? []);
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
            const { content, tags } = req.body;
            const piece = await store.updatePiece(id, content, tags);
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
            const { query, tags, topK } = req.body;
            if (!query || typeof query !== "string") {
                res.status(400).json({ error: "query (string) is required" });
                return;
            }
            const results = await store.queryPieces(query, { tags, topK });
            res.json(results);
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    // POST /rag — Full RAG query
    app.post("/rag", async (req: Request, res: Response) => {
        try {
            const { query, tags, topK } = req.body;
            if (!query || typeof query !== "string") {
                res.status(400).json({ error: "query (string) is required" });
                return;
            }
            const result = await rag.query(query, { tags, topK });
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    return app;
}
