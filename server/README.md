# Golden Dataset 评估流程 — 完整指南

## 文件清单

```
├── golden-dataset.json      # 25 题测试集（问题 + 期望关键词 + 标准答案）
├── eval.js                  # 主评估脚本（跑一次，输出 Hit Rate）
├── eval-tuning.js           # 参数调优脚本（对比多组 chunkSize/overlap）
└── README.md                # 本文件
```

## 前置条件

**确保你的项目已安装以下依赖**（你现有的 package.json 应该已经有了）：

```bash
npm install @langchain/textsplitters @langchain/openai @langchain/classic @langchain/community dotenv
```

**确保 `.env` 文件有 OpenAI API Key：**

```
OPENAI_API_KEY=sk-xxxxx
```

**确保 PDF 文件在正确路径：**

```
./uploads/Personal_Statement_Yiyuan_Miao_pdf.pdf
```

## 快速开始

### Step 1：运行基础评估

```bash
node eval.js
```

输出示例：

```
📋 Golden Dataset: 25 questions loaded
📄 Loading PDF: ./uploads/Personal_Statement_Yiyuan_Miao_pdf.pdf
✂️  Splitting (chunkSize=500, overlap=50)...
   Generated 18 chunks
🔢 Building embeddings & vector store...
✅ Vector store ready

======================================================================
  Running Top-3 Retrieval Evaluation (25 questions)
======================================================================
✅ Q01 [basic_fact]
   Question:  What is Yiyuan Miao's GPA at Tsinghua University?
   Expected:  3.97/4.00
   Matched:   3.97, 4.00

❌ Q23 [comprehensive]
   Question:  What leadership roles did Yiyuan hold at Tsinghua?
   Expected:  Student Union, Monitor, Section Leader, Chief Director
   Missed:    chief director
   Chunk[0]:  I participated in the Tsinghua University School Song Contest...

======================================================================
  EVALUATION REPORT
======================================================================

  Overall Top-3 Hit Rate: 22/25 = 88.0%

  By Category:
    basic_fact           10/10 = 100.0%
    cross_paragraph       8/10 = 80.0%
    comprehensive         4/5  = 80.0%
```

### Step 2：参数调优（可选）

```bash
node eval-tuning.js
```

输出示例：

```
─────────────────────────────────────────────────────────────────
  chunkSize  overlap  chunks   hits   hitRate
─────────────────────────────────────────────────────────────────
        300        0      28     20   80.0%
        300       50      32     21   84.0%
        500        0      18     22   88.0%
        500       50      20     23   92.0%    ← 看起来更好
        500      100      22     23   92.0%
        800      100      14     22   88.0%
       1000      200      10     21   84.0%
─────────────────────────────────────────────────────────────────

🏆 Best config: chunkSize=500, overlap=50 → 92.0%
```

然后把最优参数更新到你的 `chat.js` 里。

### Step 3：用调优后的参数更新 chat.js

```javascript
// chat.js 中修改这两行
const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 500,       // ← 改成调优结果
  chunkOverlap: 50,     // ← 改成调优结果
});
```

## 原理解释

### 什么是 Top-3 Hit Rate？

对每个问题，向量库返回相似度最高的 3 个文本块（chunks）。
如果这 3 个 chunks 的文本里包含了正确答案的关键词，就算 "命中（Hit）"。

```
Hit Rate = 命中的问题数 / 总问题数 × 100%
```

这个指标衡量的是 **检索质量**，而不是 LLM 的回答质量。
因为 RAG 的核心瓶颈在于：如果检索不到正确的文本块，LLM 再强也答不对。

### 为什么不测 LLM 的回答？

1. **省钱**：eval.js 只调 embedding，不调 GPT（embedding 极便宜）
2. **定位问题**：如果 Hit Rate 低，说明分块策略或 embedding 有问题；如果 Hit Rate 高但最终回答差，说明是 prompt 的问题
3. **可复现**：检索结果是确定性的，不受 LLM 温度参数影响

### 关键词匹配 vs 语义匹配

当前用的是关键词匹配（简单、免费、够用）。
如果你需要更精确的评估，可以升级为让 GPT 判断（但会花钱）：

```javascript
// 替代方案：用 LLM 判断命中（每题多花 ~$0.001）
const judgePrompt = `Given these retrieved chunks:
${combinedText}

Does this contain the answer to: "${item.question}"?
Expected answer: ${item.groundTruth}

Reply only YES or NO.`;
```

## 费用预估

| 操作 | 费用 |
|------|------|
| eval.js 单次运行 | < $0.01（embedding only） |
| eval-tuning.js（7 组配置） | < $0.05 |
| 总计 | < $0.06 |

## 常见问题

**Q: Hit Rate 偏低怎么办？**
- 增大 `chunkOverlap`（防止关键信息被切断）
- 增大 `chunkSize`（让每个 chunk 包含更完整的上下文）
- 检查 PDF 解析是否正确（有些 PDF 格式会导致乱码）

**Q: 可以测试其他 PDF 吗？**
```bash
node eval.js ./uploads/another-doc.pdf
```
但需要同时修改 `golden-dataset.json` 里的问题和关键词。

**Q: 想增加更多测试问题？**
直接往 `golden-dataset.json` 里追加即可，格式参考现有条目。
