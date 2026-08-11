//go:build windows

package index

import "os"

func platformUmask() os.FileMode { return 0 }