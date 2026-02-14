const { spawn } = require("child_process");

// Get the port from the command line argument, or default to 11434
const port = process.argv[2] || "11434";

console.log(`🚀 Starting Ollama on 127.0.0.1:${port}`);

// Run the command with the modified environment variable
const child = spawn("ollama serve", [], {
    stdio: "inherit", // Show Ollama's output in your terminal
    shell: true, // Ensure compatibility across OS
    env: {
        ...process.env, // Keep existing environment variables
        OLLAMA_HOST: `127.0.0.1:${port}`,
    },
});

child.on("close", (code) => {
    process.exit(code);
});
