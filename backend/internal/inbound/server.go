package inbound

import (
	"artifacts/internal/domain"
	"artifacts/internal/game"
	"context"
	"encoding/json"
	"fmt"
	"github.com/coder/websocket"
	"io/fs"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

const Version = 1

type ClientMessage struct {
	ProtocolVersion int          `json:"protocolVersion"`
	Type            string       `json:"type"`
	RoundID         uint64       `json:"roundID"`
	Name            string       `json:"name"`
	Token           string       `json:"token"`
	Target          string       `json:"target"`
	Nonce           float64      `json:"nonce"`
	Input           domain.Input `json:"input"`
}
type Envelope struct {
	ProtocolVersion int    `json:"protocolVersion"`
	Type            string `json:"type"`
	RoundID         uint64 `json:"roundID"`
	ServerTick      uint64 `json:"serverTick"`
	Data            any    `json:"data"`
}
type peer struct {
	id       string
	reliable chan []byte
	snapshot chan []byte
	cancel   context.CancelFunc
}
type Server struct {
	Room        *game.Room
	mu          sync.Mutex
	peers       map[string]*peer
	ctx         context.Context
	Origins     []string
	connections atomic.Int64
	ready       atomic.Bool
	wg          sync.WaitGroup
}

func New(ctx context.Context, r *game.Room, origins []string) *Server {
	return &Server{Room: r, peers: map[string]*peer{}, ctx: ctx, Origins: origins}
}
func (s *Server) message(t string, data any) []byte {
	b, e := json.Marshal(Envelope{Version, t, s.Room.RoundID, s.Room.Tick, data})
	if e != nil {
		panic(e)
	}
	return b
}
func (s *Server) send(p *peer, t string, data any) {
	b := s.message(t, data)
	select {
	case p.reliable <- b:
	default:
		p.cancel()
	}
}
func (s *Server) full(p *peer) { s.send(p, "map", s.Room.Map); s.send(p, "snapshot", s.Room.State()) }
func (s *Server) Run() {
	s.ready.Store(true)
	defer s.ready.Store(false)
	ticker := time.NewTicker(time.Second / time.Duration(s.Room.Config.TickRate))
	defer ticker.Stop()
	acc := 0
	for {
		select {
		case <-s.ctx.Done():
			s.mu.Lock()
			for _, p := range s.peers {
				p.cancel()
			}
			s.mu.Unlock()
			s.wg.Wait()
			return
		case <-ticker.C:
			s.mu.Lock()
			old := s.Room.RoundID
			roles := map[string]string{}
			for _, player := range s.Room.Players {
				roles[player.ID] = fmt.Sprintf("%s:%d", player.Role, player.Queue)
			}
			s.Room.Step()
			for _, player := range s.Room.Players {
				if roles[player.ID] != fmt.Sprintf("%s:%d", player.Role, player.Queue) {
					if p := s.peers[player.ID]; p != nil {
						s.send(p, "role", map[string]any{"role": player.Role, "queue": player.Queue})
					}
				}
			}
			if old != s.Room.RoundID {
				for _, p := range s.peers {
					s.full(p)
				}
			}
			for _, e := range s.Room.Events {
				for _, p := range s.peers {
					s.send(p, e.Type, e)
					if e.Type == "round.finished" {
						s.send(p, "result", s.Room.Result)
					}
				}
			}
			s.Room.Events = nil
			acc += s.Room.Config.SnapshotRate
			if acc >= s.Room.Config.TickRate {
				acc -= s.Room.Config.TickRate
				b := s.message("snapshot", s.Room.State())
				for _, p := range s.peers {
					select {
					case <-p.snapshot:
					default:
					}
					select {
					case p.snapshot <- b:
					default:
					}
				}
			}
			s.mu.Unlock()
		}
	}
}
func (s *Server) Handler(frontend fs.FS) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200); _, _ = w.Write([]byte("ok")) })
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if !s.ready.Load() {
			http.Error(w, "not ready", 503)
			return
		}
		w.WriteHeader(200)
	})
	mux.HandleFunc("/ws", s.ws)
	if frontend != nil {
		mux.Handle("/", http.FileServer(http.FS(frontend)))
	}
	return mux
}
func (s *Server) ws(w http.ResponseWriter, req *http.Request) {
	if s.ctx.Err() != nil {
		http.Error(w, "shutting down", 503)
		return
	}
	if s.connections.Add(1) > int64(s.Room.Config.MaxConnections) {
		s.connections.Add(-1)
		http.Error(w, "capacity", 503)
		return
	}
	defer s.connections.Add(-1)
	c, e := websocket.Accept(w, req, &websocket.AcceptOptions{OriginPatterns: s.Origins})
	if e != nil {
		return
	}
	defer c.CloseNow()
	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	c.SetReadLimit(2048)
	read := func(timeout time.Duration) (ClientMessage, error) {
		rc, stop := context.WithTimeout(ctx, timeout)
		defer stop()
		_, b, e := c.Read(rc)
		var m ClientMessage
		if e == nil {
			e = json.Unmarshal(b, &m)
		}
		return m, e
	}
	m, e := read(5 * time.Second)
	if e != nil {
		return
	}
	s.mu.Lock()
	if m.ProtocolVersion != Version || (m.Type != "hello" && m.Type != "resume") {
		b := s.message("error", map[string]string{"code": "protocol_mismatch"})
		s.mu.Unlock()
		_ = c.Write(ctx, websocket.MessageText, b)
		return
	}
	t := ""
	if m.Type == "resume" {
		t = m.Token
		if t == "" {
			s.mu.Unlock()
			return
		}
	}
	if s.ctx.Err() != nil {
		s.mu.Unlock()
		return
	}
	player, e := s.Room.Join(m.Name, t)
	if e != nil {
		b := s.message("error", map[string]string{"code": e.Error()})
		s.mu.Unlock()
		_ = c.Write(ctx, websocket.MessageText, b)
		return
	}
	p := &peer{player.ID, make(chan []byte, 128), make(chan []byte, 1), cancel}
	s.peers[p.id] = p
	s.send(p, "welcome", map[string]any{"playerID": p.id, "token": player.Token, "role": player.Role, "queue": player.Queue})
	s.full(p)
	s.wg.Add(1)
	s.mu.Unlock()
	defer s.wg.Done()
	defer func() {
		s.mu.Lock()
		delete(s.peers, p.id)
		s.Room.Disconnect(p.id)
		slog.Info("disconnect", "playerID", p.id, "roundID", s.Room.RoundID, "mapID", s.Room.Map.ID, "reason", "connection_closed")
		s.mu.Unlock()
	}()
	slog.Info("connect", "playerID", p.id)
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer cancel()
		ping := time.NewTicker(15 * time.Second)
		defer ping.Stop()
		for {
			var b []byte
			select {
			case <-ctx.Done():
				return
			case b = <-p.reliable:
			default:
				select {
				case <-ctx.Done():
					return
				case b = <-p.reliable:
				case b = <-p.snapshot:
				case <-ping.C:
					pc, stop := context.WithTimeout(ctx, 5*time.Second)
					err := c.Ping(pc)
					stop()
					if err != nil {
						return
					}
					continue
				}
			}
			wc, stop := context.WithTimeout(ctx, 3*time.Second)
			err := c.Write(wc, websocket.MessageText, b)
			stop()
			if err != nil {
				return
			}
		}
	}()
	defer func() { cancel(); <-done }()
	window := time.Now()
	count := 0
	for {
		m, e = read(45 * time.Second)
		if e != nil {
			return
		}
		if time.Since(window) >= time.Second {
			window = time.Now()
			count = 0
		}
		count++
		if count > s.Room.Config.InputRate+10 {
			return
		}
		s.mu.Lock()
		if m.ProtocolVersion != Version {
			s.send(p, "error", map[string]string{"code": "protocol_mismatch"})
			s.mu.Unlock()
			continue
		}
		switch m.Type {
		case "input":
			if m.RoundID == s.Room.RoundID {
				s.Room.Input(p.id, m.Input)
			}
		case "ping":
			s.send(p, "pong", map[string]float64{"nonce": m.Nonce})
		case "spectate":
			target := s.Room.Player(m.Target)
			if target != nil && target.Alive {
				s.send(p, "spectate", map[string]string{"target": target.ID})
			}
		default:
			s.send(p, "error", map[string]string{"code": "unknown_message"})
		}
		s.mu.Unlock()
	}
}
