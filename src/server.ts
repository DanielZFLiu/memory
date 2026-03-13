import http from "http";
import https from "https";
import { ChromaClient } from "chromadb";
import express, { Request, Response } from "express";
import { PieceStore } from "./store";
import { RagPipeline } from "./rag";
import { MemoryConfig } from "./types";
import { resolveConfig } from "./config";

const REQUEST_BODY_LOG_MAX_LENGTH = 2_000;

function getCollectionLabel(req: Request): string | undefined {
    const bodyCollection =
        req.body && typeof req.body === "object" && "collection" in req.body
            ? req.body.collection
            : undefined;
    if (typeof bodyCollection === "string") {
        return bodyCollection;
    }

    return typeof req.query.collection === "string" ? req.query.collection : undefined;
}

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

function parsePositiveIntegerQuery(value: unknown): number | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== "string" || value.trim() === "") {
        return Number.NaN;
    }

    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function parseNonNegativeIntegerQuery(value: unknown): number | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== "string" || value.trim() === "") {
        return Number.NaN;
    }

    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function stringifyRequestBody(body: unknown): string | undefined {
    if (body === undefined) {
        return undefined;
    }

    if (typeof body === "string") {
        return body;
    }

    try {
        const serialized = JSON.stringify(body);
        return serialized ?? String(body);
    } catch {
        return "[unserializable body]";
    }
}

function truncateValue(value: string, maxLength = REQUEST_BODY_LOG_MAX_LENGTH): string {
    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, maxLength)}…`;
}

function httpGetJson(urlString: string): Promise<{ statusCode: number; body: unknown }> {
    return new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const client = url.protocol === "https:" ? https : http;
        const request = client.request(
            url,
            {
                method: "GET",
                timeout: 5_000,
            },
            (response) => {
                let data = "";
                response.setEncoding("utf8");
                response.on("data", (chunk) => {
                    data += chunk;
                });
                response.on("end", () => {
                    const statusCode = response.statusCode ?? 0;
                    if (!data) {
                        resolve({ statusCode, body: undefined });
                        return;
                    }

                    try {
                        resolve({ statusCode, body: JSON.parse(data) as unknown });
                    } catch {
                        resolve({ statusCode, body: data });
                    }
                });
            },
        );

        request.on("error", reject);
        request.on("timeout", () => {
            request.destroy(new Error("Request timed out"));
        });
        request.end();
    });
}

export function createServer(config: MemoryConfig = {}) {
    const resolvedConfig = resolveConfig(config);
    const app = express();
    app.use(express.json());

    if (resolvedConfig.requestLogging !== "off") {
        app.use((req, res, next) => {
            const startedAt = process.hrtime.bigint();

            res.on("finish", () => {
                const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
                const collection = getCollectionLabel(req);
                const collectionSuffix = collection ? ` collection=${collection}` : "";
                const bodySuffix =
                    resolvedConfig.requestLogging === "body"
                        ? (() => {
                              const body = stringifyRequestBody(req.body);
                              return body === undefined ? "" : ` body=${truncateValue(body)}`;
                          })()
                        : "";
                console.log(
                    `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms${collectionSuffix}${bodySuffix}`,
                );
            });

            next();
        });
    }

    const store = new PieceStore(resolvedConfig);
    const rag = new RagPipeline(
        store,
        resolvedConfig.ollamaUrl,
        resolvedConfig.generationModel,
    );
    const chromaHealthClient = new ChromaClient({ path: resolvedConfig.chromaUrl });

    app.get("/health", async (_req: Request, res: Response) => {
        const [chromadb, ollama] = await Promise.all([
            (async () => {
                try {
                    await chromaHealthClient.listCollections();
                    return { status: "ok" as const };
                } catch (err) {
                    return { status: "error" as const, error: String(err) };
                }
            })(),
            (async () => {
                try {
                    const response = await httpGetJson(
                        new URL("/api/tags", resolvedConfig.ollamaUrl).toString(),
                    );
                    if (response.statusCode < 200 || response.statusCode >= 300) {
                        return {
                            status: "error" as const,
                            error: `Unexpected status ${response.statusCode}`,
                        };
                    }

                    const modelCount =
                        response.body &&
                        typeof response.body === "object" &&
                        "models" in response.body &&
                        Array.isArray(response.body.models)
                            ? response.body.models.length
                            : undefined;

                    return {
                        status: "ok" as const,
                        ...(modelCount !== undefined ? { modelCount } : {}),
                    };
                } catch (err) {
                    return { status: "error" as const, error: String(err) };
                }
            })(),
        ]);

        const status = chromadb.status === "ok" && ollama.status === "ok" ? "ok" : "degraded";
        res.status(status === "ok" ? 200 : 503).json({
            status,
            services: {
                api: { status: "ok" },
                chromadb,
                ollama,
            },
        });
    });

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

    app.put("/collections/:name", async (req: Request<{ name: string }>, res: Response) => {
        try {
            const name = req.params.name.trim();
            if (!name) {
                res.status(400).json({ error: "collection name must be a non-empty string" });
                return;
            }

            await store.createCollection(name);
            res.status(204).send();
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    // GET /collections — List all collections
    app.get("/collections", async (_req: Request, res: Response) => {
        try {
            const collections = await store.listCollections();
            res.json({ collections });
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    // DELETE /collections/:name — Delete a collection
    app.delete("/collections/:name", async (req: Request<{ name: string }>, res: Response) => {
        try {
            const { name } = req.params;
            await store.deleteCollection(name);
            res.status(204).send();
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    app.get("/tags", async (req: Request, res: Response) => {
        try {
            const collection = typeof req.query.collection === "string" ? req.query.collection : undefined;
            const limit = parsePositiveIntegerQuery(req.query.limit);
            if (Number.isNaN(limit)) {
                res.status(400).json({ error: "limit must be a positive integer when provided" });
                return;
            }

            const offset = parseNonNegativeIntegerQuery(req.query.offset);
            if (Number.isNaN(offset)) {
                res.status(400).json({ error: "offset must be a non-negative integer when provided" });
                return;
            }

            const tags = await store.listTags(collection);
            const start = offset ?? 0;
            const end = limit !== undefined ? start + limit : undefined;
            res.json({ tags: tags.slice(start, end) });
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    // POST /pieces — Add a piece
    app.post("/pieces", async (req: Request, res: Response) => {
        try {
            const { content, title, tags, collection } = req.body;
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
            if (collection !== undefined && typeof collection !== "string") {
                res.status(400).json({ error: "collection must be a string when provided" });
                return;
            }
            const piece = await store.addPiece(content, tags ?? [], title, collection);
            res.status(201).json(piece);
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    app.get("/pieces", async (req: Request, res: Response) => {
        try {
            const collection = typeof req.query.collection === "string" ? req.query.collection : undefined;
            const limit = parsePositiveIntegerQuery(req.query.limit);
            if (Number.isNaN(limit)) {
                res.status(400).json({ error: "limit must be a positive integer when provided" });
                return;
            }

            const offset = parseNonNegativeIntegerQuery(req.query.offset);
            if (Number.isNaN(offset)) {
                res.status(400).json({ error: "offset must be a non-negative integer when provided" });
                return;
            }

            const pieces = await store.listPieces({ limit, offset }, collection);
            res.json({ pieces });
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    // GET /pieces/:id — Get a piece by ID
    app.get("/pieces/:id", async (req: Request<{ id: string }>, res: Response) => {
        try {
            const { id } = req.params;
            const collection = typeof req.query.collection === "string" ? req.query.collection : undefined;
            const piece = await store.getPiece(id, collection);
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
            const { content, title, tags, collection } = req.body;
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
            if (collection !== undefined && typeof collection !== "string") {
                res.status(400).json({ error: "collection must be a string when provided" });
                return;
            }
            const piece = await store.updatePiece(id, content, tags, validatedTitle, collection);
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
            const collection = typeof req.query.collection === "string" ? req.query.collection : undefined;
            await store.deletePiece(id, collection);
            res.status(204).send();
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    // POST /query — Semantic search
    app.post("/query", async (req: Request, res: Response) => {
        try {
            const { query, tags, topK, useHybridSearch, collection } = req.body;
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
            if (collection !== undefined && typeof collection !== "string") {
                res.status(400).json({ error: "collection must be a string when provided" });
                return;
            }
            const results = await store.queryPieces(query, { tags, topK, useHybridSearch }, collection);
            res.json(results);
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    // POST /rag — Full RAG query
    app.post("/rag", async (req: Request, res: Response) => {
        try {
            const { query, tags, topK, useHybridSearch, collection } = req.body;
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
            if (collection !== undefined && typeof collection !== "string") {
                res.status(400).json({ error: "collection must be a string when provided" });
                return;
            }
            const result = await rag.query(query, { tags, topK, useHybridSearch }, collection);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    return app;
}
