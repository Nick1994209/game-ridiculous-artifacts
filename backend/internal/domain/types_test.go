package domain

import "testing"

func TestName(t *testing.T) {
	for _, s := range []string{"", "   ", "a\nb", "12345678901234567"} {
		if _, e := Name(s); e == nil {
			t.Fatal(s)
		}
	}
	if n, e := Name("  Ведьма 🐸  "); e != nil || n != "Ведьма 🐸" {
		t.Fatal(n, e)
	}
}
