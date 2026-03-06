import { MemoryConfig } from "./types";

export const DEFAULT_MEMORY_CONFIG: Required<MemoryConfig> = {
    chromaUrl: "http://localhost:8000",
    ollamaUrl: "http://localhost:11434",
    embeddingModel: "nomic-embed-text:latest",
    generationModel: "gemma3:latest",
    collectionName: "pieces",
};

export function resolveConfig(config: MemoryConfig = {}): Required<MemoryConfig> {
    return { ...DEFAULT_MEMORY_CONFIG, ...config };
}
