/*//后端测试api
import express from "express"; //后端api
import cors from "cors"; //允许跨域访问
import dotenv from "dotenv"; //env文件
import multer from "multer"; // Import multer，存储在本地的package
import chat from "./chat.js";

dotenv.config();

const app = express();
app.use(cors()); //middleware

// Configure multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/"); //存储路径
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname); //如果不想用originalname，可以自动生成file名称，按照用户名称或者日期
  },
});

const upload = multer({ storage: storage });

const PORT = 5001;

let filePath;

app.post("/upload", upload.single("file"), (req, res) => {
  // Use multer to handle file upload
  filePath = req.file.path; // The path where the file is temporarily saved
  res.send(filePath + " upload successfully.");
});

app.get("/chat", async (req, res) => {
  const resp = await chat(filePath, req.query.question); // Use MCP-enhanced chat
  res.send({
    ragAnswer: resp.text,
    mcpAnswer: "N/A",
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
*/

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer"; // Import multer
import chat from "./chat.js";
import chatMCP from "./chat-mcp.js";

dotenv.config();

const app = express();
app.use(cors());

// Configure multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage: storage });

const PORT = 5001;

let filePath;

app.post("/upload", upload.single("file"), (req, res) => {
  // Use multer to handle file upload
  filePath = req.file.path; // The path where the file is temporarily saved
  res.send(filePath + " upload successfully.");
});

app.get("/chat", async (req, res) => {
  const ragResp = await chat(filePath, req.query.question);
  const mcpResp = await chatMCP(req.query.question);

  res.send({
    ragAnswer: ragResp.text,
    mcpAnswer: mcpResp.text,
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
