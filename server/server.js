import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { randomUUID } from "crypto";
import chat from "./chat.js";
import chatMCP from "./chat-mcp.js";
import { ensureIndex, docExists } from "./opensearch.js";
import { ingestPdf } from "./ingest.js";
import { summarizeDoc } from "./summarize.js";
import { answerCRAG } from "./router.js";

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

    // CRAG mode: retrieve -> grade sufficiency -> optional web -> one fused answer.
    if (process.env.ROUTER === "on") {
      const r = await answerCRAG(docId, question);
      const source =
        r.usedDoc && r.usedWeb ? "文档 + 网络搜索（混合结论）"
        : r.usedDoc ? "文档"
        : r.usedWeb ? "网络搜索"
        : "无相关资料";
      return res.send({ answer: r.answer, source, route: r.grade });
    }

    // Legacy mode: doc answer, falling back to web only if the doc has nothing.
    let answer = "Please upload a document first.";
    let source = "无相关资料";
    let hits = 0;
    if (docId && (await docExists(docId))) {
      const ragResp = await chat(docId, question);
      answer = ragResp.text;
      hits = ragResp.hits;
      source = "文档";
    }
    if (hits === 0 && process.env.SERPAPI_KEY) {
      const mcpResp = await chatMCP(question);
      answer = mcpResp.text;
      source = "网络搜索";
    }

    res.send({ answer, source });
  } catch (err) {
    console.error("chat failed:", err);
    res.status(500).send({ error: err.message });
  }
});

// Whole-document map-reduce summary (overall + per-section). Works for any doc;
// for chaptered docs it summarizes per chapter and includes the ending/outcome.
app.get("/summarize", async (req, res) => {
  const { docId } = req.query;
  try {
    if (!docId || !(await docExists(docId))) {
      return res.status(400).send({ error: "unknown or missing docId" });
    }
    const result = await summarizeDoc(docId);
    res.send(result);
  } catch (err) {
    console.error("summarize failed:", err);
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
