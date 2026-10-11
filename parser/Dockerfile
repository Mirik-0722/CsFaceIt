# syntax=docker/dockerfile:1

# ---- Build stage: compile the worker in release mode ----
FROM rust:1-bookworm AS build

# protoc and the .proto files it ships with: the demo parser dependency generates code from Valve's protobuf
# definitions while it is built (see seed-protos.sh). git, which the same step needs, is part of the image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends protobuf-compiler libprotobuf-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Fetch and build the dependencies in their own layers, with a stand-in for the sources, so that a source-only change
# does not build them again.
COPY Cargo.toml Cargo.lock seed-protos.sh ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs
RUN ./seed-protos.sh
# csgoproto on its own first: the build script of the demo parser starts a second Cargo that rewrites sources of
# csgoproto, and it must not do that while csgoproto is being compiled. CARGO_TARGET_DIR must stay unset, or that
# second Cargo waits forever for the lock of the first.
RUN cargo build --release --locked -p csgoproto \
    && cargo build --release --locked

COPY src ./src
# The stand-in was compiled later than the real sources were written; touching them makes Cargo build them.
RUN touch src/main.rs && cargo build --release --locked

# ---- Runtime stage ----
FROM debian:bookworm-slim

# The binary links only against glibc. The CA certificates let it reach storage over HTTPS; the demo files do not need
# them when storage is the MinIO of the compose stack. The worker does not need root.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --no-create-home --shell /usr/sbin/nologin app

COPY --from=build /build/target/release/csfaceit-parser /usr/local/bin/csfaceit-parser

USER app
ENTRYPOINT ["/usr/local/bin/csfaceit-parser"]
