# Slovene speech recognition.
#
# The model is downloaded on first start into a mounted volume rather than
# baked in: `medium` is roughly 1.5 GB, and keeping it out of the image means
# switching model size is an environment variable, not a rebuild.
FROM python:3.12-slim-bookworm

ENV WHISPER_MODEL=medium \
    WHISPER_MODEL_DIR=/models \
    WHISPER_DEVICE=cpu \
    WHISPER_COMPUTE_TYPE=int8 \
    WHISPER_LANGUAGE=sl \
    WHISPER_PORT=5001 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=4

RUN pip install --no-cache-dir "faster-whisper==1.2.0"

COPY server.py /app/server.py
WORKDIR /app

RUN useradd --system --uid 1001 whisper \
 && mkdir -p /models \
 && chown -R whisper /app /models
USER whisper

EXPOSE 5001

# Unhealthy while the model downloads. The app treats speech recognition as
# optional, so speaking exercises fall back to self-assessment until this
# turns healthy rather than failing.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15m --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:5001/health', timeout=8).status==200 else 1)"

CMD ["python", "server.py"]
