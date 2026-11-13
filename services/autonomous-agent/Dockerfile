FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --component rustfmt --component clippy --default-toolchain stable \
    && /root/.cargo/bin/rustfmt --version \
    && /root/.cargo/bin/cargo --version \
    && /root/.cargo/bin/cargo fmt --version \
    && /root/.cargo/bin/cargo clippy --version

ENV PATH="/root/.cargo/bin:$PATH"

WORKDIR /opt/worker
COPY worker.py test_worker.py /opt/worker/
RUN python -m py_compile /opt/worker/worker.py /opt/worker/test_worker.py \
    && cd /opt/worker && python -m unittest -v

ENV PYTHONUNBUFFERED=1
CMD ["python", "/opt/worker/worker.py"]
