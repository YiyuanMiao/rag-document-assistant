// Ingestion pipeline: load a document (.pdf/.txt), optionally detect chapter
// structure, and split into chunks. Runs ONCE per upload (not per query).
//
// General-purpose: if no chapter markers are found (a résumé, a report, ...),
// it degrades to plain recursive splitting with no chapter metadata.
import { readFileSync } from "fs";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { ingestChunks } from "./opensearch.js";

const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 1000);
const CHUNK_OVERLAP = Number(process.env.CHUNK_OVERLAP || 100);

// Chinese "第N章/回/卷/节", English "Chapter N", or markdown headings.
const CHAPTER_RE =
  /^\s*(第\s*[0-9零一二三四五六七八九十百千两]+\s*[章回卷节]|chapter\s+\d+|#{1,6}\s+\S)/i;

async function readText(filePath) {
  if (filePath.toLowerCase().endsWith(".pdf")) {
    const docs = await new PDFLoader(filePath).load();
    return docs.map((d) => d.pageContent).join("\n");
  }
  return readFileSync(filePath, "utf-8"); // .txt must be UTF-8
}

// Split raw text into chapter segments. Returns [] if no chapter markers found.
function splitByChapters(text) {
  const lines = text.split(/\r?\n/);
  const segments = [];
  let cur = { chapter: 0, title: "(前言)", lines: [] };
  let n = 0;
  for (const line of lines) {
    if (CHAPTER_RE.test(line)) {
      if (cur.lines.join("").trim()) segments.push(cur);
      n += 1;
      cur = { chapter: n, title: line.trim().slice(0, 100), lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  if (cur.lines.join("").trim()) segments.push(cur);
  // n === number of detected chapter headings; require >=2 to treat as chaptered.
  return n >= 2 ? segments : [];
}

export async function loadAndSplit(filePath, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const text = await readText(filePath);
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap: overlap });

  const segments = splitByChapters(text);
  if (segments.length === 0) {
    // No chapters -> plain split, no chapter metadata (general documents).
    return splitter.splitDocuments([{ pageContent: text, metadata: { source: filePath } }]);
  }

  // Chapter-aware: split each chapter, tag chunks with chapter number/title.
  const chunks = [];
  for (const seg of segments) {
    const parts = await splitter.splitText(seg.lines.join("\n"));
    for (const p of parts) {
      chunks.push({
        pageContent: p,
        metadata: { source: filePath, chapter: seg.chapter, chapterTitle: seg.title },
      });
    }
  }
  return chunks;
}

export async function ingestPdf(filePath, docId) {
  const chunks = await loadAndSplit(filePath);
  await ingestChunks(docId, chunks);
  return chunks.length;
}
