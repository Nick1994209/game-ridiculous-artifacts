FROM node:24-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.26-alpine AS backend
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /server ./cmd/game-server

FROM scratch
WORKDIR /app
COPY --from=backend /server /app/server
COPY --from=frontend /src/frontend/dist /app/public
ENV PORT=8080 STATIC_DIR=/app/public
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/app/server"]
