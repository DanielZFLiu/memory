import { Ollama } from "ollama";

export class EmbeddingClient {
    private readonly client: Ollama;
    private readonly model: string;

    constructor(ollamaUrl: string, model: string) {
        this.client = new Ollama({ host: ollamaUrl });
        this.model = model;
    }

    async embed(text: string): Promise<number[]> {
        const response = await this.client.embed({
            model: this.model,
            input: text,
        });
        return response.embeddings[0];
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const response = await this.client.embed({
            model: this.model,
            input: texts,
        });
        return response.embeddings;
    }
}
