/**
 * eval-tuning.js — 参数调优脚本
 *
 * 自动测试多组 chunkSize / chunkOverlap 组合，
 * 找到 Hit Rate 最高的配置。
 *
 * 用法：
 *   node eval-tuning.js
 *   node eval-tuning.js ./uploads/other.pdf
 *
 * 注意：每组配置都会重新做一次 embedding，大约 3-6 组配置总费用 < $0.05
 */

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OpenAIEmbeddings } from "@langchain/openai";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { readFileSync, writeFileSync } from "fs";
import dotenv from "dotenv";

dotenv.config();

const TOP_K = 3;
const DEFAULT_PDF = "./uploads/Personal_Statement_Yiyuan_Miao_pdf.pdf";

// ============================================================
// 要测试的参数组合 —— 按需增减
// ============================================================
const CONFIGS = [
  { chunkSize: 300, chunkOverlap: 0 },
  { chunkSize: 300, chunkOverlap: 50 },
  { chunkSize: 500, chunkOverlap: 0 }, // 你当前的配置
  { chunkSize: 500, chunkOverlap: 50 },
  { chunkSize: 500, chunkOverlap: 100 },
  { chunkSize: 800, chunkOverlap: 100 },
  { chunkSize: 1000, chunkOverlap: 200 },
];

async function buildStore(filePath, chunkSize, chunkOverlap) {
  const loader = new PDFLoader(filePath);
  const data = await loader.load();

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
  });
  const splitDocs = await splitter.splitDocuments(data);

  const apiKey = process.env.OPENAI_API_KEY;
  const embeddings = new OpenAIEmbeddings(apiKey ? { apiKey } : {});
  const vectorStore = await MemoryVectorStore.fromDocuments(
    splitDocs,
    embeddings,
  );

  return { vectorStore, numChunks: splitDocs.length };
}

async function evalConfig(vectorStore, dataset) {
  let hits = 0;
  const details = [];

  for (const item of dataset) {
    const docs = await vectorStore.similaritySearch(item.question, TOP_K);
    const combined = docs.map((d) => d.pageContent).join(" ").toLowerCase();
    const matched = item.expectedKeywords.filter((kw) =>
      combined.includes(kw.toLowerCase()),
    );
    const isHit = matched.length > 0;
    if (isHit) hits++;
    details.push({ id: item.id, isHit });
  }

  return { hits, total: dataset.length, details };
}

async function main() {
  const filePath = process.argv[2] || DEFAULT_PDF;
  const dataset = JSON.parse(readFileSync("./golden-dataset.json", "utf-8"));

  console.log(`\n📋 Golden Dataset: ${dataset.length} questions`);
  console.log(`📄 PDF: ${filePath}`);
  console.log(`🔍 Top-K: ${TOP_K}`);
  console.log(`⚙️  Testing ${CONFIGS.length} configurations...\n`);
  console.log(
    "─".repeat(65),
  );
  console.log(
    "  chunkSize  overlap  chunks   hits   hitRate",
  );
  console.log(
    "─".repeat(65),
  );

  const results = [];

  for (const cfg of CONFIGS) {
    const { vectorStore, numChunks } = await buildStore(
      filePath,
      cfg.chunkSize,
      cfg.chunkOverlap,
    );
    const evalResult = await evalConfig(vectorStore, dataset);
    const hitRate = ((evalResult.hits / evalResult.total) * 100).toFixed(1);

    results.push({
      ...cfg,
      numChunks,
      hits: evalResult.hits,
      total: evalResult.total,
      hitRate: parseFloat(hitRate),
      failedIds: evalResult.details
        .filter((d) => !d.isHit)
        .map((d) => d.id),
    });

    console.log(
      `  ${String(cfg.chunkSize).padStart(9)}  ${String(cfg.chunkOverlap).padStart(7)}  ${String(numChunks).padStart(6)}   ${String(evalResult.hits).padStart(4)}   ${hitRate}%`,
    );
  }

  console.log("─".repeat(65));

  // 找最优
  const best = results.reduce((a, b) => (a.hitRate >= b.hitRate ? a : b));
  console.log(
    `\n🏆 Best config: chunkSize=${best.chunkSize}, overlap=${best.chunkOverlap} → ${best.hitRate}%`,
  );

  if (best.failedIds.length > 0) {
    console.log(`   Still missing: Q${best.failedIds.join(", Q")}`);
  }

  writeFileSync(
    "./eval-tuning-results.json",
    JSON.stringify(results, null, 2),
    "utf-8",
  );
  console.log("\n📁 Results saved to ./eval-tuning-results.json\n");
}

main().catch((err) => {
  console.error("💥 Error:", err.message);
  process.exit(1);
});
