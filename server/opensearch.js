// OpenSearch layer: k-NN vector index + hybrid (BM25 + vector) retrieval.
// Replaces the per-request in-memory MemoryVectorStore.
import { Client } from "@opensearch-project/opensearch";
import { OpenAIEmbeddings } from "@langchain/openai";

const NODE = process.env.OPENSEARCH_URL || "https://localhost:9200";
const INDEX = process.env.OPENSEARCH_INDEX || "rag-documents";
const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-small";
const EMBED_DIM = Number(process.env.EMBED_DIM || 1536); // must match EMBED_MODEL
const PIPELINE = "rag-hybrid-pipeline";

export const client = new Client({
  node: NODE,
  ...(process.env.OPENSEARCH_USER && {
    auth: {
      username: process.env.OPENSEARCH_USER,
      password: process.env.OPENSEARCH_PASSWORD,
    },
  }),
  // Local dockerized clusters use a self-signed cert; set OPENSEARCH_SSL_VERIFY=true in prod.
  ssl: { rejectUnauthorized: process.env.OPENSEARCH_SSL_VERIFY === "true" },
});

const embeddings = new OpenAIEmbeddings({ model: EMBED_MODEL });

let hybridEnabled = false;

// (Change 2) Create the k-NN index if missing; (Change 3) register the hybrid
// search pipeline that min-max normalizes and blends the lexical + vector scores.
export async function ensureIndex() {
  const exists = await client.indices.exists({ index: INDEX });
  if (!exists.body) {
    await client.indices.create({
      index: INDEX,
      body: {
        settings: { index: { knn: true } },
        mappings: {
          properties: {
            text: { type: "text" },
            docId: { type: "keyword" },
            embedding: {
              type: "knn_vector",
              dimension: EMBED_DIM,
              method: {
                name: "hnsw",
                space_type: "cosinesimil",
                engine: "lucene", // lucene supports filtered k-NN
              },
            },
          },
        },
      },
    });
    console.log(`[opensearch] created index "${INDEX}"`);
  }

  // Hybrid needs OpenSearch >= 2.10 (neural-search normalization processor).
  // If unavailable, we fall back to pure k-NN so the app still works.
  try {
    await client.transport.request({
      method: "PUT",
      path: `/_search/pipeline/${PIPELINE}`,
      body: {
        description: "Normalize + combine BM25 and k-NN scores",
        phase_results_processors: [
          {
            "normalization-processor": {
              normalization: { technique: "min_max" },
              combination: {
                technique: "arithmetic_mean",
                parameters: { weights: [0.4, 0.6] }, // [lexical, vector]
              },
            },
          },
        ],
      },
    });
    hybridEnabled = true;
    console.log("[opensearch] hybrid search pipeline ready");
  } catch (e) {
    hybridEnabled = false;
    console.warn(
      `[opensearch] hybrid pipeline unavailable (${e.meta?.body?.error?.type || e.message}); falling back to pure k-NN`,
    );
  }
}

// (Change 1) Ingest: embed chunks and bulk-index them under a docId.
export async function ingestChunks(docId, chunks) {
  const texts = chunks.map((c) => c.pageContent);
  const vectors = await embeddings.embedDocuments(texts);

  const body = [];
  texts.forEach((text, i) => {
    body.push({ index: { _index: INDEX } });
    body.push({ text, docId, embedding: vectors[i] });
  });

  const resp = await client.bulk({ refresh: true, body });
  if (resp.body.errors) {
    const firstErr = resp.body.items.find((it) => it.index?.error)?.index.error;
    throw new Error(`bulk index failed: ${JSON.stringify(firstErr)}`);
  }
  return texts.length;
}

// (Change 3) Hybrid retrieval (BM25 + k-NN), scoped to one docId.
export async function hybridSearch(query, docId, k = 5) {
  const qVec = await embeddings.embedQuery(query);
  const docFilter = { term: { docId } };

  if (hybridEnabled) {
    try {
      const res = await client.search({
        index: INDEX,
        search_pipeline: PIPELINE,
        body: {
          size: k,
          query: {
            hybrid: {
              queries: [
                { bool: { must: [{ match: { text: query } }], filter: [docFilter] } },
                { knn: { embedding: { vector: qVec, k, filter: docFilter } } },
              ],
            },
          },
        },
      });
      return res.body.hits.hits.map((h) => h._source.text);
    } catch (e) {
      console.warn(`[opensearch] hybrid query failed, using pure k-NN: ${e.message}`);
    }
  }

  // Fallback: pure vector k-NN.
  const res = await client.search({
    index: INDEX,
    body: {
      size: k,
      query: { knn: { embedding: { vector: qVec, k, filter: docFilter } } },
    },
  });
  return res.body.hits.hits.map((h) => h._source.text);
}

export async function docExists(docId) {
  const res = await client.count({
    index: INDEX,
    body: { query: { term: { docId } } },
  });
  return res.body.count > 0;
}
