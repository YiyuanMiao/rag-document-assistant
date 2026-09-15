/**
 * eval-tuning.js — sweep chunkSize/overlap over the OpenSearch hybrid pipeline
 * and report retrieval hit rate per config. Each config is indexed under its own
 * docId, evaluated, then cleaned up. Retrieval-only (no GPT) → cheap.
 *
 * Usage: node eval-tuning.js [./uploads/your.pdf]
 */
import { readFileSync, writeFileSync } from "fs";
import dotenv from "dotenv";
import { ensureIndex, hybridSearch, ingestChunks, client } from "./opensearch.js";
import { loadAndSplit } from "./ingest.js";

dotenv.config();

const TOP_K = Number(process.env.TOP_K || 5);
const INDEX = process.env.OPENSEARCH_INDEX || "rag-documents";
const DEFAULT_PDF = "./uploads/Personal_Statement_Yiyuan_Miao_pdf.pdf";

const CONFIGS = [
  { chunkSize: 300, chunkOverlap: 0 },
  { chunkSize: 500, chunkOverlap: 50 },
  { chunkSize: 800, chunkOverlap: 100 },
  { chunkSize: 1000, chunkOverlap: 100 },
  { chunkSize: 1000, chunkOverlap: 200 },
];

async function evalConfig(dataset, docId) {
  let hits = 0;
  const failedIds = [];
  for (const item of dataset) {
    const retrieved = await hybridSearch(item.question, docId, TOP_K);
    const combined = retrieved.join(" ").toLowerCase();
    const isHit = item.expectedKeywords.some((kw) => combined.includes(kw.toLowerCase()));
    if (isHit) hits++;
    else failedIds.push(item.id);
  }
  return { hits, failedIds };
}

async function main() {
  const filePath = process.argv[2] || DEFAULT_PDF;
  const dataset = JSON.parse(readFileSync("./golden-dataset.json", "utf-8"));
  await ensureIndex();

  console.log(`📄 ${filePath}  |  ${dataset.length} questions  |  Top-K=${TOP_K}\n`);
  console.log("─".repeat(55));
  console.log("  chunkSize  overlap  chunks   hits   hitRate");
  console.log("─".repeat(55));

  const results = [];
  for (const cfg of CONFIGS) {
    const docId = `tune-${cfg.chunkSize}-${cfg.chunkOverlap}`;
    await client.deleteByQuery(
      { index: INDEX, refresh: true, body: { query: { term: { docId } } } },
      { ignore: [404] },
    );
    const chunks = await loadAndSplit(filePath, cfg.chunkSize, cfg.chunkOverlap);
    await ingestChunks(docId, chunks);

    const { hits, failedIds } = await evalConfig(dataset, docId);
    const hitRate = parseFloat(((hits / dataset.length) * 100).toFixed(1));
    results.push({ ...cfg, numChunks: chunks.length, hits, hitRate, failedIds });
    console.log(`  ${String(cfg.chunkSize).padStart(9)}  ${String(cfg.chunkOverlap).padStart(7)}  ${String(chunks.length).padStart(6)}   ${String(hits).padStart(4)}   ${hitRate}%`);

    // clean up this config's docs
    await client.deleteByQuery(
      { index: INDEX, refresh: true, body: { query: { term: { docId } } } },
      { ignore: [404] },
    );
  }
  console.log("─".repeat(55));

  const best = results.reduce((a, b) => (a.hitRate >= b.hitRate ? a : b));
  console.log(`\n🏆 Best: chunkSize=${best.chunkSize}, overlap=${best.chunkOverlap} → ${best.hitRate}%`);
  writeFileSync("./eval-tuning-results.json", JSON.stringify(results, null, 2));
  console.log("📁 Saved ./eval-tuning-results.json");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("💥", e.message);
  process.exit(1);
});
