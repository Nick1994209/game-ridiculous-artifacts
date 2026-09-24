package maps

import (
	"artifacts/internal/domain"
	"artifacts/internal/platform"
	"embed"
	"encoding/json"
	"fmt"
	"math"
)

//go:embed *.json
var files embed.FS

func Load() ([]domain.Map, error) {
	entries, _ := files.ReadDir(".")
	out := []domain.Map{}
	for _, e := range entries {
		b, err := files.ReadFile(e.Name())
		if err != nil {
			return nil, err
		}
		var m domain.Map
		if err = json.Unmarshal(b, &m); err != nil {
			return nil, err
		}
		if err = Validate(m); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}
func Validate(m domain.Map) error {
	if m.ID == "" || m.Width <= 0 || m.Height <= 0 || len(m.Spawns) != 4 || len(m.ArtifactSpawns) < 12 || len(m.MonsterSpawns) < 4 {
		return fmt.Errorf("invalid map %s", m.ID)
	}
	for _, r := range append(append(append([]domain.Rect{}, m.Platforms...), m.Walls...), m.Hazards...) {
		if r.W <= 0 || r.H <= 0 || r.X < 0 || r.Y < 0 || r.X+r.W > m.Width || r.Y+r.H > m.Height {
			return fmt.Errorf("invalid geometry %s %+v", m.ID, r)
		}
	}
	for _, s := range m.Spawns {
		r := domain.Rect{X: s.X, Y: s.Y, W: 32, H: 46}
		for _, h := range append(append(append([]domain.Rect{}, m.Platforms...), m.Walls...), m.Hazards...) {
			if r.Overlaps(h) {
				return fmt.Errorf("blocked spawn %s", m.ID)
			}
		}
	}
	for _, a := range m.ArtifactSpawns {
		rect := domain.Rect{X: a.X, Y: a.Y, W: 24, H: 24}
		supported := false
		if a.X < 0 || a.Y < 0 || a.X+24 > m.Width || a.Y+24 > m.Height {
			return fmt.Errorf("artifact outside map %s", m.ID)
		}
		for _, p := range m.Platforms {
			if rect.Overlaps(p) {
				return fmt.Errorf("blocked artifact %s", m.ID)
			}
			if a.X >= p.X && a.X+24 <= p.X+p.W && p.Y-a.Y-24 >= 0 && p.Y-a.Y-24 < 8 {
				supported = true
			}
		}
		if !supported {
			return fmt.Errorf("unsupported artifact %s", m.ID)
		}
	}
	for _, s := range m.MonsterSpawns {
		if s.Platform < 0 || s.Platform >= len(m.Platforms) {
			return fmt.Errorf("bad monster platform")
		}
	}
	return ValidateRoutes(m)
}

// ValidateRoutes checks the platform graph within the default jump envelope.
// It detects disconnected floors; fine collision behaviour belongs to simulation.
func ValidateRoutes(m domain.Map) error {
	c := platform.Default()
	for _, spawn := range m.Spawns {
		seen := map[int]bool{}
		queue := []int{}
		for i, p := range m.Platforms {
			if spawn.X >= p.X && spawn.X+32 <= p.X+p.W && math.Abs(spawn.Y+48-p.Y) < 3 {
				seen[i] = true
				queue = append(queue, i)
			}
		}
		for len(queue) > 0 {
			i := queue[0]
			queue = queue[1:]
			a := m.Platforms[i]
			for j, b := range m.Platforms {
				if seen[j] {
					continue
				}
				disc := c.Jump*c.Jump + 2*c.Gravity*(b.Y-a.Y)
				if disc < 0 {
					continue
				}
				flight := (c.Jump + math.Sqrt(disc)) / c.Gravity
				gap := math.Max(0, math.Max(b.X-a.X-a.W, a.X-b.X-b.W))
				if gap+32 < c.Speed*flight {
					seen[j] = true
					queue = append(queue, j)
				}
			}
		}
		for _, a := range m.ArtifactSpawns {
			reachable := false
			for i, p := range m.Platforms {
				if seen[i] && a.X >= p.X && a.X+24 <= p.X+p.W && math.Abs(a.Y+26-p.Y) < 3 {
					reachable = true
				}
			}
			if !reachable {
				return fmt.Errorf("%s: unreachable artifact %+v from %+v", m.ID, a, spawn)
			}
		}
	}
	return nil
}
