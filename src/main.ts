import { createServer } from "./server";

const PORT = process.env.PORT ?? 3000;
const app = createServer();
app.listen(PORT, () => {
    console.log(`Memory RAG server running on http://localhost:${PORT}`);
});
