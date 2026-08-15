#!/usr/bin/env python3
# 生成纯色测试 PNG（无第三方依赖）。用法: python3 make-test-image.py out.png R G B
import sys, zlib, struct
out, r, g, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
w, h = 120, 80
raw = b''.join(b'\x00' + bytes([r, g, b]) * w for _ in range(h))
def chunk(t, d):
    c = t + d
    return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
open(out, 'wb').write(png)
print(f'wrote {out} ({r},{g},{b})')
