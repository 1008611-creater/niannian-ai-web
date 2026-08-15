ARG FACE_PROCESSOR_IMAGE_VERSION=face-white-2px-v1
FROM python:3.12.11-slim-bookworm
ARG FACE_PROCESSOR_IMAGE_VERSION
LABEL org.opencontainers.image.title="niannian-face-processor" \
      org.opencontainers.image.version="${FACE_PROCESSOR_IMAGE_VERSION}" \
      org.opencontainers.image.revision="face-white-2px-v1"
RUN useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin faceprocessor
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY processor.py service.py ./
COPY models ./models
# The process starts as root only long enough to read the root-owned Compose
# secret file. service.py permanently drops to this account before binding or
# serving HTTP.
USER root:root
EXPOSE 9093
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9093/readyz',timeout=2)"]
ENTRYPOINT ["python", "service.py"]
