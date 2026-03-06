import { ChromaClient, Collection, IncludeEnum } from "chromadb";
import { v4 as uuidv4 } from "uuid";
import { EmbeddingClient } from "./embeddings";
import {
    Piece,
    MemoryConfig,
    QueryOptions,
    QueryResult,
} from "./types";
import { resolveConfig } from "./config";

type ChromaMetadataValue = string | number | boolean;
type ChromaMetadata = Record<string, ChromaMetadataValue>;

function toChromaMetadata(tags: string[], title?: string): ChromaMetadata {
    const normalizedTags = normalizeTags(tags);
    const normalizedTitle = normalizeTitle(title);

    return {
        tags: JSON.stringify(normalizedTags),
        ...(normalizedTitle !== undefined ? { title: normalizedTitle } : {}),
    };
}

function normalizeTags(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((tag): tag is string => typeof tag === "string");
    }
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value) as unknown;
            return Array.isArray(parsed)
                ? parsed.filter((tag): tag is string => typeof tag === "string")
                : [];
        } catch {
            return [];
        }
    }
    return [];
}

function normalizeTitle(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function parseTags(metadata: Record<string, unknown> | null | undefined): string[] {
    return normalizeTags(metadata?.tags);
}

function parseTitle(metadata: Record<string, unknown> | null | undefined): string | undefined {
    return normalizeTitle(metadata?.title);
}

export class PieceStore {
    private readonly chromaClient: ChromaClient;
    private readonly embeddingClient: EmbeddingClient;
    private collection: Collection | null = null;
    private readonly config: Required<MemoryConfig>;

    constructor(config: MemoryConfig = {}) {
        this.config = resolveConfig(config);
        this.chromaClient = new ChromaClient({ path: this.config.chromaUrl });
        this.embeddingClient = new EmbeddingClient(
            this.config.ollamaUrl,
            this.config.embeddingModel,
        );
    }

    async init(): Promise<void> {
        this.collection = await this.chromaClient.getOrCreateCollection({
            name: this.config.collectionName,
            metadata: { "hnsw:space": "cosine" },
        });
    }

    private getCollection(): Collection {
        if (!this.collection) {
            throw new Error("PieceStore not initialized. Call init() first.");
        }
        return this.collection;
    }

    async addPiece(content: string, tags: string[], title?: string): Promise<Piece> {
        const collection = this.getCollection();
        const id = uuidv4();
        const embedding = await this.embeddingClient.embed(content);

        await collection.add({
            ids: [id],
            embeddings: [embedding],
            documents: [content],
            metadatas: [toChromaMetadata(tags, title)],
        });

        return {
            id,
            content,
            ...(title !== undefined ? { title } : {}),
            tags,
        };
    }

    async getPiece(id: string): Promise<Piece | null> {
        const collection = this.getCollection();
        const result = await collection.get({
            ids: [id],
            include: [IncludeEnum.Documents, IncludeEnum.Metadatas],
        });

        if (!result.ids.length) return null;

        const title = parseTitle(result.metadatas[0]);

        return {
            id: result.ids[0],
            content: result.documents[0] ?? "",
            ...(title !== undefined ? { title } : {}),
            tags: parseTags(result.metadatas[0]),
        };
    }

    async deletePiece(id: string): Promise<void> {
        const collection = this.getCollection();
        await collection.delete({ ids: [id] });
    }

    async updatePiece(
        id: string,
        content?: string,
        tags?: string[],
        title?: string | null,
    ): Promise<Piece | null> {
        const collection = this.getCollection();
        const existing = await this.getPiece(id);
        if (!existing) return null;

        const newContent = content ?? existing.content;
        const newTags = tags ?? existing.tags;
        const newTitle = title === undefined ? existing.title : title ?? undefined;

        const updateData: {
            ids: string[];
            documents?: string[];
            embeddings?: number[][];
            metadatas?: ChromaMetadata[];
        } = {
            ids: [id],
            metadatas: [toChromaMetadata(newTags, newTitle)],
        };

        if (content !== undefined) {
            updateData.documents = [newContent];
            updateData.embeddings = [
                await this.embeddingClient.embed(newContent),
            ];
        }

        await collection.update(updateData);

        return {
            id,
            content: newContent,
            ...(newTitle !== undefined ? { title: newTitle } : {}),
            tags: newTags,
        };
    }

    async queryPieces(
        query: string,
        options: QueryOptions = {},
    ): Promise<QueryResult[]> {
        const collection = this.getCollection();
        const { tags, topK = 10 } = options;

        const queryEmbedding = await this.embeddingClient.embed(query);

        let whereClause: Record<string, unknown> | undefined;
        if (tags && tags.length > 0) {
            if (tags.length === 1) {
                whereClause = { tags: { $contains: tags[0] } };
            } else {
                whereClause = {
                    $and: tags.map((tag) => ({
                        tags: { $contains: tag },
                    })),
                };
            }
        }

        const results = await collection.query({
            queryEmbeddings: [queryEmbedding],
            nResults: topK,
            where: whereClause,
            include: [
                IncludeEnum.Documents,
                IncludeEnum.Metadatas,
                IncludeEnum.Distances,
            ],
        });

        const queryResults: QueryResult[] = [];
        const ids = results.ids[0] ?? [];
        const documents = results.documents[0] ?? [];
        const metadatas = results.metadatas[0] ?? [];
        const distances = results.distances?.[0] ?? [];

        for (let i = 0; i < ids.length; i++) {
            const title = parseTitle(metadatas[i]);
            queryResults.push({
                piece: {
                    id: ids[i],
                    content: documents[i] ?? "",
                    ...(title !== undefined ? { title } : {}),
                    tags: parseTags(metadatas[i]),
                },
                score: 1 - (distances[i] ?? 0), // cosine distance → similarity
            });
        }

        return queryResults;
    }
}
