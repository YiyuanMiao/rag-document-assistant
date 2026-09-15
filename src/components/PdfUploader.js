import React from "react";
import axios from "axios"; // Import axios for HTTP requests
import { InboxOutlined } from "@ant-design/icons";
import { message, Upload } from "antd";

const { Dragger } = Upload;

const DOMAIN = "http://localhost:5001";

const uploadToBackend = async (file) => {
  const formData = new FormData();
  formData.append("file", file);
  try {
    const responses = await axios.post(
      `${DOMAIN}/upload`,
      formData /*,{
      headers: {
        "Content-Type": "application/json",
      },
    }*/,
    );
    return responses;
  } catch (error) {
    console.error("error", error);
  }
  return null;
};

const PdfUploader = ({ onUploaded }) => {
  const attributes = {
    name: "file",
    multiple: false,
    customRequest: async ({ file, onSuccess, onError }) => {
      const response = await uploadToBackend(file);
      if (response && response.status === 200) {
        // Backend now returns { docId, filename, numChunks }; lift docId up so
        // the chat component can scope its questions to this document.
        onUploaded?.(response.data?.docId);
        onSuccess(response.data);
      } else {
        onError(new Error("upload failed"));
      }
    },
    onChange(info) {
      const { status } = info.file;
      if (status === "done") {
        message.success(`${info.file.name} file uploaded successfully.`);
      } else if (status === "error") {
        message.error(`${info.file.name} file upload failed.`);
      }
    },
    onDrop(e) {
      console.log("Dropped files", e.dataTransfer.files);
    },
  };

  return (
    <Dragger {...attributes}>
      <p className="ant-upload-drag-icon">
        <InboxOutlined />
      </p>
      <p className="ant-upload-text">
        Click or drag file to this area to upload
      </p>
      <p className="ant-upload-hint">Support for PDF files.</p>
    </Dragger>
  );
};

export default PdfUploader;
