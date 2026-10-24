FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 10001 worker
COPY --chown=worker:worker media_worker ./media_worker
USER worker
ENV MEDIA_WORKER_HOST=0.0.0.0 MEDIA_WORKER_PORT=8910 PYTHONUNBUFFERED=1
EXPOSE 8910
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ['MEDIA_WORKER_PORT']+'/health',timeout=2)"
CMD ["python", "-m", "media_worker"]
