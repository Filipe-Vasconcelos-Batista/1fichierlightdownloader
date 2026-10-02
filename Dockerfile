# Etapa 1: compila o frontend React
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm install
COPY frontend .
RUN npm run build

# Etapa 2: backend Python que serve a API e o frontend compilado
FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir flask requests gunicorn pyyaml
COPY app /app
COPY --from=web /web/dist /app/static
ENV PYTHONUNBUFFERED=1
EXPOSE 8080
# 1 worker + threads: o estado dos downloads vive em memória
CMD ["gunicorn", "-b", "0.0.0.0:8080", "-w", "1", "--threads", "16", "--timeout", "0", "main:app"]
