import { Ollama } from "ollama";
import { PieceStore } from "./store";
import { QueryOptions, RagResult } from "./types";

export class RagPipeline {
    private readonly store: PieceStore;
    private readonly ollama: Ollama;
    private readonly model: string;

    constructor(store: PieceStore, ollamaUrl: string, model: string) {
        this.store = store;
        this.ollama = new Ollama({ host: ollamaUrl });
        this.model = model;
    }

    async query(query: string, options: QueryOptions = {}): Promise<RagResult> {
        const sources = await this.store.queryPieces(query, options);

        if (sources.length === 0) {
            return {
                answer:
                    "I don't have enough context to answer this question. " +
                    "No relevant pieces were found in the knowledge base.",
                sources: [],
            };
        }

        const contextBlock = sources
            .map(
                (s, i) =>
                    `[${i + 1}] (tags: ${s.piece.tags.join(", ")})\n${s.piece.content}`,
            )
            .join("\n\n");

        const systemPrompt =
            "You are a helpful assistant. Answer the user's question based on the provided context. " +
            "If the context does not contain enough information, say so. " +
            "Cite sources by their number when relevant.";

        const userPrompt = `Context:\n${contextBlock}\n\nQuestion: ${query}`;

        const response = await this.ollama.chat({
            model: this.model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
        });

        return {
            answer: response.message.content,
            sources,
        };
    }
}
