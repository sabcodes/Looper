"""Optional analysis-only worker. Never imported by the Node generation engine."""
import os
for name in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS', 'NUMBA_NUM_THREADS'):
    os.environ[name] = '2'
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


def tempo_relation(estimate, expected):
    if not estimate or not expected:
        return None
    factor = min((.5, 1, 2), key=lambda f: abs(estimate * f - expected))
    error = abs(estimate * factor - expected) / expected
    return {'expected_bpm': expected, 'raw_estimate_bpm': estimate, 'candidate_multiplier': factor,
            'adjusted_candidate_bpm': estimate * factor, 'relative_error': error,
            'within_three_percent_allowing_half_double': error <= .03,
            'note': 'Half/double candidates are diagnostic; the raw estimate is unchanged.'}


def loudness(path):
    proc = subprocess.run(['ffmpeg', '-nostdin', '-protocol_whitelist', 'file,pipe', '-hide_banner', '-nostats', '-loglevel', 'info', '-threads', '1',
        '-i', str(path), '-af', 'ebur128=framelog=verbose:peak=true', '-f', 'null', '-'],
        capture_output=True, text=True, timeout=120)
    if proc.returncode:
        return {'error': proc.stderr[-1000:]}
    result = {}
    for name, pattern in [('integrated_lufs', r'I:\s+(-?[\d.]+) LUFS'),
                          ('loudness_range_lu', r'LRA:\s+([\d.]+) LU'),
                          ('true_peak_dbfs', r'Peak:\s+(-?[\d.]+) dBFS')]:
        matches = re.findall(pattern, proc.stderr)
        if matches:
            result[name] = float(matches[-1])
    return result


def semantic_probe(path, model_dir, offset, seconds, expected):
    import numpy as np
    import torch
    from transformers import ClapModel, ClapProcessor
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    torch.manual_seed(0)
    np.random.seed(0)
    marker = model_dir / '.ready'
    if not marker.is_file():
        raise ValueError('Use an already prepared CLAP model directory; downloads are disabled.')
    manifest = json.loads(marker.read_text())
    if manifest.get('repository') != 'laion/clap-htsat-unfused' or manifest.get('dimension') != 512:
        raise ValueError('The cached model does not match the prepared CLAP contract.')
    definitions = json.loads((ROOT / 'data/analysis-descriptions.json').read_text())
    labels = list(definitions['genres']) + list(definitions['moods'])
    texts = list(definitions['genres'].values()) + list(definitions['moods'].values())
    for contrast in definitions.get('sound_contrasts', []):
        labels.extend([contrast['id'] + '_a', contrast['id'] + '_b'])
        texts.extend([contrast['a'], contrast['b']])
    if expected:
        labels.append('original_prompt'); texts.append(expected['prompt'])
    decoded = subprocess.run(['ffmpeg', '-nostdin', '-protocol_whitelist', 'file,pipe', '-v', 'error', '-threads', '1', '-filter_threads', '1',
        '-ss', str(offset), '-i', str(path), '-t', str(seconds), '-ac', '1', '-ar', '48000',
        '-f', 'f32le', 'pipe:1'], capture_output=True, timeout=90, check=True)
    audio = np.frombuffer(decoded.stdout, dtype='<f4').copy()
    if not audio.size or not np.isfinite(audio).all():
        raise ValueError('No valid audio in the selected semantic excerpt.')
    # Reuse the existing checkpoint and its documented 10 s / 48 kHz processor
    # contract, without opening Searcher's SQLite database or copying weights.
    processor = ClapProcessor.from_pretrained(model_dir, local_files_only=True)
    model = ClapModel.from_pretrained(model_dir, local_files_only=True, use_safetensors=False, weights_only=True).eval()
    with torch.inference_mode():
        inputs = processor(audio=[audio], sampling_rate=48000, return_tensors='pt', padding='repeatpad', truncation='rand_trunc')
        av = model.get_audio_features(**inputs)[0]
        av = av / av.norm()
        similarities = []
        for i in range(0, len(texts), 4):
            inputs = processor(text=texts[i:i + 4], return_tensors='pt', padding=True, truncation=True)
            tv = model.get_text_features(**inputs)
            tv = tv / tv.norm(dim=-1, keepdim=True)
            similarities.extend((tv @ av).cpu().tolist())
    scores = dict(zip(labels, similarities))
    ranking = sorted([{'intent': label, 'cosine': scores[label]} for label in definitions['genres']], key=lambda r: -r['cosine'])
    rank = next((i + 1 for i, row in enumerate(ranking) if expected and row['intent'] == expected['intent']), None)
    return {'model': manifest, 'description_version': definitions['version'],
            'descriptions_sha256': hashlib.sha256((ROOT / 'data/analysis-descriptions.json').read_bytes()).hexdigest(),
            'excerpt': {'offset_seconds': offset, 'duration_seconds': len(audio) / 48000},
            'genre_ranking': ranking, 'requested_intent_rank': rank,
            'mood_cosines': {label: scores[label] for label in definitions['moods']},
            'sound_contrasts': [{**c, 'a_cosine': scores[c['id'] + '_a'], 'b_cosine': scores[c['id'] + '_b'],
                                 'a_minus_b': scores[c['id'] + '_a'] - scores[c['id'] + '_b']}
                                for c in definitions.get('sound_contrasts', [])],
            'original_prompt_cosine': scores.get('original_prompt'),
            'interpretation': 'Relative cosine ranking within fixed descriptions, not a probability, genre ground truth or listening-quality verdict.'}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', type=Path, required=True)
    p.add_argument('--score', type=Path)
    p.add_argument('--stem-project', type=Path)
    p.add_argument('--semantic', action='store_true')
    p.add_argument('--deconstruct', action='store_true')
    p.add_argument('--checkpoint-dir', type=Path)
    p.add_argument('--export-stems', type=Path)
    p.add_argument('--model-dir', type=Path)
    p.add_argument('--offset', type=float)
    p.add_argument('--seconds', type=float, default=10)
    args = p.parse_args()
    if args.deconstruct:
        from deconstruct_audio import deconstruct

        if args.checkpoint_dir is None or args.semantic:
            p.error('Deconstruction requires a local checkpoint directory and runs separately from semantic analysis.')
        began = time.perf_counter()
        report = deconstruct(args.input, 0 if args.offset is None else args.offset, args.seconds,
                             args.checkpoint_dir, args.export_stems)
        report['elapsed_seconds'] = time.perf_counter() - began
        print(json.dumps(report, indent=2, allow_nan=False))
        return
    if args.stem_project is None:
        p.error('Classical analysis requires the existing Stem Splitter project path.')
    if not math.isfinite(args.seconds) or not 1 <= args.seconds <= 10:
        raise ValueError('Analysis excerpt length must be 1–10 seconds.')
    began = time.perf_counter()
    import librosa
    import numpy as np
    import psutil
    from scipy.signal import welch
    expected = json.loads(args.score.read_text())['config'] if args.score else None
    offset = args.offset if args.offset is not None else (20 * expected.get('beatsPerBar', 4) * 60 / expected['bpm'] if expected else 0)
    if not math.isfinite(offset) or offset < 0:
        raise ValueError('Excerpt offset must be a finite nonnegative number.')
    source = args.stem_project / 'cli.py'
    spec = importlib.util.spec_from_file_location('reused_stem_analysis', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    base = module.analyze(args.input)
    signal, sr = librosa.load(str(args.input), mono=True, sr=22050, duration=120)
    if not signal.size or not np.isfinite(signal).all():
        raise ValueError('Cannot analyze empty or nonfinite audio.')
    energy = float(np.mean(signal ** 2))
    chroma = librosa.feature.chroma_stft(y=signal, sr=sr).mean(axis=1)
    profiles = [('major', [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88]),
                ('minor', [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17])]
    key_candidates = []
    for pc, name in enumerate(['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']):
        for mode, profile in profiles:
            correlation = float(np.corrcoef(np.roll(chroma, -pc), profile)[0, 1]) if np.std(chroma) > 1e-8 else 0.
            key_candidates.append({'root': pc, 'mode': mode, 'key': name + ' ' + mode, 'correlation': correlation})
    key_candidates.sort(key=lambda row: -row['correlation'])
    freq, power = welch(signal, fs=sr, nperseg=min(8192, len(signal)))
    bands = {}
    for name, lo, hi in [('sub',20,80),('low',80,250),('mid',250,2000),('high',2000,10000)]:
        bands[name] = float(np.sum(power[(freq >= lo) & (freq < hi)]) / max(1e-12, np.sum(power)))
    sections = []
    if expected:
        sections_spec = json.loads(args.score.read_text())['sections']
        for section in sections_spec:
            start = section.get('startTime', section['start'] * expected.get('beatsPerBar', 4) * 60 / expected['bpm']); end = section.get('endTime', section['end'] * expected.get('beatsPerBar', 4) * 60 / expected['bpm'])
            clip = signal[round(start * sr):min(len(signal), round(end * sr))]
            sections.append({'name': section['name'], 'start_seconds': start, 'end_seconds': min(end, len(signal) / sr),
                             'rms_dbfs': float(10 * np.log10(max(1e-12, np.mean(clip ** 2)))) if clip.size else None})
    report = {
      'analysis_version': 1, 'audio': str(args.input.resolve()),
      'source_sha256': hashlib.sha256(args.input.read_bytes()).hexdigest(),
      'expected': expected,
      'reused_tool': {'source': str(source), 'function': 'analyze', 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()},
      'versions': {'librosa': librosa.__version__, 'numpy': np.__version__},
      'analysis_window_seconds': len(signal) / sr,
      'tempo_and_key_estimates': base,
      'tempo_comparison': tempo_relation(base['bpm'], expected['bpm'] if expected else None),
      'key_candidates': key_candidates[:5],
      'key_margin': key_candidates[0]['correlation'] - key_candidates[1]['correlation'],
      'rms_dbfs_mono': 10 * math.log10(max(1e-12, energy)),
      'spectral_centroid_hz': float(librosa.feature.spectral_centroid(y=signal, sr=sr).mean()),
      'spectral_band_power_fraction': bands,
      'section_energy': sections,
      'loudness': loudness(args.input),
      'caveats': ['Tempo may be half/double the intended pulse.',
                  'Major/minor correlation templates cannot validate every modal scale; relative keys can be ambiguous.',
                  'Model similarity does not establish musical quality or human prompt satisfaction.'],
    }
    if args.semantic:
        if args.model_dir is None:
            raise ValueError('Semantic analysis requires an existing model directory.')
        report['semantic'] = semantic_probe(args.input, args.model_dir, offset, args.seconds, expected)
    report['elapsed_seconds'] = time.perf_counter() - began
    report['rss_mb_at_completion'] = psutil.Process().memory_info().rss / 1024**2
    # Standard output is reserved for the Node caller's JSON protocol.
    print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
