import { ChromaClient, Collection, IncludeEnum } from "chromadb";
import { v4 as uuidv4 } from "uuid";
import { EmbeddingClient } from "./embeddings";
import {
    Piece,
    PieceStoreConfig,
    DEFAULT_CONFIG,
    QueryOptions,
    QueryResult,
} from "./types";

export function encodeTags(tags: string[]): string {
    return "," + tags.join(",") + ",";
}

export function decodeTags(encoded: string): string[] {
    return encoded.slice(1, -1).split(",").filter(Boolean);
}

export class PieceStore {
    private chromaClient: ChromaClient;
    private embeddingClient: EmbeddingClient;
    private collection: Collection | null = null;
    private config: Required<PieceStoreConfig>;

    constructor(config: PieceStoreConfig = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
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

    async addPiece(content: string, tags: string[]): Promise<Piece> {
        const collection = this.getCollection();
        const id = uuidv4();
        const embedding = await this.embeddingClient.embed(content);

        await collection.add({
            ids: [id],
            embeddings: [embedding],
            documents: [content],
            metadatas: [{ tags: encodeTags(tags) }],
        });

        return { id, content, tags };
    }

    async getPiece(id: string): Promise<Piece | null> {
        const collection = this.getCollection();
        const result = await collection.get({
            ids: [id],
            include: [IncludeEnum.Documents, IncludeEnum.Metadatas],
        });

        if (!result.ids.length) return null;

        return {
            id: result.ids[0],
            content: result.documents[0] ?? "",
            tags: decodeTags((result.metadatas[0]?.tags as string) ?? ""),
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
    ): Promise<Piece | null> {
        const collection = this.getCollection();
        const existing = await this.getPiece(id);
        if (!existing) return null;

        const newContent = content ?? existing.content;
        const newTags = tags ?? existing.tags;

        const updateData: {
            ids: string[];
            documents?: string[];
            embeddings?: number[][];
            metadatas?: Record<string, string>[];
        } = {
            ids: [id],
            metadatas: [{ tags: encodeTags(newTags) }],
        };

        if (content !== undefined) {
            updateData.documents = [newContent];
            updateData.embeddings = [
                await this.embeddingClient.embed(newContent),
            ];
        }

        await collection.update(updateData);

        return { id, content: newContent, tags: newTags };
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
                whereClause = { tags: { $contains: `,${tags[0]},` } };
            } else {
                whereClause = {
                    $and: tags.map((tag) => ({
                        tags: { $contains: `,${tag},` },
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
            queryResults.push({
                piece: {
                    id: ids[i],
                    content: documents[i] ?? "",
                    tags: decodeTags((metadatas[i]?.tags as string) ?? ""),
                },
                score: 1 - (distances[i] ?? 0), // cosine distance → similarity
            });
        }

        return queryResults;
    }
}
