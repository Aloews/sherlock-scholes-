FROM rust:1.90-bookworm AS builder
WORKDIR /app
COPY Cargo.toml ./
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release

FROM debian:bookworm-slim
RUN useradd --system --uid 10001 --create-home app
COPY --from=builder /app/target/release/football-dynasty /usr/local/bin/football-dynasty
USER 10001:10001
EXPOSE 8080
ENV FD_BIND_ADDR=0.0.0.0:8080
ENTRYPOINT ["/usr/local/bin/football-dynasty"]
