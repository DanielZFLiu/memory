export interface Piece {
    id: string;
    content: string;
    tags: string[];
}

export interface MemoryConfig {
    chromaUrl?: string;
    ollamaUrl?: string;
    embeddingModel?: string;
    generationModel?: string;
    collectionName?: string;
}

export const DEFAULT_MEMORY_CONFIG: Required<MemoryConfig> = {
    chromaUrl: "http://localhost:8000",
    ollamaUrl: "http://localhost:11434",
    embeddingModel: "nomic-embed-text-v2-moe",
    generationModel: "llama3.2",
    collectionName: "pieces",
};

export interface QueryOptions {
    tags?: string[];
    topK?: number;
}

export interface QueryResult {
    piece: Piece;
    score: number;
}

export interface RagResult {
    answer: string;
    sources: QueryResult[];
}
