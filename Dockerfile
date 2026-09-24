# Vinculación de terceros – Inversora Arcilaza S.A.S.
FROM node:22-slim

# Hora de Colombia para fechas de radicado, historial y consecutivo anual
ENV TZ=America/Bogota \
    NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/vinculacion.db \
    ARCHIVO_DIR="/app/archivo/SOPORTES CREACION TERCEROS" \
    CORREOS_DIR=/app/data/correos \
    FORMULARIO_WORD=/app/documentos/FOR-DCF-001.docx

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY src ./src
COPY public ./public
COPY documentos ./documentos
RUN mkdir -p data archivo && chown -R node:node /app/data /app/archivo

USER node
EXPOSE 3000
VOLUME ["/app/data", "/app/archivo"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/salud').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "--no-warnings=ExperimentalWarning", "server.js"]
