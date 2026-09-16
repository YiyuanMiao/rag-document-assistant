// Corrective-RAG (CRAG) orchestrator: retrieve from the doc first, let an LLM
// grade whether the retrieved evidence is sufficient, optionally pull web
// results, then synthesize ONE grounded answer with source attribution.
import { hybridSearch } from "./opensearch.js";
import { getChatModel } from "./models.js";
import chatMCP from "./chat-mcp.js";

const TOP_K = Number(process.env.TOP_K || 5);

// Strip common Markdown so the chat UI shows clean plain text.
export function toPlainText(s = "") {
  return s
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")                     // # headings
    .replace(/\*\*(.*?)\*\*/g, "$1")                         // **bold**
    .replace(/__(.*?)__/g, "$1")                             // __bold__
    .replace(/(?<!\*)\*(?!\*)([^*\n]+)\*(?!\*)/g, "$1")      // *italic*
    .replace(/`([^`]+)`/g, "$1")                             // `code`
    .replace(/^\s{0,3}[-*+]\s+/gm, "")                       // - bullets
    .replace(/^\s{0,3}\d+\.\s+/gm, "")                       // 1. numbered
    .trim();
}

// Grade retrieved doc context against the question (cheap judge model).
async function gradeContext(question, context) {
  const model = getChatModel("judge");
  const prompt = `你是检索质量评审。判断下面“检索到的资料”能否充分回答“问题”。只回紧凑 JSON（无多余文字）：
{"sufficient": true|false, "need_web": true|false, "reason": "<=15字"}
- sufficient：资料是否足以完整、准确回答问题。
- need_web：是否需要联网补充（资料缺失/过时，或问题本身涉及文档之外的时事/外部信息）。

问题：${question}
检索到的资料：
"""
${context || "(空)"}
"""`;
  const r = await model.invoke(prompt);
  const m = r.content.toString().match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(m[0]);
  } catch {
    return { sufficient: !!context, need_web: !context, reason: "grade_parse_error" };
  }
}

export async function answerCRAG(docId, question) {
  // 1) Retrieve from the document (chapter-aware context).
  let hits = [];
  if (docId) hits = await hybridSearch(question, docId, TOP_K);
  const docContext = hits
    .map((h) => (h.chapterTitle ? `【${h.chapterTitle}】\n${h.text}` : h.text))
    .join("\n\n");

  // 2) Grade sufficiency (skip the LLM call if retrieval found nothing).
  const grade =
    hits.length === 0
      ? { sufficient: false, need_web: true, reason: "文档无相关内容" }
      : await gradeContext(question, docContext);

  // 3) Web search only when (a) the doc is insufficient AND (b) a SerpAPI key is
  //    configured. Without a key we degrade gracefully to a doc-only answer
  //    instead of hanging on an unauthenticated search.
  let webContext = "";
  const webEnabled = !!process.env.SERPAPI_KEY;
  if (webEnabled && (grade.need_web || !grade.sufficient)) {
    try {
      webContext = (await chatMCP(question)).text || "";
    } catch (e) {
      console.warn(`[router] web fallback failed: ${e.message}`);
    }
  }

  // 4) Synthesize one combined, source-attributed answer.
  const parts = [];
  if (docContext) parts.push(`【文档资料】\n${docContext}`);
  if (webContext) parts.push(`【联网资料】\n${webContext}`);
  const model = getChatModel();
  const prompt = `根据以下资料回答问题。用与问题相同的语言，简洁作答。
规则：只依据资料，不要编造；资料不足就如实说明。用到某来源时标注（据文档 / 据网络）。若资料带【第N章…】标注，相关处注明章节。
用纯文本作答，不要使用任何 Markdown 标记（不要出现 **、#、*、- 等符号）。

${parts.join("\n\n") || "(无可用资料)"}

问题：${question}
回答：`;
  const r = await model.invoke(prompt);

  return {
    answer: toPlainText(r.content.toString()),
    usedDoc: !!docContext,
    usedWeb: !!webContext,
    grade,
  };
}
