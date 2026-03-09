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

    async query(query: string, options: QueryOptions = {}, collection?: string): Promise<RagResult> {
        const sources = await this.store.queryPieces(query, options, collection);

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
                    `[${i + 1}]${s.piece.title ? ` ${s.piece.title}` : ""} (tags: ${s.piece.tags.join(", ")})\n${s.piece.content}`,
            )
            .join("\n\n");

        const systemPrompt =
            "You are a retrieval-grounded assistant. Answer the user's question using only the provided context. " +
            "Do not use outside knowledge, background assumptions, or examples that are not explicitly supported by the context. " +
            "If the context is incomplete or does not answer the question, say that you do not have enough context instead of guessing. " +
            "Keep the answer concise. Cite sources for every supported factual claim with source numbers like [1].";

        const userPrompt =
            `Context:\n${contextBlock}\n\n` +
            `Question: ${query}\n\n` +
            "Instructions:\n" +
            "- Use only the context above.\n" +
            "- Do not mention tools, frameworks, companies, or facts that do not appear in the context.\n" +
            "- If the context is insufficient, explicitly say so.\n" +
            "- Cite supported statements with source numbers.";

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
