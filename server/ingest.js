// Ingestion pipeline: load a PDF, split into chunks, and index into OpenSearch.
// Runs ONCE per uploaded document (on /upload), not per query.
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { ingestChunks } from "./opensearch.js";

const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 1000);
const CHUNK_OVERLAP = Number(process.env.CHUNK_OVERLAP || 100);

// Load a PDF and split it into chunks (exposed so eval/tuning can reuse it).
export async function loadAndSplit(filePath, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const data = await new PDFLoader(filePath).load();
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: overlap,
  });
  return splitter.splitDocuments(data);
}

export async function ingestPdf(filePath, docId) {
  const chunks = await loadAndSplit(filePath);
  await ingestChunks(docId, chunks);
  return chunks.length;
}
