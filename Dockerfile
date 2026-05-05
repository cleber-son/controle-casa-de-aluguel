FROM node:20-bookworm-slim

# better-sqlite3 precisa compilar nativamente — instala build deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Cria diretório de dados (SQLite + sessões) — montado como volume
RUN mkdir -p /app/data

EXPOSE 3002

CMD ["node", "index.js"]
