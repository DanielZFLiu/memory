import { ChromaClient, Collection, IncludeEnum } from "chromadb";
import { v4 as uuidv4 } from "uuid";
import { EmbeddingClient } from "./embeddings";
import { tokenize, keywordScore, reciprocalRankFusion, RankedItem } from "./hybrid";
import {
    Piece,
    MemoryConfig,
    QueryOptions,
    QueryResult,
} from "./types";
import { resolveConfig } from "./config";

type ChromaMetadataValue = string | number | boolean;
type ChromaMetadata = Record<string, ChromaMetadataValue>;

function toTagMetadataKey(tag: string): string {
    return `tag_${Buffer.from(tag, "utf8").toString("base64url")}`;
}

function toChromaMetadata(tags: string[], title?: string): ChromaMetadata {
    const normalizedTags = normalizeTags(tags);
    const normalizedTitle = normalizeTitle(title);

    return {
        tags: JSON.stringify(normalizedTags),
        ...Object.fromEntries(
            normalizedTags.map((tag) => [toTagMetadataKey(tag), true]),
        ),
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

function toPiece(
    id: string,
    content: string | null | undefined,
    metadata: Record<string, unknown> | null | undefined,
): Piece {
    const title = parseTitle(metadata);

    return {
        id,
        content: content ?? "",
        ...(title !== undefined ? { title } : {}),
        tags: parseTags(metadata),
    };
}

function toEmbeddingText(content: string, title?: string): string {
    return title ? `${title}\n\n${content}` : content;
}

function buildTagWhereClause(tags: string[]): Record<string, unknown> | undefined {
    if (tags.length === 0) {
        return undefined;
    }

    if (tags.length === 1) {
        return { [toTagMetadataKey(tags[0])]: true };
    }

    return {
        $and: tags.map((tag) => ({
            [toTagMetadataKey(tag)]: true,
        })),
    };
}

export class PieceStore {
    private readonly chromaClient: ChromaClient;
    private readonly embeddingClient: EmbeddingClient;
    private readonly collectionCache: Map<string, Collection> = new Map();
    private initialized = false;
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
        const collection = await this.chromaClient.getOrCreateCollection({
            name: this.config.collectionName,
            metadata: { "hnsw:space": "cosine" },
        });
        this.collectionCache.set(this.config.collectionName, collection);
        this.initialized = true;
    }

    private async resolveCollection(name?: string): Promise<Collection> {
        if (!this.initialized) {
            throw new Error("PieceStore not initialized. Call init() first.");
        }
        const collectionName = name ?? this.config.collectionName;
        let collection = this.collectionCache.get(collectionName);
        if (!collection) {
            collection = await this.chromaClient.getOrCreateCollection({
                name: collectionName,
                metadata: { "hnsw:space": "cosine" },
            });
            this.collectionCache.set(collectionName, collection);
        }
        return collection;
    }

    async listCollections(): Promise<string[]> {
        if (!this.initialized) {
            throw new Error("PieceStore not initialized. Call init() first.");
        }
        return this.chromaClient.listCollections();
    }

    async deleteCollection(name: string): Promise<void> {
        if (!this.initialized) {
            throw new Error("PieceStore not initialized. Call init() first.");
        }
        await this.chromaClient.deleteCollection({ name });
        this.collectionCache.delete(name);
    }

    async addPiece(content: string, tags: string[], title?: string, collection?: string): Promise<Piece> {
        const col = await this.resolveCollection(collection);
        const id = uuidv4();
        const embedding = await this.embeddingClient.embed(
            toEmbeddingText(content, title),
        );

        await col.add({
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

    async getPiece(id: string, collection?: string): Promise<Piece | null> {
        const col = await this.resolveCollection(collection);
        const result = await col.get({
            ids: [id],
            include: [IncludeEnum.Documents, IncludeEnum.Metadatas],
        });

        if (!result.ids.length) return null;

        return toPiece(result.ids[0], result.documents[0], result.metadatas[0]);
    }

    async listPieces(
        options: { limit?: number; offset?: number } = {},
        collection?: string,
    ): Promise<Piece[]> {
        const col = await this.resolveCollection(collection);
        const result = await col.get({
            ...(options.limit !== undefined ? { limit: options.limit } : {}),
            ...(options.offset !== undefined ? { offset: options.offset } : {}),
            include: [IncludeEnum.Documents, IncludeEnum.Metadatas],
        } as Parameters<Collection["get"]>[0]);

        return result.ids.map((id, index) =>
            toPiece(id, result.documents[index], result.metadatas[index]),
        );
    }

    async listTags(collection?: string): Promise<string[]> {
        const col = await this.resolveCollection(collection);
        const result = await col.get({
            include: [IncludeEnum.Metadatas],
        } as Parameters<Collection["get"]>[0]);

        const tags = new Set<string>();
        for (const metadata of result.metadatas) {
            for (const tag of parseTags(metadata)) {
                tags.add(tag);
            }
        }

        return Array.from(tags).sort((left, right) => left.localeCompare(right));
    }

    async deletePiece(id: string, collection?: string): Promise<void> {
        const col = await this.resolveCollection(collection);
        await col.delete({ ids: [id] });
    }

    async updatePiece(
        id: string,
        content?: string,
        tags?: string[],
        title?: string | null,
        collection?: string,
    ): Promise<Piece | null> {
        const col = await this.resolveCollection(collection);
        const existing = await this.getPiece(id, collection);
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
        }

        if (content !== undefined || title !== undefined) {
            updateData.embeddings = [
                await this.embeddingClient.embed(
                    toEmbeddingText(newContent, newTitle),
                ),
            ];
        }

        await col.update(updateData);

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
        collection?: string,
    ): Promise<QueryResult[]> {
        const col = await this.resolveCollection(collection);
        const { tags, topK = 10, useHybridSearch = false } = options;

        const queryEmbedding = await this.embeddingClient.embed(query);

        const whereClause = buildTagWhereClause(tags ?? []);

        const fetchK = useHybridSearch ? topK * 3 : topK;

        const results = await col.query({
            queryEmbeddings: [queryEmbedding],
            nResults: fetchK,
            where: whereClause,
            include: [
                IncludeEnum.Documents,
                IncludeEnum.Metadatas,
                IncludeEnum.Distances,
            ],
        });

        const ids = results.ids[0] ?? [];
        const documents = results.documents[0] ?? [];
        const metadatas = results.metadatas[0] ?? [];
        const distances = results.distances?.[0] ?? [];

        const queryResults: QueryResult[] = [];
        for (let i = 0; i < ids.length; i++) {
            queryResults.push({
                piece: toPiece(ids[i], documents[i], metadatas[i]),
                score: 1 - (distances[i] ?? 0), // cosine distance → similarity
            });
        }

        if (!useHybridSearch) {
            return queryResults;
        }

        // ── Hybrid: RRF merge of vector ranking + keyword ranking ────────
        const queryTokens = tokenize(query);

        const vectorRanking: RankedItem<QueryResult>[] = queryResults.map((r) => ({
            item: r,
            score: r.score,
        }));

        const keywordRanking: RankedItem<QueryResult>[] = queryResults
            .map((r) => ({
                item: r,
                score: keywordScore(
                    queryTokens,
                    toEmbeddingText(r.piece.content, r.piece.title),
                ),
            }))
            .filter((r) => r.score > 0)
            .sort((a, b) => b.score - a.score);

        const fused = reciprocalRankFusion(
            [vectorRanking, keywordRanking],
            (r) => r.piece.id,
        );

        return fused.slice(0, topK).map((f) => ({
            ...f.item,
            score: f.score,
        }));
    }
}
