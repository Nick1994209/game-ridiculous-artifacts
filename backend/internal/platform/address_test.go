package platform

import "testing"

func TestListenAddress(t *testing.T) {
	for _, tc := range []struct {
		port, addr, want string
		invalid          bool
	}{
		{"", "", ":8080", false},
		{"", "127.0.0.1:8081", "127.0.0.1:8081", false},
		{"9000", "127.0.0.1:8081", ":9000", false},
		{"0", "", "", true},
		{"65536", "", "", true},
		{"abc", "", "", true},
	} {
		t.Run(tc.port+"/"+tc.addr, func(t *testing.T) {
			t.Setenv("PORT", tc.port)
			t.Setenv("ADDR", tc.addr)
			got, err := ListenAddress()
			if (err != nil) != tc.invalid || got != tc.want {
				t.Fatalf("got %q, %v; want %q (invalid=%v)", got, err, tc.want, tc.invalid)
			}
		})
	}
}
