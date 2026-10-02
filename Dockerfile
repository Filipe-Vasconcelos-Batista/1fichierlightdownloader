FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir flask requests gunicorn
COPY app /app
ENV PYTHONUNBUFFERED=1
EXPOSE 8080
# 1 worker + threads: o estado dos downloads vive em memória
CMD ["gunicorn", "-b", "0.0.0.0:8080", "-w", "1", "--threads", "16", "--timeout", "0", "main:app"]
