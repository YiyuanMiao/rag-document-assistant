FROM node:20-slim

WORKDIR /app

# Install deps first for layer caching. (The langchain packages have a known
# zod peer-range conflict, so install with legacy peer resolution.)
COPY package*.json ./
RUN npm install --legacy-peer-deps --omit=dev

COPY . .

# uploads/ is where multer writes incoming PDFs before ingestion.
RUN mkdir -p uploads

EXPOSE 5001
CMD ["node", "server.js"]
