# 建置方式（專案根目錄）：docker compose build backend
# 或：docker build -f backend/Dockerfile .

FROM node:18-alpine

RUN apk add --no-cache python3 py3-pip build-base python3-dev libxml2-dev libxslt-dev

WORKDIR /app

COPY backend/requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt --break-system-packages

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci

COPY backend/ .
# 與本機 npm run dev 時「專案根 ../resources」對齊：Python 用於 Word 範本
COPY resources/template.docx resources/template.docx

RUN npm run build
RUN mkdir -p resources/ppt_library output

EXPOSE 3000

CMD ["node", "dist/index.js"]
