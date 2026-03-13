export interface Piece {
    id: string;
    content: string;
    title?: string;
    tags: string[];
}

export type RequestLoggingMode = "off" | "metadata" | "body";

export interface MemoryConfig {
    chromaUrl?: string;
    ollamaUrl?: string;
    embeddingModel?: string;
    generationModel?: string;
    collectionName?: string;
    requestLogging?: RequestLoggingMode;
    logRequests?: boolean;
}

export interface QueryOptions {
    tags?: string[];
    topK?: number;
    useHybridSearch?: boolean;
}

export interface QueryResult {
    piece: Piece;
    score: number;
}

export interface RagResult {
    answer: string;
    sources: QueryResult[];
}
