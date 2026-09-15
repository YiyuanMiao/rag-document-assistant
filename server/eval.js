/**
 * eval.js — Golden Dataset evaluation against the OpenSearch hybrid pipeline.
 *
 * For each golden question it measures:
 *   1. Retrieval hit    — do the top-k hybrid-retrieved chunks contain an expected keyword?
 *   2. Answer faithfulness — is the generated answer grounded in the retrieved context? (LLM judge)
 *   3. Answer correctness  — does the answer match the ground truth? (LLM judge)
 *
 * Usage:
 *   node eval.js [./uploads/your.pdf]
 *   RETRIEVAL_ONLY=true node eval.js ...   # skip generation+judge (cheap, retrieval only)
 *
 * Env: OPENAI_API_KEY + OPENSEARCH_* (see .env.example)
 */
import { readFileSync, writeFileSync } from "fs";
import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { ensureIndex, hybridSearch, ingestChunks, client } from "./opensearch.js";
import { loadAndSplit } from "./ingest.js";
import { judgeAnswer } from "./judge.js";

dotenv.config();

const TOP_K = Number(process.env.TOP_K || 5);
const DOC_ID = "eval";
const RETRIEVAL_ONLY = process.env.RETRIEVAL_ONLY === "true";
const DEFAULT_PDF = "./uploads/Personal_Statement_Yiyuan_Miao_pdf.pdf";
const INDEX = process.env.OPENSEARCH_INDEX || "rag-documents";

const answerTemplate = `Use the following pieces of context to answer the question at the end.
If you don't know the answer, just say that you don't know, don't try to make up an answer.
Use three sentences maximum and keep the answer as concise as possible.

{context}
Question: {question}
Helpful Answer:`;

async function generate(model, prompt, context, question) {
  const formatted = await prompt.format({ context, question });
  const resp = await model.invoke(formatted);
  return resp.content.toString();
}

async function run() {
  const filePath = process.argv[2] || DEFAULT_PDF;
  const dataset = JSON.parse(readFileSync("./golden-dataset.json", "utf-8"));
  console.log(`📋 Golden dataset: ${dataset.length} questions`);

  await ensureIndex();

  // Re-ingest the eval document fresh under docId="eval".
  await client.deleteByQuery(
    { index: INDEX, refresh: true, body: { query: { term: { docId: DOC_ID } } } },
    { ignore: [404] },
  );
  console.log(`📄 Ingesting ${filePath} ...`);
  const chunks = await loadAndSplit(filePath);
  await ingestChunks(DOC_ID, chunks);
  console.log(`   ${chunks.length} chunks indexed\n`);

  const model = RETRIEVAL_ONLY
    ? null
    : new ChatOpenAI({ model: process.env.CHAT_MODEL || "gpt-5", ...(process.env.OPENAI_API_KEY && { apiKey: process.env.OPENAI_API_KEY }) });
  const prompt = PromptTemplate.fromTemplate(answerTemplate);

  const results = [];
  let hits = 0, faithful = 0, correct = 0, judged = 0;

  for (const item of dataset) {
    const retrieved = await hybridSearch(item.question, DOC_ID, TOP_K);
    const combined = retrieved.join(" ").toLowerCase();
    const matched = item.expectedKeywords.filter((kw) => combined.includes(kw.toLowerCase()));
    const isHit = matched.length > 0;
    if (isHit) hits++;

    let answer = null, verdict = null;
    if (!RETRIEVAL_ONLY) {
      answer = await generate(model, prompt, retrieved.join("\n\n"), item.question);
      verdict = await judgeAnswer({
        question: item.question,
        answer,
        context: retrieved.join("\n\n"),
        groundTruth: item.groundTruth,
      });
      judged++;
      if (verdict.faithful) faithful++;
      if (verdict.correct) correct++;
    }

    results.push({ id: item.id, category: item.category, question: item.question, isHit, matched, answer, verdict });
    const icon = isHit ? "✅" : "❌";
    const jflag = verdict ? ` | faithful=${verdict.faithful} correct=${verdict.correct}` : "";
    console.log(`${icon} Q${String(item.id).padStart(2, "0")} [${item.category}]${jflag}`);
  }

  const pct = (n) => ((n / dataset.length) * 100).toFixed(1);
  console.log("\n" + "=".repeat(60));
  console.log(`  Retrieval Top-${TOP_K} Hit Rate:  ${hits}/${dataset.length} = ${pct(hits)}%`);
  if (!RETRIEVAL_ONLY) {
    console.log(`  Answer Faithfulness:       ${faithful}/${judged} = ${((faithful / judged) * 100).toFixed(1)}%`);
    console.log(`  Answer Correctness:        ${correct}/${judged} = ${((correct / judged) * 100).toFixed(1)}%`);
  }
  console.log("=".repeat(60));

  const report = {
    hitRate: parseFloat(pct(hits)),
    faithfulnessRate: RETRIEVAL_ONLY ? null : parseFloat(((faithful / judged) * 100).toFixed(1)),
    correctnessRate: RETRIEVAL_ONLY ? null : parseFloat(((correct / judged) * 100).toFixed(1)),
    totalQuestions: dataset.length,
    config: { topK: TOP_K, chunks: chunks.length, retrievalOnly: RETRIEVAL_ONLY },
    results,
  };
  writeFileSync("./eval-results.json", JSON.stringify(report, null, 2));
  console.log("📁 Saved ./eval-results.json");
}

run().then(() => process.exit(0)).catch((e) => {
  console.error("💥 eval failed:", e.message);
  process.exit(1);
});
