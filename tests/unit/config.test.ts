import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MEMORY_CONFIG, resolveConfig } from "../../src/config";

describe("resolveConfig", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("uses defaults when no config or env overrides are provided", () => {
        expect(resolveConfig()).toEqual(DEFAULT_MEMORY_CONFIG);
    });

    it("uses environment overrides when explicit config is absent", () => {
        vi.stubEnv("CHROMA_URL", "http://chromadb:8000");
        vi.stubEnv("MEMORY_OLLAMA_URL", "http://host.docker.internal:11434");
        vi.stubEnv("EMBEDDING_MODEL", "embed-model");
        vi.stubEnv("MEMORY_GENERATION_MODEL", "generate-model");
        vi.stubEnv("COLLECTION_NAME", "docker-pieces");

        expect(resolveConfig()).toEqual({
            chromaUrl: "http://chromadb:8000",
            ollamaUrl: "http://host.docker.internal:11434",
            embeddingModel: "embed-model",
            generationModel: "generate-model",
            collectionName: "docker-pieces",
            requestLogging: "off",
            logRequests: false,
        });
    });

    it("uses boolean environment overrides for legacy request logging", () => {
        vi.stubEnv("MEMORY_LOG_REQUESTS", "true");

        expect(resolveConfig()).toEqual({
            ...DEFAULT_MEMORY_CONFIG,
            requestLogging: "metadata",
            logRequests: true,
        });
    });

    it("uses explicit request logging mode environment overrides", () => {
        vi.stubEnv("REQUEST_LOGGING", "body");

        expect(resolveConfig()).toEqual({
            ...DEFAULT_MEMORY_CONFIG,
            requestLogging: "body",
            logRequests: true,
        });
    });

    it("prefers explicit config over environment overrides", () => {
        vi.stubEnv("CHROMA_URL", "http://chromadb:8000");
        vi.stubEnv("OLLAMA_URL", "http://host.docker.internal:11434");
        vi.stubEnv("EMBEDDING_MODEL", "embed-model");
        vi.stubEnv("GENERATION_MODEL", "generate-model");
        vi.stubEnv("COLLECTION_NAME", "docker-pieces");
        vi.stubEnv("REQUEST_LOGGING", "metadata");

        expect(
            resolveConfig({
                chromaUrl: "http://localhost:8000",
                ollamaUrl: "http://localhost:11434",
                embeddingModel: "local-embed",
                generationModel: "local-generate",
                collectionName: "local-pieces",
                requestLogging: "body",
            }),
        ).toEqual({
            chromaUrl: "http://localhost:8000",
            ollamaUrl: "http://localhost:11434",
            embeddingModel: "local-embed",
            generationModel: "local-generate",
            collectionName: "local-pieces",
            requestLogging: "body",
            logRequests: true,
        });
    });

    it("maps explicit legacy boolean config to metadata logging", () => {
        expect(
            resolveConfig({
                logRequests: true,
            }),
        ).toEqual({
            ...DEFAULT_MEMORY_CONFIG,
            requestLogging: "metadata",
            logRequests: true,
        });
    });

    it("ignores blank environment variables", () => {
        vi.stubEnv("MEMORY_CHROMA_URL", "   ");
        vi.stubEnv("MEMORY_OLLAMA_URL", "");

        expect(resolveConfig()).toEqual(DEFAULT_MEMORY_CONFIG);
    });

    it("ignores invalid boolean environment variables for request logging", () => {
        vi.stubEnv("MEMORY_LOG_REQUESTS", "yes");

        expect(resolveConfig()).toEqual(DEFAULT_MEMORY_CONFIG);
    });

    it("ignores invalid explicit request logging modes", () => {
        vi.stubEnv("MEMORY_REQUEST_LOGGING", "verbose");

        expect(resolveConfig()).toEqual(DEFAULT_MEMORY_CONFIG);
    });
});
