#!/usr/bin/env node

import { MemoryMcpServer } from "./mcp";

const server = new MemoryMcpServer();
server.start();
