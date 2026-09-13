FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY src/ ./src/
COPY bin/ ./bin/

RUN npm run build

EXPOSE 3737

ENTRYPOINT ["node", "bin/docorbit.js"]
CMD ["mcp"]
