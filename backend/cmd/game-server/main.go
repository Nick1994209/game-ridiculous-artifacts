package main

import (
	"artifacts/internal/game"
	"artifacts/internal/inbound"
	"artifacts/internal/platform"
	"artifacts/maps"
	"context"
	"log/slog"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	cfg, e := platform.Load()
	if e != nil {
		slog.Error("config", "error", e)
		os.Exit(1)
	}
	addr, e := platform.ListenAddress()
	if e != nil {
		slog.Error("config", "error", e)
		os.Exit(1)
	}
	m, e := maps.Load()
	if e != nil {
		slog.Error("maps", "error", e)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	origins := os.Getenv("ALLOWED_ORIGINS")
	if origins == "" {
		origins = "localhost:5173,127.0.0.1:5173"
	}
	room := game.New(cfg, m, rand.New(rand.NewSource(time.Now().UnixNano())))
	app := inbound.New(ctx, room, strings.Split(origins, ","))
	done := make(chan struct{})
	go func() { defer close(done); app.Run() }()
	staticDir := os.Getenv("STATIC_DIR")
	if staticDir == "" {
		staticDir = "../frontend/dist"
	}
	srv := &http.Server{Addr: addr, Handler: app.Handler(os.DirFS(staticDir)), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		slog.Info("listening", "addr", addr)
		if e := srv.ListenAndServe(); e != nil && e != http.ErrServerClosed {
			slog.Error("http", "error", e)
			stop()
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdown)
	<-done
}
