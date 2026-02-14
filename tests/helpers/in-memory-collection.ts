import { vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory ChromaDB collection mock — stores documents and supports basic
// query/get/update/delete operations so we can test the full stack wiring
// without a running ChromaDB instance.
// ---------------------------------------------------------------------------

export interface StoredDoc {
    id: string;
    embedding: number[];
    document: string;
    metadata: Record<string, unknown>;
}

export function createInMemoryCollection() {
    let docs: StoredDoc[] = [];

    return {
        add: vi.fn(async (params: {
            ids: string[];
            embeddings: number[][];
            documents: string[];
            metadatas: Record<string, unknown>[];
        }) => {
            for (let i = 0; i < params.ids.length; i++) {
                docs.push({
                    id: params.ids[i],
                    embedding: params.embeddings[i],
                    document: params.documents[i],
                    metadata: params.metadatas[i],
                });
            }
        }),

        get: vi.fn(async (params: { ids: string[]; include?: string[] }) => {
            const found = docs.filter((d) => params.ids.includes(d.id));
            return {
                ids: found.map((d) => d.id),
                documents: found.map((d) => d.document),
                metadatas: found.map((d) => d.metadata),
            };
        }),

        delete: vi.fn(async (params: { ids: string[] }) => {
            docs = docs.filter((d) => !params.ids.includes(d.id));
        }),

        update: vi.fn(async (params: {
            ids: string[];
            documents?: string[];
            embeddings?: number[][];
            metadatas?: Record<string, unknown>[];
        }) => {
            for (let i = 0; i < params.ids.length; i++) {
                const idx = docs.findIndex((d) => d.id === params.ids[i]);
                if (idx === -1) continue;
                if (params.documents) docs[idx].document = params.documents[i];
                if (params.embeddings) docs[idx].embedding = params.embeddings[i];
                if (params.metadatas) docs[idx].metadata = params.metadatas[i];
            }
        }),

        query: vi.fn(async (params: {
            queryEmbeddings: number[][];
            nResults: number;
            where?: Record<string, unknown>;
            include?: string[];
        }) => {
            // Simple cosine-ish scoring: dot product (works fine for unit vectors)
            const qEmb = params.queryEmbeddings[0];
            let candidates = [...docs];

            // Very basic where-clause support for tag filtering
            if (params.where) {
                candidates = candidates.filter((d) => {
                    const tags = d.metadata.tags as string[] | undefined;
                    if (!tags) return false;
                    return matchesWhere(tags, params.where!);
                });
            }

            // Score by dot product
            const scored = candidates.map((d) => ({
                ...d,
                distance: 1 - dotProduct(qEmb, d.embedding),
            }));

            scored.sort((a, b) => a.distance - b.distance);
            const top = scored.slice(0, params.nResults);

            return {
                ids: [top.map((d) => d.id)],
                documents: [top.map((d) => d.document)],
                metadatas: [top.map((d) => d.metadata)],
                distances: [top.map((d) => d.distance)],
            };
        }),

        // Expose for test assertions
        _docs: () => docs,
        _clear: () => { docs = []; },
    };
}

export function dotProduct(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        sum += a[i] * b[i];
    }
    return sum;
}

export function matchesWhere(tags: string[], where: Record<string, unknown>): boolean {
    if ("$and" in where) {
        return (where.$and as Record<string, unknown>[]).every((clause) =>
            matchesWhere(tags, clause),
        );
    }
    if ("tags" in where) {
        const condition = where.tags as Record<string, string>;
        if ("$contains" in condition) {
            return tags.includes(condition.$contains);
        }
    }
    return true;
}

// ---------------------------------------------------------------------------
// Deterministic embedding mock — produces a simple hash-based vector so that
// similar strings get somewhat similar embeddings for basic ranking tests.
// ---------------------------------------------------------------------------

export function deterministicEmbedding(text: string): number[] {
    const dim = 8;
    const vec = new Array(dim).fill(0);
    for (let i = 0; i < text.length; i++) {
        vec[i % dim] += text.charCodeAt(i) / 1000;
    }
    // Normalize
    const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0)) || 1;
    return vec.map((v: number) => v / norm);
}
