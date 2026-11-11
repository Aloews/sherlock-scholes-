FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY worker.py /app/worker.py
RUN python3 -m py_compile /app/worker.py
ENV PYTHONUNBUFFERED=1
CMD ["python3", "/app/worker.py"]
