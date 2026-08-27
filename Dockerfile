FROM node:20-alpine

# Instalar dependencias para compilacao nativa (xml-crypto, libxmljs, etc)
RUN apk add --no-cache python3 make g++ gcc

WORKDIR /app

# Copiar definicoes de pacote
COPY package.json ./

# Instalar dependencias puras (sem lockfile por enquanto, gerando-o na instalacao)
RUN npm install

# Copiar fonte e testes
COPY . .

# Comando default roda os testes
CMD ["npm", "run", "test"]
