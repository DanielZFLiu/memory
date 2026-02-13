import { Ollama } from "ollama";
import { PieceStore } from "./store";
import { QueryOptions, RagResult } from "./types";

export class RagPipeline {
    private store: PieceStore;
    private ollama: Ollama;
    private model: string;

    constructor(store: PieceStore, ollamaUrl: string, model: string) {
        this.store = store;
        this.ollama = new Ollama({ host: ollamaUrl });
        this.model = model;
    }

    async query(query: string, options: QueryOptions = {}): Promise<RagResult> {
        const sources = await this.store.queryPieces(query, options);

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
