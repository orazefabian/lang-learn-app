# Slovene speech recognition.
#
# The model is downloaded on first start into a mounted volume rather than
# baked in: `medium` is roughly 1.5 GB, and keeping it out of the image means
# switching model size is an environment variable, not a rebuild.
FROM python:3.12-slim-bookworm

# The expensive layer, and deliberately the first: everything that changes more
# often is below it, so editing a setting does not re-download 200 MB of wheels.
#
# `requests` is imported by faster_whisper.utils but missing from its declared
# dependencies, so a plain install produces a container that dies on its first
# import. Pinned here rather than left to chance.
#
# The retries are not defensive padding — this install genuinely times out on a
# slow connection, and a failed build after twenty minutes of downloading is a
# bad way to find that out.
RUN pip install --no-cache-dir --retries 10 --timeout 120 \
      "faster-whisper==1.2.0" "requests>=2.31"

# HOME and HF_HOME point at the mounted volume because huggingface_hub's
# downloader needs a writable home for its cache and its xet logs. This runs as
# a system user with no home directory, so without them the model download dies
# partway through with a bare "Permission denied (os error 13)" and the service
# never becomes ready. The volume is the one place guaranteed to be writable.
ENV WHISPER_MODEL=medium \
    WHISPER_MODEL_DIR=/models \
    WHISPER_DEVICE=cpu \
    WHISPER_COMPUTE_TYPE=int8 \
    WHISPER_LANGUAGE=sl \
    WHISPER_PORT=5001 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=4 \
    HOME=/models \
    HF_HOME=/models/.huggingface

COPY server.py /app/server.py
WORKDIR /app

# Import the server at build time. It costs a second and it turns a missing
# dependency into a failed build rather than a container that crash-loops in
# the cluster with the real error buried in kubectl logs. The model is not
# loaded here — that happens at runtime, against the mounted volume.
RUN python -c "import server; print('whisper server imports cleanly')"

RUN useradd --system --uid 1001 whisper \
 && mkdir -p /models/.huggingface \
 && chown -R whisper /app /models
USER whisper

EXPOSE 5001

# Unhealthy while the model downloads. The app treats speech recognition as
# optional, so speaking exercises fall back to self-assessment until this
# turns healthy rather than failing.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15m --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:5001/health', timeout=8).status==200 else 1)"

CMD ["python", "server.py"]
