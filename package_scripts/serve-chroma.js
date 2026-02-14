const { spawn } = require("child_process");

// Get port from argument or default to 8000
const port = process.argv[2] || "8000";

console.log(`🚀 Starting ChromaDB on port ${port}`);

const command = `chroma run --port ${port}`;

const child = spawn(command, [], {
    stdio: "inherit",
    shell: true,
});

child.on("close", (code) => {
    process.exit(code);
});
