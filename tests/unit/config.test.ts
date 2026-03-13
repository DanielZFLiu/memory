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
            corsOrigins: [],
        });
    });

    it("uses explicit request logging mode environment overrides", () => {
        vi.stubEnv("REQUEST_LOGGING", "body");

        expect(resolveConfig()).toEqual({
            ...DEFAULT_MEMORY_CONFIG,
            requestLogging: "body",
        });
    });

    it("uses explicit cors origin environment overrides", () => {
        vi.stubEnv("MEMORY_CORS_ORIGINS", "http://localhost:5173, https://notes.example.com ");

        expect(resolveConfig()).toEqual({
            ...DEFAULT_MEMORY_CONFIG,
            corsOrigins: ["http://localhost:5173", "https://notes.example.com"],
        });
    });

    it("prefers explicit config over environment overrides", () => {
        vi.stubEnv("CHROMA_URL", "http://chromadb:8000");
        vi.stubEnv("OLLAMA_URL", "http://host.docker.internal:11434");
        vi.stubEnv("EMBEDDING_MODEL", "embed-model");
        vi.stubEnv("GENERATION_MODEL", "generate-model");
        vi.stubEnv("COLLECTION_NAME", "docker-pieces");
        vi.stubEnv("REQUEST_LOGGING", "metadata");
        vi.stubEnv("CORS_ORIGINS", "https://from-env.example.com");

        expect(
            resolveConfig({
                chromaUrl: "http://localhost:8000",
                ollamaUrl: "http://localhost:11434",
                embeddingModel: "local-embed",
                generationModel: "local-generate",
                collectionName: "local-pieces",
                requestLogging: "body",
                corsOrigins: ["http://localhost:5173"],
            }),
        ).toEqual({
            chromaUrl: "http://localhost:8000",
            ollamaUrl: "http://localhost:11434",
            embeddingModel: "local-embed",
            generationModel: "local-generate",
            collectionName: "local-pieces",
            requestLogging: "body",
            corsOrigins: ["http://localhost:5173"],
        });
    });

    it("ignores blank environment variables", () => {
        vi.stubEnv("MEMORY_CHROMA_URL", "   ");
        vi.stubEnv("MEMORY_OLLAMA_URL", "");
        vi.stubEnv("MEMORY_CORS_ORIGINS", "   ");

        expect(resolveConfig()).toEqual(DEFAULT_MEMORY_CONFIG);
    });

    it("ignores invalid explicit request logging modes", () => {
        vi.stubEnv("MEMORY_REQUEST_LOGGING", "verbose");

        expect(resolveConfig()).toEqual(DEFAULT_MEMORY_CONFIG);
    });
});
