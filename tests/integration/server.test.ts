import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const {
  mockInit,
  mockAddPiece,
  mockGetPiece,
  mockUpdatePiece,
  mockDeletePiece,
  mockQueryPieces,
  mockRagQuery,
} = vi.hoisted(() => ({
  mockInit: vi.fn().mockResolvedValue(undefined),
  mockAddPiece: vi.fn(),
  mockGetPiece: vi.fn(),
  mockUpdatePiece: vi.fn(),
  mockDeletePiece: vi.fn(),
  mockQueryPieces: vi.fn(),
  mockRagQuery: vi.fn(),
}));

vi.mock("../../src/store", () => ({
  PieceStore: class MockPieceStore {
    init = mockInit;
    addPiece = mockAddPiece;
    getPiece = mockGetPiece;
    updatePiece = mockUpdatePiece;
    deletePiece = mockDeletePiece;
    queryPieces = mockQueryPieces;
  },
}));

vi.mock("../../src/rag", () => ({
  RagPipeline: class MockRagPipeline {
    query = mockRagQuery;
  },
}));

import { createServer } from "../../src/server";

describe("Express API", () => {
  let app: ReturnType<typeof createServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInit.mockResolvedValue(undefined);
    app = createServer();
  });

  describe("POST /pieces", () => {
    it("creates a piece and returns 201", async () => {
      mockAddPiece.mockResolvedValueOnce({
        id: "new-id",
        content: "Hello",
        tags: ["greeting"],
      });

      const res = await request(app)
        .post("/pieces")
        .send({ content: "Hello", tags: ["greeting"] });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: "new-id",
        content: "Hello",
        tags: ["greeting"],
      });
      expect(mockAddPiece).toHaveBeenCalledWith("Hello", ["greeting"]);
    });

    it("defaults tags to empty array when omitted", async () => {
      mockAddPiece.mockResolvedValueOnce({
        id: "new-id",
        content: "No tags",
        tags: [],
      });

      await request(app).post("/pieces").send({ content: "No tags" });

      expect(mockAddPiece).toHaveBeenCalledWith("No tags", []);
    });

    it("returns 400 when content is missing", async () => {
      const res = await request(app).post("/pieces").send({ tags: ["x"] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("content");
    });

    it("returns 400 when content is not a string", async () => {
      const res = await request(app).post("/pieces").send({ content: 123 });

      expect(res.status).toBe(400);
    });

    it("returns 500 when store throws", async () => {
      mockAddPiece.mockRejectedValueOnce(new Error("ChromaDB down"));

      const res = await request(app)
        .post("/pieces")
        .send({ content: "test" });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain("ChromaDB down");
    });
  });

  describe("GET /pieces/:id", () => {
    it("returns a piece when found", async () => {
      mockGetPiece.mockResolvedValueOnce({
        id: "id-1",
        content: "Found it",
        tags: ["test"],
      });

      const res = await request(app).get("/pieces/id-1");

      expect(res.status).toBe(200);
      expect(res.body.content).toBe("Found it");
    });

    it("returns 404 when not found", async () => {
      mockGetPiece.mockResolvedValueOnce(null);

      const res = await request(app).get("/pieces/nonexistent");

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /pieces/:id", () => {
    it("updates and returns the piece", async () => {
      mockUpdatePiece.mockResolvedValueOnce({
        id: "id-1",
        content: "Updated",
        tags: ["new"],
      });

      const res = await request(app)
        .put("/pieces/id-1")
        .send({ content: "Updated", tags: ["new"] });

      expect(res.status).toBe(200);
      expect(res.body.content).toBe("Updated");
    });

    it("returns 404 when piece does not exist", async () => {
      mockUpdatePiece.mockResolvedValueOnce(null);

      const res = await request(app)
        .put("/pieces/nonexistent")
        .send({ content: "x" });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /pieces/:id", () => {
    it("returns 204 on success", async () => {
      mockDeletePiece.mockResolvedValueOnce(undefined);

      const res = await request(app).delete("/pieces/id-1");

      expect(res.status).toBe(204);
      expect(mockDeletePiece).toHaveBeenCalledWith("id-1");
    });
  });

  describe("POST /query", () => {
    it("returns search results", async () => {
      mockQueryPieces.mockResolvedValueOnce([
        {
          piece: { id: "1", content: "Result", tags: ["a"] },
          score: 0.9,
        },
      ]);

      const res = await request(app)
        .post("/query")
        .send({ query: "search term", topK: 5 });

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].score).toBe(0.9);
      expect(mockQueryPieces).toHaveBeenCalledWith("search term", {
        tags: undefined,
        topK: 5,
      });
    });

    it("passes tag filters", async () => {
      mockQueryPieces.mockResolvedValueOnce([]);

      await request(app)
        .post("/query")
        .send({ query: "test", tags: ["python"] });

      expect(mockQueryPieces).toHaveBeenCalledWith("test", {
        tags: ["python"],
        topK: undefined,
      });
    });

    it("returns 400 when query is missing", async () => {
      const res = await request(app).post("/query").send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("query");
    });
  });

  describe("POST /rag", () => {
    it("returns generated answer with sources", async () => {
      mockRagQuery.mockResolvedValueOnce({
        answer: "Generated answer",
        sources: [
          {
            piece: { id: "1", content: "Source", tags: ["a"] },
            score: 0.8,
          },
        ],
      });

      const res = await request(app)
        .post("/rag")
        .send({ query: "What is X?", tags: ["a"], topK: 3 });

      expect(res.status).toBe(200);
      expect(res.body.answer).toBe("Generated answer");
      expect(res.body.sources).toHaveLength(1);
    });

    it("returns 400 when query is missing", async () => {
      const res = await request(app).post("/rag").send({});

      expect(res.status).toBe(400);
    });

    it("returns 500 when rag pipeline throws", async () => {
      mockRagQuery.mockRejectedValueOnce(new Error("Ollama timeout"));

      const res = await request(app)
        .post("/rag")
        .send({ query: "test" });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain("Ollama timeout");
    });
  });

  describe("ChromaDB initialization", () => {
    it("returns 503 when ChromaDB init fails", async () => {
      mockInit.mockRejectedValueOnce(new Error("Connection refused"));

      const failApp = createServer();
      const res = await request(failApp).get("/pieces/any-id");

      expect(res.status).toBe(503);
      expect(res.body.error).toContain("Failed to connect to ChromaDB");
    });
  });
});
