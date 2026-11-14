"""Local four-stem estimates and timing analysis for finished audio."""
from fractions import Fraction
from importlib.metadata import version
import math
import os
import subprocess

from study_references import digest, frame_rms

MODEL_FILE = '955717e8-8726e21a.th'
MODEL_SHA256 = '8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4'
RATE = 44100
SOURCES = ('drums', 'bass', 'other', 'vocals')


def read_excerpt(path, offset, seconds):
    import numpy as np

    if not path.is_file() or not math.isfinite(offset) or offset < 0 or not 1 <= seconds <= 60:
        raise ValueError('Supply a local audio file, nonnegative offset and a 1–60 second excerpt.')
    decoded = subprocess.run([
        'ffmpeg', '-nostdin', '-v', 'error', '-threads', '1', '-protocol_whitelist', 'file,pipe',
        '-ss', str(offset), '-i', str(path), '-t', str(seconds), '-map', '0:a:0',
        '-ac', '2', '-ar', str(RATE), '-f', 'f32le', 'pipe:1',
    ], capture_output=True, timeout=60, check=True)
    mix = np.frombuffer(decoded.stdout, dtype='<f4').reshape(-1, 2).T.copy()
    if not RATE <= mix.shape[1] <= round(seconds * RATE) + 1 or not np.isfinite(mix).all():
        raise ValueError('The selected window must contain at least one second of finite audio.')
    return mix


def separate(mix, checkpoint_dir):
    import numpy as np

    checkpoint = checkpoint_dir / MODEL_FILE
    if not checkpoint.is_file():
        raise ValueError(f'Cached htdemucs checkpoint missing at {checkpoint}; downloads are disabled.')
    if digest(checkpoint) != MODEL_SHA256:
        raise ValueError('Cached htdemucs checkpoint failed its SHA-256 check.')
    os.environ['TORCH_DEVICE_BACKEND_AUTOLOAD'] = '0'
    import torch
    from demucs.apply import apply_model
    from demucs.htdemucs import HTDemucs
    from demucs.states import load_model

    torch.set_num_threads(2)
    scalar = np.core.multiarray.scalar
    # Older PyTorch only accepts objects. NumPy 2 moved this pickle global.
    scalar_global = scalar if scalar.__module__ == 'numpy.core.multiarray' else (scalar, 'numpy.core.multiarray.scalar')
    allowed = [HTDemucs, Fraction, scalar_global, np.dtype, type(np.dtype(np.float64)), type(np.dtype(np.float32))]
    with torch.serialization.safe_globals(allowed):
        package = torch.load(checkpoint, map_location='cpu', weights_only=True)
    model = load_model(package).eval()
    if model.samplerate != RATE or model.audio_channels != 2 or set(model.sources) != set(SOURCES):
        raise ValueError('Cached model does not match the four-stem audio contract.')

    waveform = torch.from_numpy(mix)
    mean = waveform.mean()
    scale = waveform.std().clamp_min(1e-5)
    with torch.inference_mode():
        estimates = apply_model(model, ((waveform - mean) / scale)[None], shifts=0, split=True)[0]
        # Distribute the removed DC offset once across the sources.
        estimates = (estimates * scale + mean / len(SOURCES)).numpy()
    if estimates.shape != (len(SOURCES), *mix.shape) or not np.isfinite(estimates).all():
        raise ValueError('Demucs returned invalid audio.')
    return dict(zip(model.sources, estimates))


def analysis_signal(stereo):
    from scipy.signal import resample_poly

    return resample_poly(stereo.mean(axis=0), 1, 4)


def beat_grid(drums, offset):
    import librosa
    import numpy as np

    rate, hop = RATE // 4, 128
    if np.max(np.abs(drums)) < 1e-5:
        return {'bpm': None, 'times_seconds': []}
    onset = librosa.onset.onset_strength(y=drums, sr=rate, hop_length=hop, n_fft=512)
    _, frames = librosa.beat.beat_track(onset_envelope=onset, sr=rate, hop_length=hop, trim=True)
    times = librosa.frames_to_time(frames, sr=rate, hop_length=hop)
    bpm = round(60 / float(np.median(np.diff(times))), 2) if len(times) >= 3 else None
    return {'bpm': bpm, 'times_seconds': (times + offset).round(4).tolist()}


def bass_phrases(bass, offset):
    import librosa
    import numpy as np

    rate, hop, width = RATE // 4, 128, 2048
    if np.max(np.abs(bass)) < 1e-5:
        return []
    f0, voiced, probability = librosa.pyin(
        bass, sr=rate, frame_length=width, hop_length=hop,
        fmin=25, fmax=260, n_thresholds=50, resolution=.2,
    )
    envelope = frame_rms(bass, rate, hop)[:len(f0)]
    active = envelope > max(1e-5, float(np.quantile(envelope, .95)) * .1)
    reliable = voiced & np.isfinite(f0) & (probability >= .15) & active
    midi = np.full(len(f0), -1, dtype=int)
    midi[reliable] = np.rint(librosa.hz_to_midi(f0[reliable])).astype(int)
    edges = np.r_[0, np.flatnonzero(np.diff(midi)) + 1, len(midi)]
    regions = []
    for start, end in zip(edges[:-1], edges[1:]):
        duration = min(len(bass) / rate, end * hop / rate) - start * hop / rate
        if midi[start] >= 0 and duration >= .09:
            regions.append({
                'start_seconds': round(offset + start * hop / rate, 4),
                'duration_seconds': round(duration, 4),
                'midi': int(midi[start]),
                'voicing_probability': round(float(np.median(probability[start:end])), 3),
            })
    return regions


def activity_and_changes(stems, offset):
    import numpy as np
    from scipy.signal import find_peaks

    frames = stems['drums'].shape[1]
    bounds = list(range(0, frames, RATE)) + [frames]
    levels = np.array([
        [np.sqrt(np.mean(stems[name][:, start:end] ** 2, dtype=np.float64)) for name in SOURCES]
        for start, end in zip(bounds[:-1], bounds[1:])
    ])
    strongest = max(1e-8, float(levels.max()))
    thresholds = np.maximum(levels.max(axis=0) * .15, strongest * .045)
    windows = [
        {
            'start_seconds': round(offset + bounds[i] / RATE, 4),
            'end_seconds': round(offset + bounds[i + 1] / RATE, 4),
            'rms_dbfs': dict(zip(SOURCES, (20 * np.log10(np.maximum(row, 1e-8))).round(1).tolist())),
            'active': [name for name, active in zip(SOURCES, row > thresholds) if active],
        }
        for i, row in enumerate(levels)
    ]
    # Compare two seconds on either side to avoid labelling every fill a new section.
    novelty = np.zeros(len(levels))
    for i in range(2, len(levels) - 1):
        difference = levels[i:i + 2].mean(axis=0) - levels[i - 2:i].mean(axis=0)
        novelty[i] = np.linalg.norm(difference) / strongest
    peaks, _ = find_peaks(novelty, height=.24, prominence=.12, distance=3)
    changes = [{'time_seconds': windows[i]['start_seconds'], 'strength': round(float(novelty[i]), 3)} for i in peaks]
    return windows, changes


def deconstruct(path, offset, seconds, checkpoint_dir, export_dir=None):
    import numpy as np

    mix = read_excerpt(path, offset, seconds)
    stems = separate(mix, checkpoint_dir)
    windows, changes = activity_and_changes(stems, offset)
    report = {
        'deconstruction_version': 1,
        'audio': str(path.resolve()),
        'excerpt': {'start_seconds': offset, 'duration_seconds': mix.shape[1] / RATE, 'sample_rate': RATE},
        'separator': {'model': 'htdemucs', 'package_version': version('demucs'), 'checkpoint_sha256': MODEL_SHA256},
        'sources': list(SOURCES),
        'beat_grid': beat_grid(analysis_signal(stems['drums']), offset),
        'bass_pitch_regions': bass_phrases(analysis_signal(stems['bass']), offset),
        'part_activity': windows,
        'section_change_candidates': changes,
        'caveats': [
            'Four estimated sources can contain bleed, missed sounds or separation artifacts.',
            'Beat times estimate pulse. Downbeats, meter and half/double-time interpretation need review.',
            'Bass regions estimate stable pitch. They can miss attacks, merge repeated notes or select the wrong octave.',
            'Section candidates mark sustained changes in part energy. Times are on a one-second grid.',
        ],
    }
    if export_dir is not None:
        import soundfile

        peak = max(float(np.abs(stem).max()) for stem in stems.values())
        gain = min(1., .98 / peak) if peak else 1.
        for name, stem in stems.items():
            soundfile.write(export_dir / (name + '.flac'), stem.T * gain, RATE, subtype='PCM_16')
        report['export_gain'] = gain
    return report
