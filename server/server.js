import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { randomUUID } from "crypto";
import chat from "./chat.js";
import chatMCP from "./chat-mcp.js";
import { ensureIndex, docExists } from "./opensearch.js";
import { ingestPdf } from "./ingest.js";

dotenv.config();

const app = express();
app.use(cors());

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  // Prefix with a timestamp so concurrent uploads of the same filename don't clash.
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

const PORT = process.env.PORT || 5001;

// Upload = ingest ONCE into OpenSearch; returns a docId the client sends back on /chat.
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const docId = randomUUID();
    const numChunks = await ingestPdf(req.file.path, docId);
    res.send({ docId, filename: req.file.originalname, numChunks });
  } catch (err) {
    console.error("upload/ingest failed:", err);
    res.status(500).send({ error: err.message });
  }
});

// Chat = query-only. RAG over the doc's indexed chunks; web search as fallback.
app.get("/chat", async (req, res) => {
  const { question, docId } = req.query;
  try {
    if (!question) return res.status(400).send({ error: "question is required" });

    let ragAnswer = "Please upload a document first.";
    let hits = 0;
    if (docId && (await docExists(docId))) {
      const ragResp = await chat(docId, question);
      ragAnswer = ragResp.text;
      hits = ragResp.hits;
    }

    // Web fallback only when the document yields no relevant chunks.
    let mcpAnswer = "N/A";
    if (hits === 0) {
      const mcpResp = await chatMCP(question);
      mcpAnswer = mcpResp.text;
    }

    res.send({ ragAnswer, mcpAnswer });
  } catch (err) {
    console.error("chat failed:", err);
    res.status(500).send({ error: err.message });
  }
});

// Ensure index + hybrid pipeline exist before accepting traffic.
ensureIndex()
  .then(() => {
    app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to initialize OpenSearch index:", err);
    process.exit(1);
  });
