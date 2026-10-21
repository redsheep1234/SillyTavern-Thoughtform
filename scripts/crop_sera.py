#!/usr/bin/env python3
"""Cut Sera Voss board stills out of the original sheets in docs/fixtures/sera-voss.

The sheets are the source art. This only slices on the gray gaps.
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SHEETS = ROOT / 'docs' / 'fixtures' / 'sera-voss'
DOCS = ROOT / 'docs' / 'examples'

EXPRESSIONS = ['neutral', 'smile', 'laugh', 'sad', 'angry', 'surprised', 'blush', 'soft', 'wink']
VIEWS = ['front', 'three-quarter', 'side', 'back']


def sheet_tiles(path, expect_rows, expect_cols, min_col, min_row):
    image = np.asarray(Image.open(path).convert('RGB'))
    corner = image[:12, :12].reshape(-1, 3).astype(np.int16).mean(axis=0)
    distance = np.abs(image.astype(np.int16) - corner).sum(axis=2)
    gutter = distance < 45

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

    # A wide sheet is mostly gray on each row, so the row test stays strict.
    # The expression grid needs a looser row test because the gaps are short.
    attempts = ((0.92, 0.88), (0.70, 0.85), (0.55, 0.85))
    pil = Image.fromarray(image)
    for row_frac, col_frac in attempts:
        rows = spans(bands(gutter.mean(axis=1) > row_frac, 8), image.shape[0], min_row)
        cols = spans(bands(gutter.mean(axis=0) > col_frac, 8), image.shape[1], min_col)
        if len(rows) == expect_rows and len(cols) == expect_cols:
            return [pil.crop((col[0], row[0], col[1], row[1])) for row in rows for col in cols]
    raise SystemExit(f'{path.name}: expected {expect_rows}x{expect_cols} cells.')


def save(image, path):
    image.convert('RGB').save(path, quality=85, optimize=True)


def main():
    expressions = sheet_tiles(SHEETS / 'expressions.jpg', 3, 3, 80, 80)
    for name, tile in zip(EXPRESSIONS, expressions):
        save(tile, DOCS / f'sera-{name}.jpg')
    turns = sheet_tiles(SHEETS / 'turnaround.jpg', 1, 4, 60, 200)
    for name, tile in zip(VIEWS, turns):
        save(tile, DOCS / f'sera-turn-{name}.jpg')
    save(Image.open(SHEETS / 'avatar.png'), DOCS / 'sera-avatar.jpg')
    save(Image.open(SHEETS / 'outfit-coral-bikini.jpg'), DOCS / 'sera-coral.jpg')
    save(Image.open(SHEETS / 'outfit-emerald-dress.jpg'), DOCS / 'sera-emerald.jpg')


if __name__ == '__main__':
    main()
