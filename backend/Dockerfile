FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV PORT=8080

WORKDIR /app

# Resume readers: tesseract reads scanned PDF pages and text inside DOCX images
# (OCR); antiword reads legacy Word 97-2003 (.doc) files. Set
# INSTALL_LIBREOFFICE=1 to also install LibreOffice Writer (about 300MB more),
# which converts .doc files with better fidelity (text boxes, tables) and reads
# the very short .doc files antiword refuses.
ARG INSTALL_LIBREOFFICE=0

# Install required system packages
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        gcc \
        curl \
        tesseract-ocr \
        tesseract-ocr-eng \
        antiword \
    && if [ "$INSTALL_LIBREOFFICE" = "1" ]; then \
        apt-get install -y --no-install-recommends libreoffice-writer-nogui; \
    fi \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install torch from the CPU-only index first. The default PyPI wheel bundles the
# CUDA runtime, which adds gigabytes of unusable NVIDIA dependencies and pushes
# memory past what a small CPU instance can boot with. requirements.txt then sees
# torch as already satisfied.
RUN python -m pip install --upgrade pip \
    && python -m pip install --index-url https://download.pytorch.org/whl/cpu torch \
    && python -m pip install -r requirements.txt

COPY . .

# Encode the job catalogue now so a cold start loads vectors instead of running
# the encoder over every job. The build machine can afford a larger batch than
# the service instance. Jobs added after the build are encoded on demand.
RUN KAREERLY_ENCODER_BATCH_SIZE=32 python -m app.precompute_job_vectors

EXPOSE 8080

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]