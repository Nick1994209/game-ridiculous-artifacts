package platform

import "testing"

func TestRoundAndRespawnLimits(t *testing.T) {
	t.Setenv("ROUND_SECONDS", "600")
	t.Setenv("ARTIFACT_RESPAWN_SECONDS", "20")
	if _, err := Load(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ROUND_SECONDS", "601")
	if _, err := Load(); err == nil {
		t.Fatal("accepted round longer than ten minutes")
	}
	t.Setenv("ROUND_SECONDS", "600")
	t.Setenv("ARTIFACT_RESPAWN_SECONDS", "1")
	if _, err := Load(); err == nil {
		t.Fatal("accepted rapid respawn")
	}
}
