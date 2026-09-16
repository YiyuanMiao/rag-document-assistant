// Hierarchical (map-reduce) summarization over a whole document.
// General-purpose: works on any ingested doc. If the doc has chapters, it
// summarizes per chapter; otherwise it groups chunks into fixed windows.
// Handles whole-book questions (overall plot / ending) that top-k RAG can't.
import { fetchAllChunks } from "./opensearch.js";
import { getChatModel } from "./models.js";

const WINDOW = Number(process.env.SUMMARY_WINDOW || 15); // chunks per group when unchaptered
const REDUCE_FANIN = Number(process.env.SUMMARY_FANIN || 12); // summaries combined per reduce step

// Group chunks by chapter (if chaptered) or into fixed windows.
function groupChunks(chunks) {
  const chaptered = chunks.some((c) => c.chapter != null);
  if (chaptered) {
    const byCh = new Map();
    for (const c of chunks) {
      const key = c.chapter ?? 0;
      if (!byCh.has(key)) byCh.set(key, { label: c.chapterTitle || `第${key}章`, texts: [] });
      byCh.get(key).texts.push(c.text);
    }
    return [...byCh.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
  }
  const groups = [];
  for (let i = 0; i < chunks.length; i += WINDOW) {
    groups.push({ label: `第 ${i + 1}–${Math.min(i + WINDOW, chunks.length)} 段`, texts: chunks.slice(i, i + WINDOW).map((c) => c.text) });
  }
  return groups;
}

async function invokeText(model, prompt) {
  const r = await model.invoke(prompt);
  return r.content.toString().trim();
}

// Recursively reduce many section summaries into a single overall summary.
async function reduce(model, labeled) {
  if (labeled.length <= REDUCE_FANIN) {
    const joined = labeled.map((s) => `${s.label}: ${s.summary}`).join("\n");
    return invokeText(
      model,
      `以下是一篇文档各部分的摘要。请基于且仅基于这些摘要，用中文写一段完整、连贯的全文概括，涵盖主线与走向（若是故事，请包含结局/最终走向）：\n\n${joined}`,
    );
  }
  // Too many: reduce in batches, then recurse.
  const next = [];
  for (let i = 0; i < labeled.length; i += REDUCE_FANIN) {
    const batch = labeled.slice(i, i + REDUCE_FANIN);
    const joined = batch.map((s) => `${s.label}: ${s.summary}`).join("\n");
    const summary = await invokeText(model, `用中文把以下相邻部分的摘要合并成一段更概括的摘要：\n\n${joined}`);
    next.push({ label: `${batch[0].label} … ${batch[batch.length - 1].label}`, summary });
  }
  return reduce(model, next);
}

export async function summarizeDoc(docId) {
  const chunks = await fetchAllChunks(docId);
  if (chunks.length === 0) throw new Error(`no chunks for docId ${docId}`);

  const groups = groupChunks(chunks);
  const model = getChatModel();

  // MAP: summarize each group.
  const sections = [];
  for (const g of groups) {
    const summary = await invokeText(
      model,
      `请用中文简要概括以下内容的要点（2–4 句，只依据文本，不要臆造）：\n\n【${g.label}】\n${g.texts.join("\n")}`,
    );
    sections.push({ label: g.label, summary });
  }

  // REDUCE: combine into one overall summary.
  const overall = await reduce(model, sections);
  return {
    docId,
    chaptered: chunks.some((c) => c.chapter != null),
    numChunks: chunks.length,
    numSections: sections.length,
    sections,
    overall,
  };
}
