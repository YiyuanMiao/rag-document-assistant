/**
 * eval.js — Golden Dataset 评估脚本
 *
 * 功能：
 *   1. 加载 PDF → 分块 → Embedding → 建向量库（只做一次）
 *   2. 对 25 个问题逐一做 Top-3 检索
 *   3. 判断检索到的 chunks 里是否包含期望关键词（Hit / Miss）
 *   4. 输出每题详情 + 总体 Hit Rate + 分类统计
 *
 * 用法：
 *   node eval.js                          # 默认用 ./uploads/Personal_Statement_Yiyuan_Miao_pdf.pdf
 *   node eval.js ./uploads/other.pdf      # 指定 PDF 路径
 *
 * 环境变量：
 *   OPENAI_API_KEY — 必须设置（embedding 要用）
 *
 * 花费预估：
 *   一份 3 页 PDF + 25 次检索查询的 embedding 费用约 $0.01 以内（ada-002）
 *   不会调用 GPT，只测检索质量
 */

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OpenAIEmbeddings } from "@langchain/openai";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { readFileSync, writeFileSync } from "fs";
import dotenv from "dotenv";

dotenv.config();

// ============================================================
// 配置区 —— 你可以按需调整
// ============================================================
const TOP_K = 5; // 检索返回的 chunk 数量
const CHUNK_SIZE = 2000; // 分块大小（字符数）
const CHUNK_OVERLAP = 50; // 分块重叠（字符数），建议 > 0 以免切断关键信息
const DEFAULT_PDF = "./uploads/Personal_Statement_Yiyuan_Miao_pdf.pdf";

// ============================================================
// Step 1: 构建向量库（只做一次，所有问题共享）
// ============================================================
async function buildVectorStore(filePath) {
  console.log("\n📄 Loading PDF:", filePath);
  const loader = new PDFLoader(filePath);
  const data = await loader.load();
  console.log(`   Loaded ${data.length} page(s)`);

  console.log(
    `✂️  Splitting (chunkSize=${CHUNK_SIZE}, overlap=${CHUNK_OVERLAP})...`,
  );
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });
  const splitDocs = await splitter.splitDocuments(data);
  console.log(`   Generated ${splitDocs.length} chunks`);

  console.log("🔢 Building embeddings & vector store...");
  const apiKey = process.env.OPENAI_API_KEY;
  const embeddings = new OpenAIEmbeddings(apiKey ? { apiKey } : {});
  const vectorStore = await MemoryVectorStore.fromDocuments(
    splitDocs,
    embeddings,
  );
  console.log("✅ Vector store ready\n");

  return { vectorStore, splitDocs };
}

// ============================================================
// Step 2: 对单个问题执行 Top-K 检索并判断命中
// ============================================================
async function evaluateQuestion(vectorStore, item) {
  // 执行 similarity search，返回 top-k chunks
  const retrievedDocs = await vectorStore.similaritySearch(
    item.question,
    TOP_K,
  );

  // 把 top-k chunks 的文本拼在一起，用于关键词匹配
  const combinedText = retrievedDocs.map((d) => d.pageContent).join(" ");
  const lowerText = combinedText.toLowerCase();

  // 判断命中：至少一个 expectedKeyword 出现在检索结果里
  const matchedKeywords = item.expectedKeywords.filter((kw) =>
    lowerText.includes(kw.toLowerCase()),
  );

  const isHit = matchedKeywords.length > 0;

  return {
    id: item.id,
    category: item.category,
    question: item.question,
    groundTruth: item.groundTruth,
    isHit,
    matchedKeywords,
    missedKeywords: item.expectedKeywords.filter(
      (kw) => !lowerText.includes(kw.toLowerCase()),
    ),
    // 记录每个检索到的 chunk 的前 120 个字符，方便 debug
    retrievedSnippets: retrievedDocs.map((d) =>
      d.pageContent.substring(0, 120).replace(/\n/g, " "),
    ),
  };
}

// ============================================================
// Step 3: 运行全部评估 + 输出报告
// ============================================================
async function runEval() {
  const filePath = process.argv[2] || DEFAULT_PDF;

  // 加载 golden dataset
  const dataset = JSON.parse(readFileSync("./golden-dataset.json", "utf-8"));
  console.log(`📋 Golden Dataset: ${dataset.length} questions loaded`);

  // 构建向量库（一次性）
  const { vectorStore, splitDocs } = await buildVectorStore(filePath);

  // 逐题评估
  const results = [];
  let totalHits = 0;

  console.log("=".repeat(70));
  console.log(
    `  Running Top-${TOP_K} Retrieval Evaluation (${dataset.length} questions)`,
  );
  console.log("=".repeat(70));

  for (const item of dataset) {
    const result = await evaluateQuestion(vectorStore, item);
    results.push(result);

    if (result.isHit) totalHits++;

    // 实时打印每题结果
    const icon = result.isHit ? "✅" : "❌";
    console.log(
      `${icon} Q${String(result.id).padStart(2, "0")} [${result.category}]`,
    );
    console.log(`   Question:  ${result.question}`);
    console.log(`   Expected:  ${result.groundTruth}`);
    if (result.isHit) {
      console.log(`   Matched:   ${result.matchedKeywords.join(", ")}`);
    } else {
      console.log(`   Missed:    ${result.missedKeywords.join(", ")}`);
      console.log(`   Chunk[0]:  ${result.retrievedSnippets[0]}`);
    }
    console.log();
  }

  // ============================================================
  // 汇总报告
  // ============================================================
  console.log("=".repeat(70));
  console.log("  EVALUATION REPORT");
  console.log("=".repeat(70));

  // 总体
  const hitRate = ((totalHits / dataset.length) * 100).toFixed(1);
  console.log(
    `\n  Overall Top-${TOP_K} Hit Rate: ${totalHits}/${dataset.length} = ${hitRate}%\n`,
  );

  // 按 category 分组统计
  const categories = {};
  for (const r of results) {
    if (!categories[r.category]) {
      categories[r.category] = { total: 0, hits: 0 };
    }
    categories[r.category].total++;
    if (r.isHit) categories[r.category].hits++;
  }

  console.log("  By Category:");
  for (const [cat, stats] of Object.entries(categories)) {
    const catRate = ((stats.hits / stats.total) * 100).toFixed(1);
    console.log(
      `    ${cat.padEnd(20)} ${stats.hits}/${stats.total} = ${catRate}%`,
    );
  }

  // 列出所有失败的题目
  const failures = results.filter((r) => !r.isHit);
  if (failures.length > 0) {
    console.log(`\n  ❌ Failed Questions (${failures.length}):`);
    for (const f of failures) {
      console.log(`    Q${f.id}: ${f.question}`);
      console.log(`      Missing keywords: ${f.missedKeywords.join(", ")}`);
    }
  } else {
    console.log("\n  🎉 All questions hit! Perfect retrieval.");
  }

  // 配置信息
  console.log("\n  Config:");
  console.log(`    PDF:           ${filePath}`);
  console.log(`    Total Chunks:  ${splitDocs.length}`);
  console.log(`    Chunk Size:    ${CHUNK_SIZE}`);
  console.log(`    Chunk Overlap: ${CHUNK_OVERLAP}`);
  console.log(`    Top-K:         ${TOP_K}`);
  console.log("=".repeat(70));

  // 返回结构化结果，方便后续自动化
  return {
    hitRate: parseFloat(hitRate),
    totalHits,
    totalQuestions: dataset.length,
    categoryStats: categories,
    results,
  };
}

// ============================================================
// 执行
// ============================================================
runEval()
  .then((report) => {
    writeFileSync(
      "./eval-results.json",
      JSON.stringify(report, null, 2),
      "utf-8",
    );
    console.log("\n📁 Detailed results saved to ./eval-results.json");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n💥 Evaluation failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  });
