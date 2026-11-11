FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY worker.py test_worker.py /app/
RUN python3 -m py_compile /app/worker.py /app/test_worker.py \
    && cd /app && python3 -m unittest -v
ENV PYTHONUNBUFFERED=1
CMD ["python3", "/app/worker.py"]
