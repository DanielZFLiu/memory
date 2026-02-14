# Manual Test Plan — Memory (Local RAG System)

> **Audience:** An AI agent (e.g. an LLM with tool-use / shell access) acting as a QE tester.
> **Goal:** Execute every section below, record results, then produce a structured report at the end.
> **Platform:** Windows (PowerShell). All commands in this plan are PowerShell-native.

---

## How To Use This Document

1. Read the entire plan first.
2. Execute each section **in order** — later sections depend on data created in earlier ones.
3. For every test step, record: **status** (PASS / FAIL / SKIP), **actual output** (trimmed), and **notes**.
4. After all sections, generate the **Test Report** using the template in §10.

---

## AI Agent Execution Notes

> **These guidelines prevent an AI agent from hanging on interactive prompts or blocking commands.**

- **Non-blocking server commands:** `npm run dev` starts a long-running server that never exits. Run it as a **background/non-blocking** command. Do NOT wait for it to complete — it won't. After launching, wait 3–5 seconds, then verify the server is up by hitting an endpoint.
- **npm install:** Run `npm install` (do **not** use `--no-optional` — esbuild requires its platform-specific optional dependency). If you have a `package-lock.json` present, `npm ci` is faster and fully non-interactive. These commands DO terminate and can be run blocking.
- **Avoid interactive prompts:** Never pipe into a command that might request confirmation. If a command could prompt (e.g., `ollama pull`), ensure the model is already available before running the test plan.
- **Timeouts:** Set reasonable timeouts on HTTP requests. RAG queries (§6) may take 10–60 seconds. Use `Invoke-RestMethod -TimeoutSec 120` if needed.
- **Stopping the server (§8):** Use `Stop-Process` to kill the Node.js process (see §8 for details). Do NOT send Ctrl+C interactively — an AI agent cannot do this reliably.

---

## 0 — Prerequisites Check

Before any functional testing, verify the environment is ready.

| # | Step | Expected | How to verify |
|---|------|----------|---------------|
| 0.1 | Node.js ≥ 18 installed | Version string ≥ 18.x | `node --version` |
| 0.2 | npm dependencies installed | Exit code 0, `node_modules/` exists | `npm install` in project root (blocking — terminates on its own) |
| 0.3 | Ollama is reachable | JSON response with models list | `Invoke-RestMethod http://localhost:11434/api/tags` |
| 0.4 | Embedding model available | `nomic-embed-text-v2-moe` listed | Check the response from 0.3 for the model name |
| 0.5 | Generation model available | `llama3.2` listed | Check the response from 0.3 for the model name |
| 0.6 | ChromaDB is reachable | JSON heartbeat response | `Invoke-RestMethod http://localhost:8000/api/v2/heartbeat` (note: v1 API is deprecated in ChromaDB ≥ 1.x) |
| 0.7 | ChromaDB and npm client versions are compatible | No version mismatch errors | Server: `docker exec <container> pip show chromadb` (if Docker) or `pip show chromadb` (if pip). Client: `node -e "console.log(require('chromadb/package.json').version)"`. Major versions should match. |

> **If any prerequisite fails**, note it and SKIP dependent sections. Do NOT fabricate results.

---

## 1 — Server Startup

| # | Step | Expected |
|---|------|----------|
| 1.1 | Run `npm run dev` as a **non-blocking/background** command. Do NOT wait for it to exit — it is a long-running process. Wait ~5 seconds after launch. | Console output includes `Memory RAG server running on http://localhost:3000` |
| 1.2 | Smoke-check server: `Invoke-RestMethod http://localhost:3000/pieces/nonexistent-id` (expect an error response) | Returns JSON with `"error"` field; HTTP 404 status. In PowerShell, `Invoke-RestMethod` throws on non-2xx — wrap in `try/catch` or use `Invoke-WebRequest` and inspect `StatusCode`. |

> **AI agent tip:** For step 1.1, launch the server non-blocking and do not wait for the process to complete. After a brief delay, proceed to step 1.2 to confirm it started.

Keep the server running for all subsequent sections.

---

## 2 — CRUD Lifecycle (Pieces)

### 2.1 — Create Pieces

Create **at least 5 pieces** with varied content and tags to build a useful test corpus. Use `POST /pieces`.

Suggested seed data (execute each as a separate request). Example PowerShell command for piece 1:

```powershell
Invoke-RestMethod -Uri http://localhost:3000/pieces -Method POST `
  -ContentType "application/json" `
  -Body '{"content": "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.", "tags": ["typescript", "programming", "javascript"]}'
```

All seed data:

```
1. content: "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript."
   tags: ["typescript", "programming", "javascript"]

2. content: "Python is widely used for data science, machine learning, and scripting."
   tags: ["python", "programming", "data-science"]

3. content: "Retrieval-Augmented Generation (RAG) combines search with LLM generation to produce grounded answers."
   tags: ["rag", "ai", "architecture"]

4. content: "Express.js is a minimal web framework for Node.js."
   tags: ["javascript", "web", "node"]

5. content: "ChromaDB is an open-source vector database for AI applications."
   tags: ["database", "ai", "vectors"]
```

**For each request, verify:**

| Check | Expected |
|-------|----------|
| HTTP status | `201` |
| Response body has `id` | Non-empty string (UUID format) |
| Response body `content` | Matches input |
| Response body `tags` | Matches input array |

**Save all returned IDs** — they are needed in later steps. Refer to them as `ID_1` … `ID_5`.

### 2.2 — Read Pieces

| # | Step | Expected |
|---|------|----------|
| 2.2.1 | `GET /pieces/{ID_1}` | 200, body matches piece 1 |
| 2.2.2 | `GET /pieces/{ID_5}` | 200, body matches piece 5 |
| 2.2.3 | `GET /pieces/does-not-exist-abc` | 404, body contains `"error"` |

### 2.3 — Update Pieces

| # | Step | Expected |
|---|------|----------|
| 2.3.1 | `PUT /pieces/{ID_1}` with `{"content": "TypeScript adds static types to JavaScript.", "tags": ["typescript", "programming"]}` | 200, body reflects new content and tags |
| 2.3.2 | `GET /pieces/{ID_1}` after update | Content and tags match the update |
| 2.3.3 | `PUT /pieces/{ID_1}` with only `{"tags": ["typescript"]}` (no content field) | 200, content unchanged from 2.3.1, tags updated |
| 2.3.4 | `PUT /pieces/does-not-exist-abc` with `{"content": "x"}` | 404 |

### 2.4 — Delete Pieces

| # | Step | Expected |
|---|------|----------|
| 2.4.1 | `DELETE /pieces/{ID_5}` | 204, empty body |
| 2.4.2 | `GET /pieces/{ID_5}` after delete | 404 |
| 2.4.3 | `DELETE /pieces/{ID_5}` again (already deleted) | Should not return 500 (204 or 404 acceptable) |

---

## 3 — Input Validation

Test that the API rejects malformed requests gracefully.

| # | Endpoint | Body | Expected Status | Expected Error Contains |
|---|----------|------|-----------------|------------------------|
| 3.1 | `POST /pieces` | `{}` (no content) | 400 | `"content"` |
| 3.2 | `POST /pieces` | `{"content": 123}` | 400 | `"content"` |
| 3.3 | `POST /pieces` | `{"content": ""}` | 400 | `"content"` |
| 3.4 | `POST /query` | `{}` | 400 | `"query"` |
| 3.5 | `POST /query` | `{"query": 42}` | 400 | `"query"` |
| 3.6 | `POST /rag` | `{}` | 400 | `"query"` |
| 3.7 | `POST /rag` | `{"query": false}` | 400 | `"query"` |

---

## 4 — Semantic Search Quality

> **Key evaluation:** An AI tester can and should **judge whether the ranking makes semantic sense**.

Use `POST /query` with `topK: 4` (we have 4 remaining pieces after the delete in §2.4).

| # | Query | Expected Top Result (by content relevance) | Evaluation Criteria |
|---|-------|---------------------------------------------|---------------------|
| 4.1 | `"What programming language adds types to JavaScript?"` | The TypeScript piece (ID_1) should rank #1 | Score of top result should be highest; content is directly relevant |
| 4.2 | `"machine learning and data analysis"` | The Python piece (ID_2) should rank #1 | Python/data-science piece is the most relevant |
| 4.3 | `"web server framework"` | The Express.js piece (ID_4) should rank #1 | Express/Node piece is the most relevant |
| 4.4 | `"How does RAG work?"` | The RAG piece (ID_3) should rank #1 | RAG architecture piece is directly on-topic |

**For each query, verify:**
- Response is a JSON array.
- Each element has `piece` (with `id`, `content`, `tags`) and `score` (number between 0 and 1).
- The ranking order is defensible — briefly explain why the top result is or isn't correct.
- Scores decrease monotonically (or at least non-increasing).

---

## 5 — Tag Filtering

| # | Query | Tags Filter | Expected Behavior |
|---|-------|-------------|-------------------|
| 5.1 | `"programming"` | `["python"]` | Only pieces with the `python` tag are returned. Verify each returned piece's `tags` array contains `"python"`. |
| 5.2 | `"programming"` | `["typescript", "programming"]` | Only pieces with BOTH `typescript` AND `programming` tags are returned (must have BOTH tags) |
| 5.3 | `"anything"` | `["nonexistent-tag-xyz"]` | Empty array returned |
| 5.4 | `"programming"` | `[]` (empty array) | All pieces eligible (no filter applied) |
| 5.5 | `"programming"` | (omit tags field entirely) | All pieces eligible (no filter applied) |

**Verify** that results only contain pieces whose tags include **all** specified filter tags.

---

## 6 — RAG Generation Quality

> **Key evaluation:** An AI tester should judge the quality, groundedness, and citation behavior of the generated answer.

Use `POST /rag`.

| # | Query | Tags | topK | Evaluation Criteria |
|---|-------|------|------|---------------------|
| 6.1 | `"What is TypeScript and how does it relate to JavaScript?"` | `["programming"]` | 5 | Answer should mention static typing, superset, compilation. Should cite source [1] or similar. |
| 6.2 | `"Explain how RAG systems work"` | `["ai"]` | 5 | Answer should reference retrieval + generation. Sources should include the RAG piece. |
| 6.3 | `"What is the best pizza topping?"` | (none) | 5 | Context has no pizza info. Answer should indicate insufficient context. Should NOT hallucinate. |
| 6.4 | `"Compare Python and TypeScript for programming"` | `["programming"]` | 5 | Answer should draw from both the Python and TypeScript pieces. Both should appear in sources. |

**For each RAG query, evaluate:**

1. **Response structure:** Has `answer` (string) and `sources` (array of `{piece, score}`).
2. **Groundedness:** Is every claim in the answer supported by the provided sources? Flag any hallucinated facts.
3. **Citation quality:** Does the answer reference source numbers? Are citations accurate?
4. **Relevance of sources:** Are the retrieved sources appropriate for the question?
5. **Graceful handling of unknowns:** When context is insufficient (6.3), does the model say so instead of guessing?

**Quality rating per query:** Rate each as EXCELLENT / GOOD / ACCEPTABLE / POOR with a one-sentence justification.

---

## 7 — Edge Cases

| # | Test | Method | Expected |
|---|------|--------|----------|
| 7.1 | Create piece with empty tags | `POST /pieces` with `{"content": "No tags at all", "tags": []}` | 201, piece created with `tags: []` |
| 7.2 | Create piece with no tags field | `POST /pieces` with `{"content": "Tags omitted"}` | 201, piece created with `tags: []` (server defaults) |
| 7.3 | Create piece with very long content | `POST /pieces` with content = 5000+ characters of lorem ipsum | 201, content stored and retrievable via GET |
| 7.4 | Create piece with special characters in tags | `POST /pieces` with `{"content": "Special", "tags": ["c++", "c#", "node.js"]}` | 201, tags preserved exactly |
| 7.5 | Create piece with unicode content | `POST /pieces` with `{"content": "日本語テスト — emoji 🚀"}` | 201, content preserved |
| 7.6 | Query with very short query | `POST /query` with `{"query": "a"}` | 200, returns results (may not be relevant, but no crash) |
| 7.7 | Query with very long query | `POST /query` with query = 1000+ characters | 200, no crash |
| 7.8 | RAG with topK: 0 | `POST /rag` with `{"query": "test", "topK": 0}` | Should return empty sources with a fixed "not enough context" message (LLM should NOT be called). Verify no hallucination. |
| 7.9 | RAG with topK: 1 | `POST /rag` with `{"query": "TypeScript", "topK": 1}` | Exactly 1 source returned |
| 7.10 | RAG with tag filter returning no matches | `POST /rag` with `{"query": "test", "tags": ["nonexistent-tag"]}` | Should return empty sources with fixed "not enough context" message. LLM must NOT be called, no hallucination. |

**Clean up** any pieces created in this section by deleting them afterwards.

---

## 8 — Data Integrity After Restart

| # | Step | Expected |
|---|------|----------|
| 8.1 | Stop the server. Find the Node.js process: `Get-Process -Name node -ErrorAction SilentlyContinue` then kill it: `Stop-Process -Name node -Force`. Alternatively, if you launched `npm run dev` in a trackable way, kill by PID. | Server stops; port 3000 is freed |
| 8.2 | Restart the server with `npm run dev` (**non-blocking**, same as §1.1). Wait ~5 seconds. | Starts successfully, console shows listening message |
| 8.3 | `Invoke-RestMethod http://localhost:3000/pieces/{ID_1}` | Still returns the piece from §2 — data persisted in ChromaDB |
| 8.4 | `Invoke-RestMethod -Uri http://localhost:3000/query -Method POST -ContentType "application/json" -Body '{"query": "TypeScript"}'` | Returns results including ID_1 — search still works |

> **AI agent tip:** Stopping the server requires killing the process. Do NOT attempt to send Ctrl+C — use `Stop-Process` as shown above. After stopping, verify port 3000 is free before restarting: `Test-NetConnection -ComputerName localhost -Port 3000` should fail.

---

## 9 — Error Resilience (Optional)

> Only run these if you can safely stop/start infrastructure services.

| # | Scenario | How to Simulate | Expected Server Behavior |
|---|----------|-----------------|--------------------------|
| 9.1 | ChromaDB is down at startup | Stop ChromaDB (Docker: `docker stop <container>`; pip: `Stop-Process -Name chroma -Force`), then send any request to the Memory server | 503 with `"Failed to connect to ChromaDB"` |
| 9.2 | ChromaDB goes down mid-operation | Stop ChromaDB after Memory server is running, then `Invoke-RestMethod -Uri http://localhost:3000/pieces -Method POST -ContentType "application/json" -Body '{"content": "test"}'` | 500 with error message (not a raw crash) |
| 9.3 | Ollama is down | Stop Ollama (`Stop-Process -Name ollama -Force`), then `Invoke-RestMethod -Uri http://localhost:3000/query -Method POST -ContentType "application/json" -Body '{"query": "test"}'` | 500 with error message (not a raw crash) |

> **After testing**, restart any stopped services before continuing. Docker: `docker start <container>`. Ollama: launch `ollama serve` (non-blocking — it is a long-running process).

---

## 10 — Test Report Template

After executing all sections, produce a report in the following format:

```markdown
# Manual Test Report — Memory (Local RAG System)

**Date:** [ISO 8601 date]
**Tester:** [AI agent identifier]
**Server URL:** http://localhost:3000
**Environment:**
- Node.js version: [output of node --version]
- Ollama models: [list]
- ChromaDB: [running / version if available]

## Summary

| Section | Total Tests | Passed | Failed | Skipped |
|---------|-------------|--------|--------|---------|
| 0 — Prerequisites | | | | |
| 1 — Server Startup | | | | |
| 2 — CRUD Lifecycle | | | | |
| 3 — Input Validation | | | | |
| 4 — Semantic Search Quality | | | | |
| 5 — Tag Filtering | | | | |
| 6 — RAG Generation Quality | | | | |
| 7 — Edge Cases | | | | |
| 8 — Data Integrity After Restart | | | | |
| 9 — Error Resilience | | | | |
| **Total** | | | | |

## Overall Verdict: [PASS / FAIL / CONDITIONAL PASS]

## Detailed Results

### Section 0 — Prerequisites
| Test # | Status | Actual Output | Notes |
|--------|--------|---------------|-------|
| 0.1 | | | |
[... one row per test ...]

[Repeat for each section]

### Section 6 — RAG Generation Quality (Extended)
For each RAG test, include:
- **Query:** [the query]
- **Generated Answer:** [full text]
- **Sources Returned:** [list of piece IDs and scores]
- **Groundedness:** [GROUNDED / PARTIALLY GROUNDED / HALLUCINATED]
- **Citation Quality:** [GOOD / FAIR / NONE]
- **Quality Rating:** [EXCELLENT / GOOD / ACCEPTABLE / POOR]
- **Justification:** [one sentence]

## Bugs / Issues Found
- [List any bugs, unexpected behaviors, or concerns discovered during testing]

## Recommendations
- [Suggestions for improving test coverage, fixing issues, or hardening the system]
```

---

## Notes for the AI Tester

- **Be honest.** If a test fails, report it. Do not retry silently and report only the passing attempt.
- **Be precise.** Include actual HTTP status codes and trimmed response bodies.
- **Use your judgment.** For semantic quality tests (§4, §6), you are expected to evaluate whether results are reasonable — explain your reasoning.
- **Clean up.** Delete any test data you created in edge-case sections so the corpus isn't polluted for future runs. Use `Invoke-RestMethod -Uri http://localhost:3000/pieces/<id> -Method DELETE`.
- **Timeouts.** RAG queries may take 10–60 seconds depending on model size. Use `Invoke-RestMethod -TimeoutSec 120` for RAG requests. Wait accordingly before declaring a timeout failure.
- **Idempotency.** This test plan can be run multiple times. Use a fresh ChromaDB collection or clean up the `pieces` collection before running if you want isolated results.
- **HTTP errors in PowerShell.** `Invoke-RestMethod` throws a terminating error on non-2xx status codes. To inspect 4xx/5xx responses, either wrap calls in `try { ... } catch { $_.Exception.Response }` or use `Invoke-WebRequest` which gives you the full response object including `StatusCode`.
- **Non-blocking commands.** Any command that starts a persistent server (`npm run dev`, `ollama serve`, etc.) must be launched non-blocking. Do NOT wait for these to exit — they run indefinitely. Verify they started by polling an endpoint after a short delay.
- **Killing processes.** Use `Stop-Process -Name <name> -Force` or `Stop-Process -Id <PID> -Force` to stop servers. Do NOT rely on Ctrl+C or interactive signals.
