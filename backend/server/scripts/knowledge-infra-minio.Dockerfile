# MinIO's patched October release is distributed as source. Build the fixed
# upstream tag, rather than relying on an older precompiled registry release.
FROM golang:1.24.8-alpine AS builder
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
RUN go install -trimpath -ldflags="-s -w -X github.com/minio/minio/cmd.Version=2025-10-15T17:29:55Z -X github.com/minio/minio/cmd.ReleaseTag=RELEASE.2025-10-15T17-29-55Z" github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z

FROM alpine:3.21
RUN apk add --no-cache ca-certificates curl \
    && addgroup -g 10001 minio \
    && adduser -D -u 10001 -G minio minio \
    && mkdir /data \
    && chown minio:minio /data
COPY --from=builder /go/bin/minio /usr/local/bin/minio
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.version="RELEASE.2025-10-15T17-29-55Z"
USER 10001:10001
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
