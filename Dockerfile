FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY apps/ ./apps/
COPY packages/ ./packages/
COPY bin/ ./bin/

RUN npm run build

EXPOSE 3737

ENTRYPOINT ["node", "bin/docorbit.js"]
CMD ["mcp"]
