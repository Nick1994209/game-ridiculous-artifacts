package platform

import (
	"fmt"
	"net"
	"os"
	"strconv"
)

// ListenAddress keeps ADDR compatibility while giving hosting platforms' PORT priority.
func ListenAddress() (string, error) {
	if port := os.Getenv("PORT"); port != "" {
		n, err := strconv.ParseUint(port, 10, 16)
		if err != nil || n == 0 {
			return "", fmt.Errorf("PORT must be an integer between 1 and 65535")
		}
		return net.JoinHostPort("", strconv.FormatUint(n, 10)), nil
	}
	if addr := os.Getenv("ADDR"); addr != "" {
		return addr, nil
	}
	return ":8080", nil
}
