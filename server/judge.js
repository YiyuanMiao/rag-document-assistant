// LLM-as-a-judge: grade a generated answer for faithfulness (grounded in the
// retrieved context, no hallucination) and correctness (matches ground truth).
import { ChatOpenAI } from "@langchain/openai";

const judgeModel = new ChatOpenAI({
  model: process.env.JUDGE_MODEL || "gpt-5",
  ...(process.env.OPENAI_API_KEY && { apiKey: process.env.OPENAI_API_KEY }),
});

export async function judgeAnswer({ question, answer, context, groundTruth }) {
  const prompt = `You are grading a retrieval-augmented (RAG) system's answer. Be strict.

Question: ${question}
Retrieved context:
"""
${context}
"""
Model answer: ${answer}
Reference ground truth: ${groundTruth}

Grade two independent things, then reply with ONLY compact JSON (no prose):
{"faithful": <true|false>, "correct": <true|false>, "reason": "<= 15 words"}
- "faithful": every claim in the model answer is supported by the retrieved context (no fabrication). If the answer says it doesn't know, that is faithful.
- "correct": the model answer matches the reference ground truth.`;

  const resp = await judgeModel.invoke(prompt);
  const text = resp.content.toString();
  const match = text.match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(match[0]);
  } catch {
    return { faithful: false, correct: false, reason: "judge_parse_error" };
  }
}
