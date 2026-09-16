// Model provider factory — swap between OpenAI and Amazon Bedrock via env, so
// the project stays reproducible after leaving AWS.
//
//   LLM_PROVIDER   = openai | bedrock   (chat + judge)
//   EMBED_PROVIDER = openai | bedrock   (defaults to LLM_PROVIDER)
//
// --- Bedrock credentials ---
// ChatBedrockConverse / BedrockEmbeddings use the standard AWS credential chain
// (env vars -> shared ~/.aws/credentials/config -> SSO). Two supported setups:
//   (A) Amazon employee (Isengard): a background job keeps temporary session
//       credentials fresh in ~/.aws/credentials (e.g. `ada credentials update
//       --account <id> --role <role> --provider isengard --once` on a loop).
//       Nothing to set here except BEDROCK_REGION — the chain picks them up.
//   (B) External / personal AWS customer: create an IAM user/role with
//       bedrock:InvokeModel, request model access in the Bedrock console, then
//       set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (+ AWS_SESSION_TOKEN if
//       temporary) or AWS_PROFILE in the environment. (This one costs money.)
import "dotenv/config";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ChatBedrockConverse, BedrockEmbeddings } from "@langchain/aws";
import { refreshingIniCredentials } from "./awsCreds.js";

const LLM_PROVIDER = (process.env.LLM_PROVIDER || "openai").toLowerCase();
const EMBED_PROVIDER = (process.env.EMBED_PROVIDER || LLM_PROVIDER).toLowerCase();
const REGION = process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-west-2";

// BEDROCK_CREDS=ini-refresh -> auto re-read ~/.aws/credentials (employee/Isengard,
// survives token rotation). Anything else -> AWS default chain (env/profile/SSO,
// for external customers). Only pass `credentials` in ini-refresh mode.
const bedrockCredentials =
  (process.env.BEDROCK_CREDS || "default") === "ini-refresh"
    ? { credentials: refreshingIniCredentials() }
    : {};

// kind: "chat" | "judge" (judge may use a separate/cheaper model if configured)
export function getChatModel(kind = "chat") {
  if (LLM_PROVIDER === "bedrock") {
    const model =
      (kind === "judge" && process.env.BEDROCK_JUDGE_MODEL) ||
      process.env.BEDROCK_CHAT_MODEL ||
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0"; // confirm this profile is enabled in your account
    return new ChatBedrockConverse({ model, region: REGION, ...bedrockCredentials });
  }
  const model =
    (kind === "judge" && process.env.JUDGE_MODEL) ||
    process.env.CHAT_MODEL ||
    "gpt-5";
  return new ChatOpenAI({ model, ...(process.env.OPENAI_API_KEY && { apiKey: process.env.OPENAI_API_KEY }) });
}

export function getEmbeddings() {
  if (EMBED_PROVIDER === "bedrock") {
    return new BedrockEmbeddings({
      model: process.env.BEDROCK_EMBED_MODEL || "amazon.titan-embed-text-v2:0", // 1024-dim
      region: REGION,
      ...bedrockCredentials,
    });
  }
  return new OpenAIEmbeddings({
    model: process.env.EMBED_MODEL || "text-embedding-3-small", // 1536-dim
    ...(process.env.OPENAI_API_KEY && { apiKey: process.env.OPENAI_API_KEY }),
  });
}

export const activeProviders = { llm: LLM_PROVIDER, embed: EMBED_PROVIDER, region: REGION };
