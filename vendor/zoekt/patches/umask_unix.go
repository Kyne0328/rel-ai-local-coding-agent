//go:build !windows

package index

import (
    "os"
    "golang.org/x/sys/unix"
)

func platformUmask() os.FileMode {
    value := os.FileMode(unix.Umask(0))
    unix.Umask(int(value))
    return value
}