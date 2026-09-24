package platform

import (
	"fmt"
	"math"
	"os"
	"strconv"
)

type MonsterConfig struct {
	HP, Damage                       int
	Speed, Radius, Cooldown, Respawn float64
}
type Config struct {
	TickRate, SnapshotRate, MaxConnections, InputRate                                                                    int
	RoundSeconds, Intermission, Countdown, Grace, ArtifactRespawn, Speed, Gravity, Jump, AttackCooldown, Invulnerability float64
	Damage                                                                                                               int
	Monsters                                                                                                             map[string]MonsterConfig
}

func Default() Config {
	return Config{30, 15, 128, 60, 180, 8, 3, 10, 3, 340, 1600, 820, .6, .35, 25, map[string]MonsterConfig{"mushroom": {50, 15, 80, 250, 1, 12}, "mimic": {100, 30, 45, 220, 1.4, 18}}}
}
func Load() (Config, error) {
	c := Default()
	for k, p := range map[string]*float64{"ROUND_SECONDS": &c.RoundSeconds, "INTERMISSION_SECONDS": &c.Intermission, "COUNTDOWN_SECONDS": &c.Countdown, "RECONNECT_GRACE_SECONDS": &c.Grace, "ARTIFACT_RESPAWN_SECONDS": &c.ArtifactRespawn, "MOVE_SPEED": &c.Speed, "GRAVITY": &c.Gravity, "JUMP_SPEED": &c.Jump} {
		if s := os.Getenv(k); s != "" {
			v, e := strconv.ParseFloat(s, 64)
			if e != nil || math.IsNaN(v) || math.IsInf(v, 0) || v <= 0 || v > 10000 {
				return c, fmt.Errorf("invalid %s", k)
			}
			*p = v
		}
	}
	for k, p := range map[string]*int{"TICK_RATE": &c.TickRate, "SNAPSHOT_RATE": &c.SnapshotRate, "MAX_CONNECTIONS": &c.MaxConnections, "INPUT_RATE": &c.InputRate} {
		if s := os.Getenv(k); s != "" {
			v, e := strconv.Atoi(s)
			if e != nil || v < 1 || v > 1000 {
				return c, fmt.Errorf("invalid %s", k)
			}
			*p = v
		}
	}
	if c.SnapshotRate > c.TickRate {
		return c, fmt.Errorf("snapshot rate exceeds tick rate")
	}
	return c, nil
}
