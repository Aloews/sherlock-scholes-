FROM rust:1.90-bookworm AS builder
WORKDIR /app
COPY Cargo.toml ./
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home app
COPY --from=builder /app/target/release/football-dynasty /usr/local/bin/football-dynasty
USER 10001:10001
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/football-dynasty"]
