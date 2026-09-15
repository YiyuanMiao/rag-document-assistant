// RAG query path (query-only). Retrieval is now hybrid search over OpenSearch;
// the document is indexed once at upload time (see ingest.js / server.js).
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { hybridSearch } from "./opensearch.js";

const MOCK_LLM = process.env.MOCK_LLM === "true";
const TOP_K = Number(process.env.TOP_K || 5);

const chat = async (docId, query) => {
  // Hybrid (BM25 + k-NN) retrieval scoped to this document.
  const relevantChunks = await hybridSearch(query, docId, TOP_K);
  const context = relevantChunks.join("\n\n");

  if (MOCK_LLM) {
    return { text: `[MOCK] retrieved ${relevantChunks.length} chunks for: ${query}`, hits: relevantChunks.length };
  }

  const model = new ChatOpenAI({
    model: process.env.CHAT_MODEL || "gpt-5",
    ...(process.env.OPENAI_API_KEY && { apiKey: process.env.OPENAI_API_KEY }),
  });

  const template = `Use the following pieces of context to answer the question at the end.
If you don't know the answer, just say that you don't know, don't try to make up an answer.
Use three sentences maximum and keep the answer as concise as possible.

{context}
Question: {question}
Helpful Answer:`;

  const prompt = PromptTemplate.fromTemplate(template);
  const formattedPrompt = await prompt.format({ context, question: query });
  const response = await model.invoke(formattedPrompt);

  return { text: response.content, hits: relevantChunks.length };
};

export default chat;
