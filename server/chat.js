/*import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OpenAIEmbeddings } from "@langchain/openai"; //文本转化为vector
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory"; //本地存vector的DB，都是非关系型数据库
import { ChatOpenAI } from "@langchain/openai"; //openai接口
import { PromptTemplate } from "@langchain/core/prompts"; //prompt具体格式
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf"; //上传pdf

const chat = async (filePath = "./uploads/hbs-lean-startup.pdf") => {
  //default pdf
  const apiKey = process.env.OPENAI_API_KEY;

  // step 1: document loader
  const loader = new PDFLoader(filePath);
  const data = await loader.load();

  // step 2: text splitting
  const textSplitter = new RecursiveCharacterTextSplitter({
    //有可能切在中间，读不完句子，在下一块需要保留上一块的末尾500个词
    chunkSize: 500,
    chunkOverlap: 0,
  });

  const splitDocs = await textSplitter.splitDocuments(data);

  // step3: save to vec DB
  const embeddings = new OpenAIEmbeddings({ apiKey }); //收费的
  const vectorStore = await MemoryVectorStore.fromDocuments(
    //传入要store的doc，以及embeddings工具
    splitDocs,
    embeddings,
  );

  // step 4: retrieval - combined with step 5
  // step 5
  const model = new ChatOpenAI({
    model: "gpt-5",
    ...(apiKey && { apiKey }),
  });

  const template = `Use the following pieces of context to answer the question at the end.
If you don't know the answer, just say that you don't know, don't try to make up an answer.
Use three sentences maximum and keep the answer as concise as possible.

{context}
Question: {question}
Helpful Answer:`;

  const prompt = PromptTemplate.fromTemplate(template);

  // Use retriever to get relevant documents
  const retriever = vectorStore.asRetriever();
  const relevantDocs = await retriever.invoke(query);

  // Format context from retrieved documents
  const context = relevantDocs.map((doc) => doc.pageContent).join("\n\n");

  // Create a simple chain using the prompt template
  const formattedPrompt = await prompt.format({
    context,
    question: query,
  });

  // Get response from the model
  const response = await model.invoke(formattedPrompt);

  return { text: response.content };
};

export default chat;*/

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OpenAIEmbeddings } from "@langchain/openai";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
// 在文件顶部读取环境变量
const MOCK_LLM = process.env.MOCK_LLM === "true";

// NOTE: change this default filePath to any of your default file name
const chat = async (filePath = "./uploads/hbs-lean-startup.pdf", query) => {
  // Get API key from environment
  const apiKey = process.env.OPENAI_API_KEY;

  // step 1:
  const loader = new PDFLoader(filePath);

  const data = await loader.load();

  // step 2:
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000, //  (in terms of number of characters)
    chunkOverlap: 0,
  });

  const splitDocs = await textSplitter.splitDocuments(data);

  if (MOCK_LLM) {
    // 只测 PDF加载 + 分块 环节的性能
    return {
      text: `[MOCK] Retrieved chunks for: ${query}`,
    };
  }

  // step 3

  const embeddings = new OpenAIEmbeddings(apiKey ? { apiKey } : {});

  const vectorStore = await MemoryVectorStore.fromDocuments(
    splitDocs,
    embeddings,
  );

  // step 4: retrieval

  // const relevantDocs = await vectorStore.similaritySearch(
  // "What is task decomposition?"
  // );

  // step 5: qa w/ customize the prompt
  const model = new ChatOpenAI({
    model: "gpt-5",
    ...(apiKey && { apiKey }),
  });

  const template = `Use the following pieces of context to answer the question at the end.
If you don't know the answer, just say that you don't know, don't try to make up an answer.
Use three sentences maximum and keep the answer as concise as possible.

{context}
Question: {question}
Helpful Answer:`;

  const prompt = PromptTemplate.fromTemplate(template);

  // Use retriever to get relevant documents
  const retriever = vectorStore.asRetriever();
  const relevantDocs = await retriever.invoke(query);

  // Format context from retrieved documents
  const context = relevantDocs.map((doc) => doc.pageContent).join("\n\n");

  // Create a simple chain using the prompt template
  const formattedPrompt = await prompt.format({
    context,
    question: query,
  });

  // Get response from the model
  const response = await model.invoke(formattedPrompt);

  return { text: response.content };
};

export default chat;
