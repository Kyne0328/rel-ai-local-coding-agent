//go:build windows

package index

import (
    "fmt"
    "io"
    "math"
    "os"
)

type windowsIndexFile struct {
    name string
    size uint32
    file *os.File
}

func (f *windowsIndexFile) Read(off, sz uint32) ([]byte, error) {
    if off > off+sz || off+sz > f.size {
        return nil, fmt.Errorf("out of bounds: %d, len %d, name %s", off+sz, f.size, f.name)
    }
    if sz == 0 { return []byte{}, nil }
    data := make([]byte, sz)
    n, err := f.file.ReadAt(data, int64(off))
    if err == io.EOF && n == len(data) { err = nil }
    if err != nil { return nil, err }
    if n != len(data) { return nil, io.ErrUnexpectedEOF }
    return data, nil
}

func (f *windowsIndexFile) Name() string { return f.name }
func (f *windowsIndexFile) Size() (uint32, error) { return f.size, nil }
func (f *windowsIndexFile) Close() { _ = f.file.Close() }

func NewIndexFile(file *os.File) (IndexFile, error) {
    info, err := file.Stat()
    if err != nil { _ = file.Close(); return nil, err }
    if info.Size() >= math.MaxUint32 { _ = file.Close(); return nil, fmt.Errorf("file %s too large: %d", file.Name(), info.Size()) }
    return &windowsIndexFile{name: file.Name(), size: uint32(info.Size()), file: file}, nil
}