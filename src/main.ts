#!/usr/bin/env node

import { MemoryMcpServer } from "./mcp";

const server = new MemoryMcpServer();
server.start().catch((err) => {
    console.error("Failed to start MCP server:", err);
    process.exit(1);
});
