# Slovene TTS. Piper ships exactly one sl_SI voice (artur, medium quality,
# CC BY 4.0); it is baked into the image so a deployment needs no network.
FROM python:3.12-slim-bookworm

ARG PIPER_VOICE=sl_SI-artur-medium

ENV PIPER_VOICE=${PIPER_VOICE} \
    PIPER_DATA_DIR=/voices \
    PIPER_PORT=5000 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "piper-tts==1.8.0"

# Piper phonemises through a bundled espeak-ng whose data path is baked in at
# compile time. Pointing at the copy that actually shipped in the wheel keeps
# the image working regardless of how it was built.
ENV ESPEAK_DATA_PATH=/usr/local/lib/python3.12/site-packages/piper/espeak-ng-data

# Download at build time so startup is offline and deterministic.
RUN mkdir -p /voices \
 && python -m piper.download_voices "${PIPER_VOICE}" --data-dir /voices \
 && ls -la /voices

COPY server.py /app/server.py
WORKDIR /app

# Fail the build, not the first listening card, if this image cannot speak.
RUN python -c "import server; server.load_voice(); server.self_test()"

RUN useradd --system --uid 1001 piper && chown -R piper /app /voices
USER piper

EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:5000/health', timeout=4).status==200 else 1)"

CMD ["python", "server.py"]
