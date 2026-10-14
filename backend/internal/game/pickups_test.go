package game

import (
	d "artifacts/internal/domain"
	"math"
	"math/rand"
	"testing"
)

func TestTasksAndSpacedPickupsOnEveryMap(t *testing.T) {
	for seed := int64(0); seed < 20; seed++ {
		r := room(t)
		r.RNG = rand.New(rand.NewSource(seed))
		for _, name := range []string{"a", "b", "c", "d"} {
			_, _ = r.Join(name, "")
		}
		for range r.Maps {
			r.start()
			if len(r.Required) != 5 || len(r.Artifacts) != 10 || len(r.Medkits) != 4 {
				t.Fatalf("%s seed %d: task=%v artifacts=%d kits=%d", r.Map.ID, seed, r.Required, len(r.Artifacts), len(r.Medkits))
			}
			seen := map[int]bool{}
			for _, kind := range r.Required {
				if seen[kind] {
					t.Fatal("duplicate task kind")
				}
				seen[kind] = true
				found := false
				for _, a := range r.Artifacts {
					found = found || a.Kind == kind
				}
				if !found {
					t.Fatal("task item missing on map", kind)
				}
			}
			points := []d.Rect{}
			for _, a := range r.Artifacts {
				points = append(points, a.Rect)
			}
			for _, kit := range r.Medkits {
				points = append(points, kit.Rect)
			}
			for i, a := range points {
				for _, b := range points[:i] {
					if math.Hypot(a.X-b.X, a.Y-b.Y) < pickupSpacing {
						t.Fatal("pickups too close")
					}
				}
			}
		}
	}
}

func TestOnlyUniqueTaskItemsCount(t *testing.T) {
	r := playing(t)
	p := r.Players[0]
	r.Required = []int{0, 1, 2, 3, 4}
	p.Collected = []int{0}
	p.Artifacts = 1
	r.Artifacts = []d.Artifact{{ID: "duplicate", Kind: 0, Rect: p.Rect}, {ID: "extra", Kind: 7, Rect: p.Rect}, {ID: "needed", Kind: 1, Rect: p.Rect}}
	r.simulate()
	if p.Artifacts != 2 || !containsKind(p.Collected, 1) || len(r.Artifacts) != 2 {
		t.Fatal("incorrect task pickup", p.Collected, r.Artifacts)
	}
	r.start()
	if len(p.Collected) != 0 || p.Artifacts != 0 {
		t.Fatal("collection leaked into new round")
	}
}

func TestMedkitHealingAndMinuteRespawn(t *testing.T) {
	r := playing(t)
	p := r.Players[0]
	kit := &r.Medkits[0]
	p.Rect = kit.Rect
	p.HP = 100
	r.collectMedkit(p)
	if !kit.Available {
		t.Fatal("full health consumed kit")
	}
	p.Alive = false
	p.HP = 0
	r.collectMedkit(p)
	if p.HP != 0 || !kit.Available {
		t.Fatal("dead player consumed kit")
	}
	p.Alive = true
	p.HP = 20
	r.collectMedkit(p)
	if p.HP != 70 || kit.Available {
		t.Fatal("kit must heal 50 HP")
	}
	deadline := kit.RespawnAt
	r.collectMedkit(p)
	if p.HP != 70 {
		t.Fatal("kit collected twice")
	}
	p.X = 0
	p.Y = 0
	r.Now = deadline - .01
	r.simulate()
	if kit.Available {
		t.Fatal("kit respawned early")
	}
	r.Now = deadline
	r.simulate()
	if !kit.Available || len(r.Medkits) != 4 {
		t.Fatal("kit did not respawn")
	}
	p.Rect = kit.Rect
	p.HP = 85
	r.collectMedkit(p)
	if p.HP != 100 || r.Events[len(r.Events)-1].Amount != 15 {
		t.Fatal("healing must cap at 100")
	}
}

func TestSlowRespawnPrioritizesMissingTaskKinds(t *testing.T) {
	r := playing(t)
	p := r.Players[0]
	kind := r.Required[0]
	// Leave one copy of the target on the map, positioned for a pickup.
	remaining := []d.Artifact{}
	for _, a := range r.Artifacts {
		if a.Kind != kind {
			remaining = append(remaining, a)
		}
	}
	r.Artifacts = append(remaining, d.Artifact{ID: "target", Kind: kind, Rect: p.Rect})
	r.simulate()
	if !containsKind(p.Collected, kind) {
		t.Fatal("target not collected")
	}
	count := len(r.Artifacts)
	due := r.NextArtifact
	if due-r.Now < 20 {
		t.Fatal("respawn too fast")
	}
	p.X = 0
	p.Y = 0
	r.Now = due - .01
	r.simulate()
	if len(r.Artifacts) != count {
		t.Fatal("early spawn")
	}
	r.Now = due
	r.simulate()
	if len(r.Artifacts) != count+1 || r.Artifacts[len(r.Artifacts)-1].Kind != kind {
		t.Fatal("missing task item not restored")
	}
	r.simulate()
	if len(r.Artifacts) != count+1 {
		t.Fatal("multiple items spawned in same interval")
	}
}

func TestRoundCannotExceedTenMinutes(t *testing.T) {
	r := room(t)
	r.Config.RoundSeconds = 900
	_, _ = r.Join("a", "")
	r.Step()
	for r.Phase != "playing" {
		r.Step()
	}
	if r.Deadline-r.Now > 600 {
		t.Fatal("round exceeds ten minutes")
	}
	r.Now = r.Deadline
	r.Step()
	if r.Result == nil || r.Result.Reason != "timeout" {
		t.Fatal("round did not end at deadline")
	}
}
