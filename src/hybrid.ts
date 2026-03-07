// ── Hybrid search helpers ────────────────────────────────────────────────────

const STOP_WORDS = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "shall",
    "should", "may", "might", "must", "can", "could", "of", "in", "to",
    "for", "with", "on", "at", "from", "by", "as", "into", "about",
    "it", "its", "this", "that", "and", "or", "but", "not", "no", "so",
]);

export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

export function keywordScore(queryTokens: string[], docText: string): number {
    if (queryTokens.length === 0) return 0;
    const docLower = docText.toLowerCase();
    let matches = 0;
    for (const token of queryTokens) {
        if (docLower.includes(token)) matches++;
    }
    return matches / queryTokens.length;
}

export interface RankedItem<T> {
    item: T;
    score: number;
}

export function reciprocalRankFusion<T>(
    rankings: RankedItem<T>[][],
    idFn: (item: T) => string,
    k = 60,
): RankedItem<T>[] {
    const scores = new Map<string, number>();
    const items = new Map<string, T>();

    for (const ranking of rankings) {
        for (let rank = 0; rank < ranking.length; rank++) {
            const id = idFn(ranking[rank].item);
            scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
            if (!items.has(id)) items.set(id, ranking[rank].item);
        }
    }

    return Array.from(scores.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id, score]) => ({ item: items.get(id)!, score }));
}
