package game

import (
	d "artifacts/internal/domain"
	"artifacts/internal/platform"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"strings"
)

type Random interface{ Intn(int) int }
type Result struct {
	Winner    string     `json:"winner"`
	Reason    string     `json:"reason"`
	Standings []d.Player `json:"standings"`
}
type Snapshot struct {
	Phase     string       `json:"phase"`
	Remaining float64      `json:"remaining"`
	Players   []d.Player   `json:"players"`
	Monsters  []d.Monster  `json:"monsters"`
	Artifacts []d.Artifact `json:"artifacts"`
	Result    *Result      `json:"result"`
}
type Room struct {
	Config                      platform.Config
	Maps                        []d.Map
	Map                         d.Map
	RNG                         Random
	Players                     []*d.Player
	Monsters                    []*d.Monster
	Artifacts                   []d.Artifact
	Phase                       string
	RoundID, Tick, EventID      uint64
	Now, Deadline, NextArtifact float64
	Events                      []d.Event
	Result                      *Result
	order                       int
}

func New(c platform.Config, m []d.Map, r Random) *Room {
	return &Room{Config: c, Maps: m, Map: m[0], RNG: r, Phase: "waiting", Players: []*d.Player{}, Artifacts: []d.Artifact{}, Monsters: []*d.Monster{}}
}
func token() string {
	var b [24]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b[:])
}
func (r *Room) Join(name, t string) (*d.Player, error) {
	if t != "" {
		for _, p := range r.Players {
			if p.Token == t && !p.Connected && r.Now-p.OfflineAt <= r.Config.Grace {
				p.Connected = true
				return p, nil
			}
		}
		return nil, fmt.Errorf("session_expired")
	}
	name, e := d.Name(name)
	if e != nil {
		return nil, e
	}
	if len(r.Players) >= r.Config.MaxConnections {
		return nil, fmt.Errorf("room_full")
	}
	for _, p := range r.Players {
		if (p.Connected || r.Now-p.OfflineAt <= r.Config.Grace) && strings.EqualFold(p.Name, name) {
			return nil, fmt.Errorf("name_taken")
		}
	}
	r.order++
	p := &d.Player{ID: fmt.Sprintf("p%d", r.order), Name: name, Token: token(), Connected: true, Role: "spectator", Slot: -1, Order: r.order, Rect: d.Rect{W: 32, H: 46}, Facing: 1}
	r.Players = append(r.Players, p)
	r.queues()
	return p, nil
}
func (r *Room) Disconnect(id string) {
	if p := r.Player(id); p != nil {
		p.Connected = false
		p.OfflineAt = r.Now
		p.Buttons = d.Input{}
	}
}
func (r *Room) Player(id string) *d.Player {
	for _, p := range r.Players {
		if p.ID == id {
			return p
		}
	}
	return nil
}
func (r *Room) Input(id string, in d.Input) bool {
	p := r.Player(id)
	if p == nil || !p.Connected || !p.Alive || p.Role != "active" || r.Phase != "playing" || in.Seq <= p.Received {
		return false
	}
	p.Received = in.Seq
	p.Buttons = in
	return true
}
func (r *Room) emit(kind, source, target, cause string, amount int) {
	r.EventID++
	r.Events = append(r.Events, d.Event{ID: r.EventID, Type: kind, Source: source, Target: target, Cause: cause, Tick: r.Tick, Amount: amount})
}
func (r *Room) queues() {
	n := 0
	for _, p := range r.Players {
		p.Queue = 0
		if p.Slot < 0 && p.Connected {
			n++
			p.Queue = n
		}
	}
}
func (r *Room) start() {
	old := r.Map.ID
	options := []d.Map{}
	for _, m := range r.Maps {
		if m.ID != old || len(r.Maps) == 1 {
			options = append(options, m)
		}
	}
	r.Map = options[r.RNG.Intn(len(options))]
	r.RoundID++
	r.Result = nil
	r.Artifacts = []d.Artifact{}
	r.Monsters = []*d.Monster{}
	sort.SliceStable(r.Players, func(i, j int) bool {
		a, b := r.Players[i], r.Players[j]
		if (a.Slot >= 0) != (b.Slot >= 0) {
			return a.Slot >= 0
		}
		return a.Order < b.Order
	})
	slot := 0
	kept := []*d.Player{}
	for _, p := range r.Players {
		if !p.Connected && r.Now-p.OfflineAt > r.Config.Grace {
			continue
		}
		p.Slot = -1
		p.Role = "spectator"
		p.Alive = false
		p.HP = 0
		p.Artifacts = 0
		p.MonsterKills = 0
		p.PVPKills = 0
		p.Buttons = d.Input{}
		p.JumpHeld = false
		p.VY = 0
		p.Ground = false
		p.AttackAt = 0
		p.HurtUntil = 0
		if p.Connected && slot < 4 {
			p.Slot = slot
			p.Role = "active"
			p.Alive = true
			p.HP = 100
			p.X = r.Map.Spawns[slot].X
			p.Y = r.Map.Spawns[slot].Y
			slot++
		}
		kept = append(kept, p)
	}
	r.Players = kept
	r.queues()
	for i := range r.Map.MonsterSpawns {
		r.spawnMonster(i)
	}
	r.fillArtifacts()
	r.Phase = "countdown"
	r.Deadline = r.Now + r.Config.Countdown
	r.emit("round.countdown", "", "", "", 0)
}
func (r *Room) Step() {
	r.Tick++
	r.Now += 1 / float64(r.Config.TickRate)
	kept := r.Players[:0]
	for _, p := range r.Players {
		if p.Connected || p.Slot >= 0 || r.Now-p.OfflineAt <= r.Config.Grace {
			kept = append(kept, p)
		}
	}
	r.Players = kept
	r.queues()
	switch r.Phase {
	case "waiting":
		for _, p := range r.Players {
			if p.Connected {
				r.start()
				break
			}
		}
	case "countdown":
		if r.Now >= r.Deadline {
			r.Phase = "playing"
			r.Deadline = r.Now + r.Config.RoundSeconds
			r.emit("round.started", "", "", "", 0)
		}
	case "playing":
		r.simulate()
		if r.Phase == "playing" {
			alive := 0
			for _, p := range r.Players {
				if p.Alive && p.Slot >= 0 {
					alive++
				}
			}
			if alive == 0 {
				r.finish("all_dead", "")
			} else if r.Now >= r.Deadline {
				r.finish("timeout", "")
			}
		}
	case "round_finished":
		r.Phase = "intermission"
	case "intermission":
		if r.Now >= r.Deadline {
			r.Phase = "waiting"
			r.start()
			active := false
			for _, p := range r.Players {
				active = active || p.Slot >= 0
			}
			if !active {
				r.Phase = "waiting"
			}
		}
	}
}
func (r *Room) finish(reason, winner string) {
	if r.Phase != "playing" {
		return
	}
	s := []d.Player{}
	for _, p := range r.Players {
		if p.Slot >= 0 {
			s = append(s, *p)
		}
	}
	sort.SliceStable(s, func(i, j int) bool {
		a, b := s[i], s[j]
		if a.Artifacts != b.Artifacts {
			return a.Artifacts > b.Artifacts
		}
		if a.MonsterKills != b.MonsterKills {
			return a.MonsterKills > b.MonsterKills
		}
		return a.HP > b.HP
	})
	r.Result = &Result{winner, reason, s}
	r.Phase = "round_finished"
	r.Deadline = r.Now + r.Config.Intermission
	r.emit("round.finished", winner, "", reason, 0)
}
func (r *Room) State() Snapshot {
	s := Snapshot{Phase: r.Phase, Remaining: math.Max(0, r.Deadline-r.Now), Players: []d.Player{}, Monsters: []d.Monster{}, Artifacts: r.Artifacts, Result: r.Result}
	for _, p := range r.Players {
		s.Players = append(s.Players, *p)
	}
	for _, m := range r.Monsters {
		if m.HP > 0 {
			s.Monsters = append(s.Monsters, *m)
		}
	}
	return s
}
