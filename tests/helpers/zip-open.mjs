import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Open a zip the way Windows and SillyTavern do: central directory, CRC, sizes, and a real date. */
export function openZip(bytes) {
    const dir = mkdtempSync(join(tmpdir(), 'stsv-zip-'));
    const path = join(dir, 'expressions.zip');
    writeFileSync(path, bytes);
    execFileSync('unzip', ['-t', path], { stdio: 'pipe' });
    const report = execFileSync('python3', ['-c', `
import json, sys, zipfile
path = sys.argv[1]
with zipfile.ZipFile(path) as archive:
    bad = archive.testzip()
    if bad:
        raise SystemExit("crc failed for " + bad)
    rows = []
    for info in archive.infolist():
        year, month, day = info.date_time[:3]
        if year < 1980 or month < 1 or day < 1:
            raise SystemExit("Windows rejects the date on " + info.filename)
        data = archive.read(info)
        if info.file_size != len(data):
            raise SystemExit("size mismatch on " + info.filename)
        if info.file_size <= 0:
            raise SystemExit("empty entry " + info.filename)
        rows.append({
            "name": info.filename,
            "size": info.file_size,
            "method": info.compress_type,
            "crc": info.CRC,
            "date": list(info.date_time),
            "data": list(data),
        })
print(json.dumps(rows))
`, path], { encoding: 'utf8' });
    return JSON.parse(report).map((row) => ({
        ...row,
        data: Uint8Array.from(row.data),
    }));
}
