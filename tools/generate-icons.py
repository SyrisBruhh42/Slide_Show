"""Generate original, dependency-free PNG icons for the collection viewer."""
from pathlib import Path
import struct
import zlib


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))


for size in (16, 48, 128):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            u, v = x / size, y / size
            frame = .16 < u < .84 and .18 < v < .82
            mountain = frame and v > .72 - .5 * min(u - .16, .84 - u)
            color = (71, 197, 173) if mountain else (225, 245, 245) if frame else (18, 38, 48)
            row.extend(color)
        rows.append(row)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b'')
    (Path(__file__).resolve().parents[1] / 'src/assets/icons' / f'icon{size}.png').write_bytes(png)
