package maps

import (
	d "artifacts/internal/domain"
	"artifacts/internal/platform"
	"testing"
)

func TestMaps(t *testing.T) {
	ms, e := Load()
	if e != nil {
		t.Fatal(e)
	}
	if len(ms) != 5 {
		t.Fatal(len(ms))
	}
	for _, m := range ms {
		for _, p := range m.ArtifactSpawns {
			a := d.Rect{X: p.X, Y: p.Y, W: 24, H: 24}
			supported := false
			for _, s := range m.Platforms {
				if a.Overlaps(s) {
					t.Fatalf("%s artifact blocked %+v", m.ID, p)
				}
				if p.X >= s.X && p.X+24 <= s.X+s.W && s.Y-(p.Y+24) >= 0 && s.Y-(p.Y+24) < 8 {
					supported = true
				}
			}
			if !supported {
				t.Fatalf("%s unsupported artifact", m.ID)
			}
		}
	}
}

func TestDisconnectedFloorRejected(t *testing.T) {
	ms, e := Load()
	if e != nil {
		t.Fatal(e)
	}
	m := ms[0]
	m.Spawns[0].Y = m.Height - 48
	if err := ValidateRoutes(m); err == nil {
		t.Fatal("disconnected spawn accepted")
	}
}

func TestJumpHeadroom(t *testing.T) {
	ms, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	c := platform.Default()
	// Full jump plus the player body and a margin for the name above it.
	required := c.Jump*c.Jump/(2*c.Gravity) + 46 + 40
	for _, m := range ms {
		for _, p := range m.Platforms {
			if p.Y < required {
				t.Errorf("%s: platform at %.1f needs at least %.1f headroom", m.ID, p.Y, required)
			}
		}
	}
}
