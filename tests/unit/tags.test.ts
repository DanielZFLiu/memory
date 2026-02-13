import { describe, it, expect } from "vitest";
import { encodeTags, decodeTags } from "../../src/store";

describe("encodeTags", () => {
  it("encodes a single tag with sentinel commas", () => {
    expect(encodeTags(["python"])).toBe(",python,");
  });

  it("encodes multiple tags", () => {
    expect(encodeTags(["python", "rag", "tutorial"])).toBe(",python,rag,tutorial,");
  });

  it("encodes an empty array to just two commas", () => {
    expect(encodeTags([])).toBe(",,");
  });
});

describe("decodeTags", () => {
  it("decodes a single tag", () => {
    expect(decodeTags(",python,")).toEqual(["python"]);
  });

  it("decodes multiple tags", () => {
    expect(decodeTags(",python,rag,tutorial,")).toEqual(["python", "rag", "tutorial"]);
  });

  it("decodes empty sentinel to empty array", () => {
    expect(decodeTags(",,")).toEqual([]);
  });

  it("handles empty string gracefully", () => {
    expect(decodeTags("")).toEqual([]);
  });
});

describe("tag encoding roundtrip", () => {
  it("roundtrips a tag list", () => {
    const tags = ["alpha", "beta", "gamma"];
    expect(decodeTags(encodeTags(tags))).toEqual(tags);
  });

  it("roundtrips empty list", () => {
    expect(decodeTags(encodeTags([]))).toEqual([]);
  });

  it("roundtrips single tag", () => {
    expect(decodeTags(encodeTags(["solo"]))).toEqual(["solo"]);
  });
});

describe("tag sentinel prevents substring false positives", () => {
  it("searching for ',art,' does not match ',start,'", () => {
    const encoded = encodeTags(["start", "music"]);
    expect(encoded.includes(",art,")).toBe(false);
  });

  it("searching for ',art,' matches when 'art' is a real tag", () => {
    const encoded = encodeTags(["start", "art", "music"]);
    expect(encoded.includes(",art,")).toBe(true);
  });
});
