package game

import (
	d "artifacts/internal/domain"
	"fmt"
	"math"
)

func (r *Room) solids() []d.Rect {
	return append(append([]d.Rect{}, r.Map.Platforms...), r.Map.Walls...)
}
func (r *Room) move(p *d.Player, dx, dy float64) {
	p.X += dx
	for _, s := range r.solids() {
		if p.Rect.Overlaps(s) {
			if dx > 0 {
				p.X = s.X - p.W
			} else if dx < 0 {
				p.X = s.X + s.W
			}
		}
	}
	p.X = math.Max(0, math.Min(r.Map.Width-p.W, p.X))
	p.Y += dy
	p.Ground = false
	for _, s := range r.solids() {
		if p.Rect.Overlaps(s) {
			if dy > 0 {
				p.Y = s.Y - p.H
				p.Ground = true
			} else if dy < 0 {
				p.Y = s.Y + s.H
			}
			p.VY = 0
		}
	}
}
func (r *Room) simulate() {
	dt := 1 / float64(r.Config.TickRate)
	for _, p := range r.Players {
		if !p.Alive || p.Slot < 0 {
			continue
		}
		if !p.Connected && r.Now-p.OfflineAt > r.Config.Grace {
			r.damage(p, 1000, "server", "disconnect")
			continue
		}
		in := p.Buttons
		p.LastSeq = in.Seq
		if p.LastSeq == 0 {
			p.LastSeq = p.Received
		}
		dir := 0
		if in.Left {
			dir--
		}
		if in.Right {
			dir++
		}
		if dir != 0 {
			p.Facing = dir
		}
		if in.Jump && !p.JumpHeld && p.Ground {
			p.VY = -r.Config.Jump
		}
		p.JumpHeld = in.Jump
		p.VY += r.Config.Gravity * dt
		r.move(p, float64(dir)*r.Config.Speed*dt, p.VY*dt)
		p.State = "idle"
		if dir != 0 {
			p.State = "run"
		}
		if !p.Ground {
			p.State = "fall"
			if p.VY < 0 {
				p.State = "jump"
			}
		}
		if r.Now < p.HurtUntil {
			p.State = "hurt"
		}
		if p.Y > r.Map.Height {
			r.damage(p, 1000, "world", "fall")
		}
		for _, h := range r.Map.Hazards {
			if p.Rect.Overlaps(h) {
				r.damage(p, 25, "world", "hazard")
			}
		}
		if p.Alive && in.Attack && r.Now >= p.AttackAt {
			r.attack(p)
		}
		if p.Alive {
			for i := 0; i < len(r.Artifacts); {
				a := r.Artifacts[i]
				if p.Rect.Overlaps(a.Rect) {
					p.Artifacts++
					r.emit("artifact.collected", p.ID, a.ID, "pickup", 1)
					r.Artifacts = append(r.Artifacts[:i], r.Artifacts[i+1:]...)
					if p.Artifacts >= 5 {
						r.finish("five_artifacts", p.ID)
						return
					}
				} else {
					i++
				}
			}
		}
	}
	r.monsters(dt)
	if r.Now >= r.NextArtifact {
		r.fillArtifacts()
		r.NextArtifact = r.Now + r.Config.ArtifactRespawn
	}
}
func (r *Room) damage(p *d.Player, n int, source, cause string) {
	if !p.Alive || (r.Now < p.HurtUntil && cause != "fall" && cause != "disconnect") {
		return
	}
	p.HP -= n
	if p.HP < 0 {
		p.HP = 0
	}
	p.HurtUntil = r.Now + r.Config.Invulnerability
	r.emit("hit", source, p.ID, cause, n)
	r.emit("damage", source, p.ID, cause, n)
	if p.HP == 0 {
		p.Alive = false
		p.Role = "spectator"
		p.State = "dead"
		p.Buttons = d.Input{}
		r.emit("player.died", source, p.ID, cause, n)
		if a := r.Player(source); a != nil {
			a.PVPKills++
			r.emit("player.killed", source, p.ID, cause, 1)
		}
	}
}
func (r *Room) attack(p *d.Player) {
	if !p.Alive || p.Role != "active" || r.Phase != "playing" || r.Now < p.AttackAt {
		return
	}
	p.AttackAt = r.Now + r.Config.AttackCooldown
	p.State = "attack"
	r.emit("attack", p.ID, "", "melee", 0)
	h := d.Rect{X: p.X + p.W, Y: p.Y + 4, W: 60, H: 40}
	if p.Facing < 0 {
		h.X = p.X - 60
	}
	for _, q := range r.Players {
		if q.ID != p.ID && q.Slot >= 0 && q.Alive && h.Overlaps(q.Rect) {
			before := q.HP
			r.damage(q, r.Config.Damage, p.ID, "melee")
			if q.HP < before {
				r.move(q, float64(p.Facing)*18, -3)
			}
		}
	}
	for _, m := range r.Monsters {
		if m.HP > 0 && r.Now >= m.HurtUntil && h.Overlaps(m.Rect) {
			m.HP -= r.Config.Damage
			m.HurtUntil = r.Now + r.Config.Invulnerability
			m.State = "hurt"
			r.emit("damage", p.ID, m.ID, "melee", r.Config.Damage)
			if m.HP <= 0 {
				m.State = "dead"
				m.RespawnAt = r.Now + r.Config.Monsters[m.Kind].Respawn
				p.MonsterKills++
				r.emit("monster.died", p.ID, m.ID, "melee", 1)
			}
		}
	}
}
func (r *Room) free(a d.Rect) bool {
	for _, s := range r.solids() {
		if a.Overlaps(s) {
			return false
		}
	}
	for _, h := range r.Map.Hazards {
		if a.Overlaps(h) {
			return false
		}
	}
	for _, p := range r.Players {
		if p.Alive && a.Overlaps(p.Rect) {
			return false
		}
	}
	for _, m := range r.Monsters {
		if m.HP > 0 && a.Overlaps(m.Rect) {
			return false
		}
	}
	for _, v := range r.Artifacts {
		if a.Overlaps(v.Rect) {
			return false
		}
	}
	return true
}
func (r *Room) fillArtifacts() {
	n := len(r.Map.ArtifactSpawns)
	start := r.RNG.Intn(n)
	for i := 0; i < n && len(r.Artifacts) < 10; i++ {
		s := r.Map.ArtifactSpawns[(start+i)%n]
		a := d.Rect{X: s.X, Y: s.Y, W: 24, H: 24}
		if r.free(a) {
			r.EventID++
			v := d.Artifact{ID: fmt.Sprintf("a%d", r.EventID), Kind: r.RNG.Intn(8), Rect: a}
			r.Artifacts = append(r.Artifacts, v)
			r.emit("artifact.spawned", "", v.ID, "spawn", 0)
		}
	}
}
func (r *Room) spawnMonster(i int) {
	s := r.Map.MonsterSpawns[i]
	m := &d.Monster{ID: fmt.Sprintf("m%d", i), Kind: s.Kind, Rect: d.Rect{X: s.X, Y: s.Y, W: 38, H: 40}, HP: r.Config.Monsters[s.Kind].HP, Facing: 1, State: "patrol", Spawn: i}
	r.Monsters = append(r.Monsters, m)
	r.emit("monster.spawned", "", m.ID, "spawn", 0)
}
func (r *Room) monsters(dt float64) {
	for _, m := range r.Monsters {
		cfg := r.Config.Monsters[m.Kind]
		s := r.Map.MonsterSpawns[m.Spawn]
		plat := r.Map.Platforms[s.Platform]
		if m.HP <= 0 {
			a := d.Rect{X: s.X, Y: s.Y, W: 38, H: 40}
			if r.Now >= m.RespawnAt && r.free(a) {
				m.Rect = a
				m.HP = cfg.HP
				m.State = "patrol"
				r.emit("monster.spawned", "", m.ID, "respawn", 0)
			}
			continue
		}
		if r.Now < m.HurtUntil {
			m.State = "hurt"
			continue
		}
		var target *d.Player
		nearest := cfg.Radius
		for _, p := range r.Players {
			dist := math.Abs(p.X - m.X)
			if p.Alive && p.Ground && math.Abs(p.Y+p.H-plat.Y) < 4 && p.X >= plat.X && p.X+p.W <= plat.X+plat.W && dist < nearest {
				target = p
				nearest = dist
			}
		}
		m.State = "patrol"
		if target != nil {
			m.State = "chase"
			if target.X < m.X {
				m.Facing = -1
			} else {
				m.Facing = 1
			}
			if nearest < 55 {
				m.State = "attack"
				if r.Now >= m.AttackAt {
					r.damage(target, cfg.Damage, m.ID, m.Kind)
					m.AttackAt = r.Now + cfg.Cooldown
				}
				continue
			}
		}
		next := m.X + float64(m.Facing)*cfg.Speed*dt
		if next < plat.X || next+m.W > plat.X+plat.W {
			m.Facing *= -1
		} else {
			blocked := false
			rect := m.Rect
			rect.X = next
			for _, wall := range r.solids() {
				if rect.Overlaps(wall) {
					blocked = true
					break
				}
			}
			if blocked {
				m.Facing *= -1
			} else {
				m.X = next
			}
		}
	}
}
