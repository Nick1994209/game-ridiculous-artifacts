package game

import (
	d "artifacts/internal/domain"
	"artifacts/internal/platform"
	"artifacts/maps"
	"math/rand"
	"testing"
)

func room(t *testing.T) *Room {
	t.Helper()
	m, e := maps.Load()
	if e != nil {
		t.Fatal(e)
	}
	c := platform.Default()
	c.Countdown = .05
	c.Intermission = .05
	return New(c, m, rand.New(rand.NewSource(42)))
}
func playing(t *testing.T) *Room {
	r := room(t)
	_, _ = r.Join("a", "")
	r.Step()
	for r.Phase != "playing" {
		r.Step()
	}
	r.Monsters = nil
	return r
}
func TestLifecycle(t *testing.T) {
	r := playing(t)
	old := r.Map.ID
	r.Deadline = r.Now
	r.Step()
	if r.Phase != "round_finished" || r.Result.Winner != "" {
		t.Fatal(r.State())
	}
	r.Step()
	if r.Phase != "intermission" {
		t.Fatal(r.Phase)
	}
	for r.Phase == "intermission" {
		r.Step()
	}
	if r.Map.ID == old || r.RoundID != 2 {
		t.Fatal("map repeated")
	}
}
func TestPickupAtomicAndFifth(t *testing.T) {
	r := room(t)
	p, _ := r.Join("a", "")
	q, _ := r.Join("b", "")
	r.start()
	r.Phase = "playing"
	r.Deadline = 999
	r.Monsters = nil
	p.Artifacts = 3
	q.Rect = p.Rect
	r.Artifacts = []d.Artifact{{ID: "one", Rect: p.Rect}}
	r.simulate()
	if p.Artifacts != 4 || q.Artifacts != 0 || r.Phase != "playing" {
		t.Fatal("not atomic", p.Artifacts, q.Artifacts)
	}
	r.Artifacts = []d.Artifact{{ID: "two", Rect: p.Rect}}
	r.simulate()
	if r.Result == nil || r.Result.Winner != p.ID {
		t.Fatal("no fifth win")
	}
	r.finish("timeout", "")
	if r.Result.Winner != p.ID {
		t.Fatal("double finish")
	}
}
func TestCombatInput(t *testing.T) {
	r := room(t)
	p, _ := r.Join("a", "")
	q, _ := r.Join("b", "")
	r.start()
	r.Phase = "playing"
	p.X = 200
	p.Y = 50
	q.X = 240
	q.Y = 50
	p.Facing = 1
	r.attack(p)
	if q.HP != 75 {
		t.Fatal(q.HP)
	}
	r.attack(p)
	if q.HP != 75 {
		t.Fatal("invulnerability")
	}
	r.Now += 1
	q.X = 900
	r.attack(p)
	if q.HP != 75 {
		t.Fatal("hitbox")
	}
	if !r.Input(p.ID, d.Input{Seq: 2, Right: true}) || r.Input(p.ID, d.Input{Seq: 1}) {
		t.Fatal("sequence")
	}
	r.damage(p, 1000, "world", "fall")
	if p.Role != "spectator" || r.Input(p.ID, d.Input{Seq: 3, Attack: true}) {
		t.Fatal("dead input")
	}
}
func TestQueueReconnect(t *testing.T) {
	r := room(t)
	var ps []*d.Player
	for _, name := range []string{"a", "b", "c", "d", "e", "f"} {
		p, e := r.Join(name, "")
		if e != nil {
			t.Fatal(e)
		}
		ps = append(ps, p)
	}
	r.start()
	if ps[3].Slot != 3 || ps[4].Queue != 1 || ps[5].Queue != 2 {
		t.Fatal("slots")
	}
	r.Phase = "playing"
	r.Disconnect(ps[0].ID)
	p, e := r.Join("", ps[0].Token)
	if e != nil || p != ps[0] {
		t.Fatal("resume")
	}
	r.Disconnect(p.ID)
	r.Now += 11
	if _, e = r.Join("", p.Token); e == nil {
		t.Fatal("expired")
	}
	if ps[4].Slot != -1 {
		t.Fatal("midround promotion")
	}
	r.start()
	if ps[4].Slot < 0 || ps[5].Slot != -1 {
		t.Fatal("fifo")
	}
}
func TestDeathTimeoutAndCountdown(t *testing.T) {
	r := playing(t)
	p := r.Players[0]
	r.damage(p, 1000, "world", "fall")
	r.Step()
	if r.Result.Reason != "all_dead" {
		t.Fatal(r.Result)
	}
	r = room(t)
	p, _ = r.Join("a", "")
	r.Step()
	x := p.X
	if r.Input(p.ID, d.Input{Seq: 1, Right: true}) {
		t.Fatal("countdown input")
	}
	r.Step()
	if p.X != x {
		t.Fatal("countdown movement")
	}
}
func TestMonster(t *testing.T) {
	r := playing(t)
	r.spawnMonster(0)
	m := r.Monsters[0]
	p := r.Players[0]
	plat := r.Map.Platforms[r.Map.MonsterSpawns[0].Platform]
	p.X = m.X + 40
	p.Y = plat.Y - p.H
	p.Ground = true
	r.monsters(.033)
	if m.State != "attack" || p.HP >= 100 {
		t.Fatal("monster attack", m, p.HP)
	}
	hp := p.HP
	r.monsters(.033)
	if p.HP != hp {
		t.Fatal("monster cooldown")
	}
	p.Alive = false
	m.X = plat.X
	r.monsters(.1)
	if m.State != "patrol" {
		t.Fatal("dead target")
	}
}
func TestMapRotation(t *testing.T) {
	r := room(t)
	_, _ = r.Join("a", "")
	for i := 0; i < 30; i++ {
		old := r.Map.ID
		r.start()
		if r.Map.ID == old {
			t.Fatal("repeat")
		}
	}
}

func TestCollisionAndSingleJump(t *testing.T) {
	r := playing(t)
	p := r.Players[0]
	r.Map.Platforms = []d.Rect{{X: 0, Y: 200, W: 500, H: 20}}
	r.Map.Hazards = nil
	r.Artifacts = nil
	r.NextArtifact = 999
	p.X = 40
	p.Y = 154
	p.VY = 0
	p.Ground = true
	if !r.Input(p.ID, d.Input{Seq: 1, Jump: true}) {
		t.Fatal("input")
	}
	r.simulate()
	if p.VY >= 0 {
		t.Fatal("no jump")
	}
	velocity := p.VY
	r.simulate()
	if p.VY <= velocity {
		t.Fatal("held jump launched again")
	}
	for i := 0; i < 50; i++ {
		r.simulate()
	}
	if p.Y > 154.01 {
		t.Fatal("fell through platform", p.Y)
	}
	r.Map.Walls = []d.Rect{{X: 100, Y: 0, W: 20, H: 200}}
	p.X = 60
	r.move(p, 20, 0)
	if p.X+p.W > 100 {
		t.Fatal("wall collision")
	}
}
func TestAttackCooldown(t *testing.T) {
	r := room(t)
	p, _ := r.Join("a", "")
	q, _ := r.Join("b", "")
	r.start()
	r.Phase = "playing"
	p.X = 100
	p.Y = 0
	p.Facing = 1
	q.X = 140
	q.Y = 0
	r.attack(p)
	r.Now += .4
	q.HurtUntil = 0
	q.X = 140
	r.attack(p)
	if q.HP != 75 {
		t.Fatal("cooldown bypass", q.HP)
	}
	r.Now += .21
	r.attack(p)
	if q.HP != 50 {
		t.Fatal("attack not rearmed", q.HP)
	}
}
func TestExpiredSpectatorsAreRemoved(t *testing.T) {
	r := room(t)
	p, _ := r.Join("a", "")
	r.Disconnect(p.ID)
	r.Now = 20
	r.Step()
	if len(r.Players) != 0 {
		t.Fatal("expired session retained")
	}
}
