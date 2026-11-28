"""Builds each theme's switch sound from its source in design/<theme>/switch.mp3:
  sakura, terminal, space -> public/themes/<theme>/switch.mp3
The sources run about 4 s; their sound is in the first 1.3 s and the rest is a long quiet tail. Each is cut to 2.6 s
with a fade over its last 0.8 s, brought to the same loudness (-17 LUFS) and stored at 96 kb/s stereo: about 30 KB
instead of 160 KB. src/lib/theme.ts plays it as the theme spreads (the reveal lasts as long as the sound's body).
Usage: python scripts/sounds.py  (needs ffmpeg on PATH, or the imageio-ffmpeg package)"""
import os
import shutil
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEMES = ('sakura', 'terminal', 'space')
LENGTH = 2.6
FADE = 0.8
LOUDNESS = -17.0


def ffmpeg():
    found = shutil.which('ffmpeg')
    if found:
        return found
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def loudness(exe, src):
    out = subprocess.run([exe, '-hide_banner', '-i', src, '-af', 'loudnorm=print_format=summary', '-f', 'null', '-'], capture_output=True, text=True).stderr
    line = next(l for l in out.splitlines() if 'Input Integrated' in l)
    return float(line.split(':')[1].split()[0])


def main():
    exe = ffmpeg()
    for theme in THEMES:
        src = os.path.join(ROOT, 'design', theme, 'switch.mp3')
        dst = os.path.join(ROOT, 'public', 'themes', theme, 'switch.mp3')
        gain = LOUDNESS - loudness(exe, src)
        filters = f'atrim=0:{LENGTH},afade=t=out:st={LENGTH - FADE}:d={FADE},volume={gain:.2f}dB'
        subprocess.run([exe, '-v', 'error', '-y', '-i', src, '-af', filters, '-ac', '2', '-ar', '44100', '-b:a', '96k', '-map_metadata', '-1', dst], check=True)
        print(os.path.relpath(dst, ROOT), f'{gain:+.1f} dB', os.path.getsize(dst), 'bytes')


if __name__ == '__main__':
    main()
