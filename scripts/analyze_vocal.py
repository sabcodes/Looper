"""Read an assumed vocal stem in place, reusing Stem Splitter's analysis."""
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import subprocess
import sys

for name in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'NUMBA_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS'):
    os.environ[name] = '2'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', type=Path, required=True)
    p.add_argument('--stem-project', type=Path, required=True)
    p.add_argument('--offset', type=float, required=True)
    p.add_argument('--seconds', type=float, required=True)
    args = p.parse_args()
    if not math.isfinite(args.offset) or args.offset < 0 or not 4 <= args.seconds <= 60:
        p.error('Use a finite nonnegative offset and 4–60 seconds.')
    import librosa
    import numpy as np

    source = args.stem_project / 'cli.py'
    sys.path.insert(0, str(args.stem_project))
    spec = importlib.util.spec_from_file_location('stem_analysis', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    print('Estimating BPM/key with existing Stem Splitter analyze()...', file=sys.stderr, flush=True)
    estimates = module.analyze(args.input)
    decoded = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-threads', '1',
        '-protocol_whitelist', 'file,pipe', '-ss', str(args.offset), '-i', str(args.input),
        '-t', str(args.seconds), '-map', '0:a:0', '-ac', '1', '-ar', '22050',
        '-f', 'f32le', 'pipe:1'], capture_output=True, check=True, timeout=90)
    signal = np.frombuffer(decoded.stdout, dtype='<f4').copy()
    if len(signal) < 4 * 22050 or not np.isfinite(signal).all() or np.max(np.abs(signal)) < 1e-5:
        raise ValueError('Select at least four seconds of non-silent finite audio with --offset/--seconds.')
    bpm = estimates['bpm']
    beats = []
    if isinstance(bpm, (int, float)) and math.isfinite(bpm) and bpm > 0:
        _, frames = librosa.beat.beat_track(y=signal, sr=22050, bpm=bpm)
        beats = (librosa.frames_to_time(frames, sr=22050) + args.offset).round(5).tolist()
    activity = librosa.effects.split(signal, top_db=30)
    report = {
        'version': 1, 'audio': str(args.input), 'assumed_vocal_stem': True,
        'source_sha256': hashlib.sha256(args.input.read_bytes()).hexdigest(),
        'reused_tool': {'source': str(source), 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                        'function': 'analyze', 'librosa_version': librosa.__version__},
        'tempo_and_key_estimates': estimates,
        'tempo_candidates_bpm': [round(bpm * f, 2) for f in (.5, 1, 2)] if bpm and math.isfinite(bpm) else [],
        'tempo_key_window': {'offset_seconds': 0, 'maximum_seconds': 120},
        'excerpt': {'offset_seconds': args.offset, 'duration_seconds': len(signal) / 22050},
        'estimated_beat_times_seconds': beats,
        'activity_regions': [{'start_seconds': round(args.offset + int(a) / 22050, 4),
                              'end_seconds': round(args.offset + int(b) / 22050, 4)} for a, b in activity],
        'caveats': ['Vocal-only tempo and key are estimates; half/double tempo and relative keys can be ambiguous.',
                    'Activity regions are energy measurements, not lyric words or verified vocal phrases.',
                    'Beat phase is inferred; downbeat, chord progression and original arrangement are unknown.']}
    print(json.dumps(report, allow_nan=False))


if __name__ == '__main__':
    main()
