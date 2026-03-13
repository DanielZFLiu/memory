import { MemoryConfig, RequestLoggingMode } from "./types";

export const DEFAULT_MEMORY_CONFIG: Required<MemoryConfig> = {
    chromaUrl: "http://localhost:8000",
    ollamaUrl: "http://localhost:11434",
    embeddingModel: "nomic-embed-text-v2-moe:latest",
    generationModel: "gemma3:latest",
    collectionName: "pieces",
    requestLogging: "off",
};

const ENV_CONFIG_KEYS: Record<keyof Required<MemoryConfig>, string[]> = {
    chromaUrl: ["MEMORY_CHROMA_URL", "CHROMA_URL"],
    ollamaUrl: ["MEMORY_OLLAMA_URL", "OLLAMA_URL"],
    embeddingModel: ["MEMORY_EMBEDDING_MODEL", "EMBEDDING_MODEL"],
    generationModel: ["MEMORY_GENERATION_MODEL", "GENERATION_MODEL"],
    collectionName: ["MEMORY_COLLECTION_NAME", "COLLECTION_NAME"],
    requestLogging: ["MEMORY_REQUEST_LOGGING", "REQUEST_LOGGING"],
};

function resolveEnvOverride(keys: string[]): string | undefined {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) {
            return value;
        }
    }

    return undefined;
}

function resolveRequestLoggingEnvOverride(keys: string[]): RequestLoggingMode | undefined {
    const value = resolveEnvOverride(keys);
    if (value === undefined) {
        return undefined;
    }

    const normalized = value.toLowerCase();
    if (normalized === "off" || normalized === "metadata" || normalized === "body") {
        return normalized;
    }

    return undefined;
}

export function resolveConfig(config: MemoryConfig = {}): Required<MemoryConfig> {
    const envRequestLogging = resolveRequestLoggingEnvOverride(ENV_CONFIG_KEYS.requestLogging);
    const requestLogging =
        config.requestLogging ??
        envRequestLogging ??
        DEFAULT_MEMORY_CONFIG.requestLogging;

    return {
        chromaUrl:
            config.chromaUrl ??
            resolveEnvOverride(ENV_CONFIG_KEYS.chromaUrl) ??
            DEFAULT_MEMORY_CONFIG.chromaUrl,
        ollamaUrl:
            config.ollamaUrl ??
            resolveEnvOverride(ENV_CONFIG_KEYS.ollamaUrl) ??
            DEFAULT_MEMORY_CONFIG.ollamaUrl,
        embeddingModel:
            config.embeddingModel ??
            resolveEnvOverride(ENV_CONFIG_KEYS.embeddingModel) ??
            DEFAULT_MEMORY_CONFIG.embeddingModel,
        generationModel:
            config.generationModel ??
            resolveEnvOverride(ENV_CONFIG_KEYS.generationModel) ??
            DEFAULT_MEMORY_CONFIG.generationModel,
        collectionName:
            config.collectionName ??
            resolveEnvOverride(ENV_CONFIG_KEYS.collectionName) ??
            DEFAULT_MEMORY_CONFIG.collectionName,
        requestLogging,
    };
}
