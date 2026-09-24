package domain

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

type Rect struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

func (a Rect) Overlaps(b Rect) bool {
	return a.X < b.X+b.W && a.X+a.W > b.X && a.Y < b.Y+b.H && a.Y+a.H > b.Y
}

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}
type MonsterSpawn struct {
	Point
	Platform int    `json:"platform"`
	Kind     string `json:"kind"`
}
type Map struct {
	ID             string         `json:"id"`
	Name           string         `json:"name"`
	Version        int            `json:"version"`
	Width          float64        `json:"width"`
	Height         float64        `json:"height"`
	Theme          string         `json:"theme"`
	Platforms      []Rect         `json:"platforms"`
	Walls          []Rect         `json:"walls"`
	Hazards        []Rect         `json:"hazards"`
	Spawns         []Point        `json:"spawns"`
	ArtifactSpawns []Point        `json:"artifactSpawns"`
	MonsterSpawns  []MonsterSpawn `json:"monsterSpawns"`
}
type Input struct {
	Seq    uint64 `json:"seq"`
	Left   bool   `json:"left"`
	Right  bool   `json:"right"`
	Jump   bool   `json:"jump"`
	Attack bool   `json:"attack"`
}
type Player struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
	Slot int    `json:"slot"`
	Rect
	HP           int     `json:"hp"`
	Artifacts    int     `json:"artifacts"`
	PVPKills     int     `json:"pvpKills"`
	MonsterKills int     `json:"monsterKills"`
	Connected    bool    `json:"connected"`
	Alive        bool    `json:"alive"`
	Facing       int     `json:"facing"`
	State        string  `json:"state"`
	LastSeq      uint64  `json:"lastProcessedInputSeq"`
	Queue        int     `json:"queue"`
	VY           float64 `json:"-"`
	Ground       bool    `json:"-"`
	Buttons      Input   `json:"-"`
	Received     uint64  `json:"-"`
	JumpHeld     bool    `json:"-"`
	AttackAt     float64 `json:"-"`
	HurtUntil    float64 `json:"-"`
	OfflineAt    float64 `json:"-"`
	Token        string  `json:"-"`
	Order        int     `json:"-"`
}
type Monster struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	Rect
	HP        int     `json:"hp"`
	Facing    int     `json:"facing"`
	State     string  `json:"state"`
	Spawn     int     `json:"-"`
	AttackAt  float64 `json:"-"`
	HurtUntil float64 `json:"-"`
	RespawnAt float64 `json:"-"`
}
type Artifact struct {
	ID   string `json:"id"`
	Kind int    `json:"kind"`
	Rect
}
type Event struct {
	ID     uint64 `json:"id"`
	Type   string `json:"type"`
	Source string `json:"source"`
	Target string `json:"target"`
	Cause  string `json:"cause"`
	Tick   uint64 `json:"serverTick"`
	Amount int    `json:"amount"`
}

func Name(s string) (string, error) {
	s = strings.TrimSpace(s)
	if !utf8.ValidString(s) || utf8.RuneCountInString(s) < 1 || utf8.RuneCountInString(s) > 16 {
		return "", fmt.Errorf("invalid_name")
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return "", fmt.Errorf("invalid_name")
		}
	}
	return s, nil
}
