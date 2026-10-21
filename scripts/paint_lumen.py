#!/usr/bin/env python3
"""Paint Lumen Quill, an original geometric character, plus a short likeness clip.

Sand face, teal braid, indigo coat, square lantern. Not a real person.
"""

import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs' / 'examples'
ART = Path('/opt/cursor/artifacts/demo')
W, H = 480, 640

EXPRESSIONS = {
    'neutral': {'mouth': 'line', 'brows': 'level', 'eyes': 'open'},
    'happy': {'mouth': 'smile', 'brows': 'level', 'eyes': 'open'},
    'laughing': {'mouth': 'open', 'brows': 'up', 'eyes': 'shut'},
    'sad': {'mouth': 'frown', 'brows': 'sad', 'eyes': 'open'},
    'crying': {'mouth': 'frown', 'brows': 'sad', 'eyes': 'open', 'tears': True},
    'angry': {'mouth': 'flat', 'brows': 'angry', 'eyes': 'open'},
    'surprised': {'mouth': 'o', 'brows': 'up', 'eyes': 'wide'},
    'scared': {'mouth': 'o', 'brows': 'up', 'eyes': 'wide'},
    'embarrassed': {'mouth': 'smile', 'brows': 'sad', 'eyes': 'aside', 'blush': True},
    'smug': {'mouth': 'smirk', 'brows': 'one', 'eyes': 'open'},
    'thinking': {'mouth': 'line', 'brows': 'one', 'eyes': 'aside'},
    'determined': {'mouth': 'flat', 'brows': 'angry', 'eyes': 'open'},
    'flirty': {'mouth': 'smirk', 'brows': 'one', 'eyes': 'shut'},
    'tired': {'mouth': 'line', 'brows': 'sad', 'eyes': 'tired'},
}


def draw_lumen(expression='neutral', view='front', outfit='coat', bob=0, label=None):
    image = Image.new('RGB', (W, H), (28, 24, 22))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, W, 18), fill=(224, 176, 90))
    shift = {'front': 0, 'three-quarter': 36, 'side': 78, 'back': 0}[view]
    cx = 250 + shift
    top = 70 + bob
    coat = (196, 122, 62) if outfit == 'uniform' else (46, 72, 168)
    # Coat and legs.
    draw.rounded_rectangle((cx - 110, top + 210, cx + 110, top + 470), 28, fill=coat)
    draw.rectangle((cx - 46, top + 450, cx - 12, top + 530), fill=(32, 28, 26))
    draw.rectangle((cx + 12, top + 450, cx + 46, top + 530), fill=(32, 28, 26))
    if outfit == 'uniform':
        draw.rectangle((cx - 78, top + 250, cx + 78, top + 400), fill=(232, 168, 74))
        draw.rectangle((cx - 70, top + 270, cx + 70, top + 300), fill=(120, 72, 36))
    # Braid.
    if view != 'side':
        draw.rounded_rectangle((cx + 36, top + 40, cx + 68, top + 250), 16, fill=(32, 150, 148))
    else:
        draw.rounded_rectangle((cx + 10, top + 40, cx + 36, top + 250), 12, fill=(32, 150, 148))
    # Lantern, kept in every view so the clip matches the board.
    lx = 70
    draw.rectangle((lx, top + 300, lx + 64, top + 380), fill=(255, 196, 92))
    draw.rectangle((lx + 8, top + 312, lx + 56, top + 368), fill=(255, 228, 150))
    draw.rectangle((lx + 24, top + 280, lx + 40, top + 300), fill=(90, 64, 32))
    if view != 'back':
        face = (214, 176, 138)
        rx = 78 if view != 'side' else 46
        draw.ellipse((cx - rx, top + 20, cx + rx, top + 190), fill=face)
        spec = EXPRESSIONS[expression]
        if spec.get('blush'):
            draw.ellipse((cx - 58, top + 110, cx - 28, top + 136), fill=(214, 120, 120))
            draw.ellipse((cx + 28, top + 110, cx + 58, top + 136), fill=(214, 120, 120))
        eye_y = top + 90
        eyes = [cx - 28, cx + 28] if view != 'side' else [cx + 8]
        for ex in eyes:
            if spec['eyes'] == 'shut':
                draw.arc((ex - 16, eye_y, ex + 16, eye_y + 18), 200, 340, fill=(42, 32, 30), width=4)
            elif spec['eyes'] == 'tired':
                draw.rectangle((ex - 14, eye_y + 6, ex + 14, eye_y + 12), fill=(42, 32, 30))
            else:
                ry = 16 if spec['eyes'] == 'wide' else 10
                draw.ellipse((ex - 12, eye_y, ex + 12, eye_y + ry), fill=(42, 32, 30))
            if spec['eyes'] == 'aside':
                draw.ellipse((ex + 2, eye_y + 3, ex + 8, eye_y + 9), fill=(214, 176, 138))
        brow_y = top + 68
        if spec['brows'] == 'angry':
            draw.line((cx - 46, brow_y + 8, cx - 12, brow_y - 4), fill=(90, 52, 40), width=4)
            draw.line((cx + 12, brow_y - 4, cx + 46, brow_y + 8), fill=(90, 52, 40), width=4)
        elif spec['brows'] == 'sad':
            draw.line((cx - 46, brow_y - 4, cx - 12, brow_y + 6), fill=(90, 52, 40), width=4)
            draw.line((cx + 12, brow_y + 6, cx + 46, brow_y - 4), fill=(90, 52, 40), width=4)
        elif spec['brows'] == 'up':
            draw.arc((cx - 48, brow_y - 10, cx - 8, brow_y + 10), 200, 340, fill=(90, 52, 40), width=4)
            draw.arc((cx + 8, brow_y - 10, cx + 48, brow_y + 10), 200, 340, fill=(90, 52, 40), width=4)
        elif spec['brows'] == 'one':
            draw.line((cx - 46, brow_y, cx - 12, brow_y), fill=(90, 52, 40), width=4)
            draw.line((cx + 12, brow_y + 8, cx + 46, brow_y - 6), fill=(90, 52, 40), width=4)
        else:
            draw.line((cx - 46, brow_y, cx - 12, brow_y), fill=(90, 52, 40), width=4)
            draw.line((cx + 12, brow_y, cx + 46, brow_y), fill=(90, 52, 40), width=4)
        mouth = spec['mouth']
        my = top + 142
        if mouth == 'smile':
            draw.arc((cx - 28, my - 10, cx + 28, my + 24), 20, 160, fill=(120, 64, 62), width=4)
        elif mouth == 'frown':
            draw.arc((cx - 28, my, cx + 28, my + 28), 200, 340, fill=(120, 64, 62), width=4)
        elif mouth == 'open':
            draw.ellipse((cx - 22, my, cx + 22, my + 28), fill=(120, 64, 62))
        elif mouth == 'o':
            draw.ellipse((cx - 12, my, cx + 12, my + 22), outline=(120, 64, 62), width=4)
        elif mouth == 'smirk':
            draw.arc((cx - 8, my - 8, cx + 32, my + 18), 10, 160, fill=(120, 64, 62), width=4)
        elif mouth == 'flat':
            draw.line((cx - 24, my + 8, cx + 24, my + 8), fill=(120, 64, 62), width=4)
        else:
            draw.line((cx - 20, my + 6, cx + 20, my + 6), fill=(120, 64, 62), width=3)
        if spec.get('tears'):
            draw.line((cx - 28, eye_y + 16, cx - 34, eye_y + 48), fill=(120, 170, 190), width=3)
            draw.line((cx + 28, eye_y + 16, cx + 34, eye_y + 48), fill=(120, 170, 190), width=3)
    else:
        draw.ellipse((cx - 78, top + 20, cx + 78, top + 190), fill=(186, 142, 112))
        draw.rounded_rectangle((cx - 16, top + 30, cx + 16, top + 280), 12, fill=(32, 150, 148))
    title = label or expression.replace('-', ' ')
    draw.text((16, H - 36), f'Lumen Quill · {title}', fill=(244, 236, 220))
    return image


def save_stills():
    DOCS.mkdir(parents=True, exist_ok=True)
    ART.mkdir(parents=True, exist_ok=True)
    jobs = [(name, 'front', 'coat', name) for name in EXPRESSIONS]
    jobs += [('turn-front', 'front', 'coat', 'front'), ('turn-three-quarter', 'three-quarter', 'coat', 'three-quarter'),
             ('turn-side', 'side', 'coat', 'side'), ('turn-back', 'back', 'coat', 'back'),
             ('uniform', 'front', 'uniform', 'market uniform')]
    for stem, view, outfit, label in jobs:
        expression = stem if stem in EXPRESSIONS else 'neutral'
        image = draw_lumen(expression, view, outfit, label=label)
        image.save(ART / f'lumen-{stem}.png')
        image.convert('RGB').save(DOCS / f'lumen-{stem}.jpg', quality=70, optimize=True)


def write_video():
    width, height, fps, seconds = 640, 360, 12, 8
    out = ART / 'lumen-likeness.mp4'
    command = [
        'ffmpeg', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{width}x{height}',
        '-r', str(fps), '-i', '-', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        str(out),
    ]
    proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    board = draw_lumen('neutral', 'front', 'coat', label='board').resize((220, 293))
    for frame in range(fps * seconds):
        t = frame / fps
        bob = 8 if int(t * 2) % 2 == 0 else -8
        step = int((t - 2) * 36) if t > 2 else 0
        expr = 'happy' if t > 4 else 'neutral'
        walk = draw_lumen(expr, 'front', 'coat', bob=bob, label='video').resize((220, 293))
        canvas = Image.new('RGB', (width, height), (18, 16, 14))
        draw = ImageDraw.Draw(canvas)
        draw.text((24, 16), 'Board still', fill=(244, 236, 220))
        draw.text((360, 16), 'Same lantern, braid, and coat', fill=(244, 236, 220))
        canvas.paste(board, (24, 40))
        canvas.paste(walk, (340 + min(step, 40), 40))
        proc.stdin.write(canvas.tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise SystemExit('ffmpeg failed')
    subprocess.check_call([
        'ffmpeg', '-y', '-i', str(out), '-an', '-c:v', 'libx264', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        str(DOCS / 'lumen-likeness.mp4'),
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    save_stills()
    write_video()
