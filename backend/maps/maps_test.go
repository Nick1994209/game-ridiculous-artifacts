package maps

import (
	d "artifacts/internal/domain"
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
