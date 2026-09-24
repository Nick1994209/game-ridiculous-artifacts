package inbound

import (
	"artifacts/internal/game"
	"artifacts/internal/platform"
	"artifacts/maps"
	"context"
	"encoding/json"
	"github.com/coder/websocket"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func TestHandshake(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ms, e := maps.Load()
	if e != nil {
		t.Fatal(e)
	}
	s := New(ctx, game.New(platform.Default(), ms, rand.New(rand.NewSource(1))), nil)
	ts := httptest.NewServer(s.Handler(nil))
	defer ts.Close()
	c, _, e := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", nil)
	if e != nil {
		t.Fatal(e)
	}
	defer c.CloseNow()
	b, _ := json.Marshal(ClientMessage{ProtocolVersion: 1, Type: "hello", Name: "test"})
	if e = c.Write(ctx, websocket.MessageText, b); e != nil {
		t.Fatal(e)
	}
	readCtx, stop := context.WithTimeout(ctx, time.Second)
	defer stop()
	for _, want := range []string{"welcome", "map", "snapshot"} {
		_, b, e = c.Read(readCtx)
		if e != nil {
			t.Fatal(e)
		}
		var msg Envelope
		if e = json.Unmarshal(b, &msg); e != nil || msg.Type != want {
			t.Fatal(string(b), e)
		}
	}
}

func TestFrontendStaticFiles(t *testing.T) {
	s := New(context.Background(), nil, nil)
	handler := s.Handler(fstest.MapFS{
		"index.html":    &fstest.MapFile{Data: []byte("<html>Game frontend</html>")},
		"assets/app.js": &fstest.MapFile{Data: []byte("console.log('game')")},
	})
	for _, tc := range []struct {
		path              string
		status            int
		body, contentType string
	}{
		{"/", 200, "Game frontend", "text/html"},
		{"/assets/app.js", 200, "console.log", "javascript"},
		{"/missing.js", 404, "404", ""},
		{"/healthz", 200, "ok", ""},
		{"/readyz", 503, "not ready", ""},
	} {
		t.Run(tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.body) || !strings.Contains(w.Header().Get("Content-Type"), tc.contentType) {
				t.Fatalf("%d %s %s", w.Code, w.Header(), w.Body.String())
			}
		})
	}
}
