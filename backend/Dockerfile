FROM node:24-alpine AS web
WORKDIR /ui
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine AS go-build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY --from=web /ui/dist/ ./cmd/sigmark/web/
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /sigmark ./cmd/sigmark

FROM alpine:3.22
COPY --from=go-build /sigmark /usr/local/bin/sigmark
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/sigmark"]
