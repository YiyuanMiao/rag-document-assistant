// RAG query path (query-only). Retrieval is now hybrid search over OpenSearch;
// the document is indexed once at upload time (see ingest.js / server.js).
import { PromptTemplate } from "@langchain/core/prompts";
import { hybridSearch } from "./opensearch.js";
import { getChatModel } from "./models.js";
import { toPlainText } from "./router.js";

const MOCK_LLM = process.env.MOCK_LLM === "true";
const TOP_K = Number(process.env.TOP_K || 5);

const chat = async (docId, query) => {
  // Hybrid (BM25 + k-NN) retrieval scoped to this document.
  const hits = await hybridSearch(query, docId, TOP_K);
  // Prefix each snippet with its chapter (when the doc is chaptered) for citations.
  const context = hits
    .map((h) => (h.chapterTitle ? `【${h.chapterTitle}】\n${h.text}` : h.text))
    .join("\n\n");

  if (MOCK_LLM) {
    return { text: `[MOCK] retrieved ${hits.length} chunks for: ${query}`, hits: hits.length };
  }

  const model = getChatModel();

  const template = `Use the following pieces of context to answer the question at the end.
If you don't know the answer, just say that you don't know, don't try to make up an answer.
When a context piece is prefixed with a chapter like 【第N章 ...】, cite the chapter in your answer if relevant.
Answer in the same language as the question. Keep it concise.
Reply in plain text only — do NOT use any Markdown (no **, #, *, - bullets).

{context}
Question: {question}
Helpful Answer:`;

  const prompt = PromptTemplate.fromTemplate(template);
  const formattedPrompt = await prompt.format({ context, question: query });
  const response = await model.invoke(formattedPrompt);

  return { text: toPlainText(response.content.toString()), hits: hits.length };
};

export default chat;
