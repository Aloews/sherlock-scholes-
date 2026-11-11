FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/worker
COPY worker.py test_worker.py /opt/worker/
RUN python3 -m py_compile /opt/worker/worker.py /opt/worker/test_worker.py \
    && cd /opt/worker && python3 -m unittest -v

ENV PYTHONUNBUFFERED=1
CMD ["python3", "/opt/worker/worker.py"]
