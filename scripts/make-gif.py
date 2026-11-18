"""record-gif.cjs가 받은 프레임(test-results/gif/frames + frames.json)을 README용 GIF로 묶는다.

    python scripts/make-gif.py <프레임 폴더의 부모> <출력 gif> [--fps 8] [--width 560] [--colors 128]

프레임 시각(브라우저 기준)을 그대로 따라 일정한 간격으로 다시 고르므로 녹화 중 느려진 구간도 실제 속도로 재생된다.
Pillow가 필요하다: pip install pillow
"""
import argparse
import json
import os
import sys

from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--fps', type=float, default=8)
    ap.add_argument('--width', type=int, default=560)
    ap.add_argument('--colors', type=int, default=128)
    a = ap.parse_args()

    with open(os.path.join(a.src, 'frames.json'), encoding='utf-8') as f:
        frames = json.load(f)
    if len(frames) < 2:
        sys.exit('프레임이 너무 적습니다')

    t0, t1 = frames[0]['t'], frames[-1]['t']
    step = 1 / a.fps
    picked, i, t = [], 0, t0
    while t <= t1:   # 시각 t에 화면에 떠 있던 프레임(그 시각 이전의 마지막 프레임)
        while i + 1 < len(frames) and frames[i + 1]['t'] <= t:
            i += 1
        picked.append(frames[i]['file'])
        t += step

    images = []
    for name in picked:
        im = Image.open(os.path.join(a.src, 'frames', name)).convert('RGB')
        h = round(im.height * a.width / im.width)
        images.append(im.resize((a.width, h), Image.LANCZOS))

    # 한 팔레트를 모든 프레임에 써서 깜빡임을 줄이고, 바뀐 부분만 저장되게 한다.
    # 팔레트는 처음부터 끝까지 고르게 고른 프레임으로 만든다 (나중에 열리는 장식 패널의 색 견본까지 들어가도록)
    n = min(12, len(images))
    picks = [round(k * (len(images) - 1) / (n - 1)) for k in range(n)] if n > 1 else [0]
    hgt = images[0].height
    sample = Image.new('RGB', (a.width, hgt * n))
    for k, idx in enumerate(picks):
        sample.paste(images[idx], (0, hgt * k))
    palette = sample.quantize(colors=a.colors, method=Image.Quantize.FASTOCTREE)   # 패널 같은 넓은 면의 색 오차가 가장 작음
    out = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im in images]

    out[0].save(a.out, save_all=True, append_images=out[1:], duration=round(1000 / a.fps), loop=0, optimize=True, disposal=1)
    print(f'{a.out}: {len(out)}프레임, {len(out) / a.fps:.1f}초, {os.path.getsize(a.out) / 1024 / 1024:.1f}MB')


if __name__ == '__main__':
    main()
