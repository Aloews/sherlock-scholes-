FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/worker
COPY worker.py test_worker.py /opt/worker/
RUN python -m py_compile /opt/worker/worker.py /opt/worker/test_worker.py \
    && cd /opt/worker && python -m unittest -v

ENV PYTHONUNBUFFERED=1
CMD ["python", "/opt/worker/worker.py"]
