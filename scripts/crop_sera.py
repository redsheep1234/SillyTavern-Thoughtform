#!/usr/bin/env python3
"""Cut Sera Voss board stills out of the sheets in docs/fixtures/sera-voss.

The sheets are the demo source. This only slices on the gray gaps, so a
re-run does not redraw the character.
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SHEETS = ROOT / 'docs' / 'fixtures' / 'sera-voss'
DOCS = ROOT / 'docs' / 'examples'

EXPRESSIONS = ['neutral', 'smile', 'laugh', 'sad', 'angry', 'surprised', 'blush', 'soft', 'wink']
VIEWS = ['front', 'three-quarter', 'side', 'back']


def contents(path, min_col, min_row):
    image = np.asarray(Image.open(path).convert('RGB'))
    corner = image[:8, :8].reshape(-1, 3).astype(np.int16).mean(axis=0)
    gutter = np.abs(image.astype(np.int16) - corner).sum(axis=2) < 45

    def bands(mask, min_gap):
        found = []
        start = None
        for index, flag in enumerate(mask):
            if flag and start is None:
                start = index
            if not flag and start is not None:
                if index - start >= min_gap:
                    found.append((start, index))
                start = None
        if start is not None and len(mask) - start >= min_gap:
            found.append((start, len(mask)))
        return found

    def spans(gutter_bands, length, min_size):
        pieces = []
        cursor = 0
        for start, end in gutter_bands:
            if start - cursor >= min_size:
                pieces.append((cursor, start))
            cursor = end
        if length - cursor >= min_size:
            pieces.append((cursor, length))
        return pieces

    rows = spans(bands(gutter.mean(axis=1) > 0.92, 8), image.shape[0], min_row)
    cols = spans(bands(gutter.mean(axis=0) > 0.88, 8), image.shape[1], min_col)
    pil = Image.fromarray(image)
    return [pil.crop((col[0], row[0], col[1], row[1])) for row in rows for col in cols]


def save(image, path):
    image.convert('RGB').save(path, quality=74, optimize=True)


def main():
    expressions = contents(SHEETS / 'expressions.jpg', 80, 80)
    if len(expressions) != 9:
        raise SystemExit(f'Expected 9 expression cells, found {len(expressions)}.')
    for name, tile in zip(EXPRESSIONS, expressions):
        save(tile, DOCS / f'sera-{name}.jpg')
    turns = contents(SHEETS / 'turnaround.jpg', 60, 200)
    if len(turns) != 4:
        raise SystemExit(f'Expected 4 turnaround views, found {len(turns)}.')
    for name, tile in zip(VIEWS, turns):
        save(tile, DOCS / f'sera-turn-{name}.jpg')
    save(Image.open(SHEETS / 'avatar.jpg'), DOCS / 'sera-avatar.jpg')
    save(Image.open(SHEETS / 'coral.jpg'), DOCS / 'sera-coral.jpg')
    save(Image.open(SHEETS / 'emerald.jpg'), DOCS / 'sera-emerald.jpg')


if __name__ == '__main__':
    main()
