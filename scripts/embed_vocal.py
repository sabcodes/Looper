"""EmbeddingGemma 2 audio/text comparisons; no transcription or downloads."""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

for name in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS'):
    os.environ[name] = '2'
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
                  HF_HUB_DISABLE_IMPLICIT_TOKEN='1', HF_HUB_DISABLE_PROGRESS_BARS='1',
                  TORCH_DEVICE_BACKEND_AUTOLOAD='0', TOKENIZERS_PARALLELISM='false')


def rank(labels, scores):
    return sorted([{'label': label, 'cosine': float(score)} for label, score in zip(labels, scores)],
                  key=lambda row: -row['cosine'])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', type=Path, required=True)
    p.add_argument('--model-dir', type=Path, required=True)
    p.add_argument('--offset', type=float, required=True)
    p.add_argument('--seconds', type=float, required=True)
    args = p.parse_args()
    if not 4 <= args.seconds <= 60 or not 0 <= args.offset < float('inf'):
        p.error('Use a finite nonnegative offset and 4–60 seconds.')
    config = json.loads((args.model_dir / 'config.json').read_text())
    if config.get('model_type') != 'embedding_gemma2' or not config.get('audio_config'):
        raise ValueError('Supply an existing EmbeddingGemma 2 checkpoint with audio weights; downloads are disabled.')
    definitions_path = Path(__file__).resolve().parents[1] / 'data/vocal-mixing-descriptions.json'
    definitions = json.loads(definitions_path.read_text())
    import numpy as np
    import torch
    from sentence_transformers import SentenceTransformer

    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    torch.manual_seed(0)
    print('Loading existing EmbeddingGemma 2 text/audio checkpoint on CPU...', file=sys.stderr, flush=True)
    with contextlib.redirect_stdout(sys.stderr), torch.inference_mode():
        model = SentenceTransformer(str(args.model_dir), device='cpu', local_files_only=True,
            token=False, trust_remote_code=False, config_kwargs={'vision_config': None},
            model_kwargs={'dtype': torch.float32})
        model.eval()
        if model[0].model.audio_tower is None:
            raise ValueError('Existing checkpoint did not load an audio encoder.')
        texts = [text for group in ('delivery', 'themes') for text in definitions[group].values()]
        vectors = model.encode(texts, prompt_name='Classification', batch_size=1,
                               normalize_embeddings=True, show_progress_bar=False)
        # Three bounded 8-second windows cover the selected preview without retaining decoded media.
        width = min(8, args.seconds)
        starts = sorted(set([0., (args.seconds - width) / 2, args.seconds - width]))
        rows = []
        for index, start in enumerate(starts):
            print(f'Embedding vocal window {index + 1}/{len(starts)}...', file=sys.stderr, flush=True)
            decoded = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-threads', '1',
                '-protocol_whitelist', 'file,pipe', '-ss', str(args.offset + start), '-i', str(args.input),
                '-t', str(width), '-ac', '1', '-ar', '16000', '-map', '0:a:0', '-f', 'f32le', 'pipe:1'],
                capture_output=True, check=True, timeout=60)
            audio = np.frombuffer(decoded.stdout, dtype='<f4').copy()
            if len(audio) < 16000 or not np.isfinite(audio).all():
                raise ValueError('Semantic window contains insufficient or invalid audio.')
            if np.max(np.abs(audio)) < 1e-5:
                continue
            vector = model.encode({'audio': {'array': audio, 'sampling_rate': 16000}},
                                  prompt='', batch_size=1, normalize_embeddings=True, show_progress_bar=False)
            if vector.shape != (768,) or not np.isfinite(vector).all():
                raise ValueError('Expected one finite 768-dimensional audio embedding.')
            scores = vectors @ vector
            split = len(definitions['delivery'])
            rows.append({'offset_seconds': args.offset + start, 'duration_seconds': len(audio) / 16000,
                         'delivery': rank(definitions['delivery'], scores[:split]),
                         'themes': rank(definitions['themes'], scores[split:])})
    if not rows:
        raise ValueError('No audible semantic windows; choose another excerpt.')
    aggregate = {}
    for group in ('delivery', 'themes'):
        labels = list(definitions[group])
        aggregate[group] = rank(labels, [np.mean([next(r['cosine'] for r in row[group] if r['label'] == label)
                                                  for row in rows]) for label in labels])
    print(json.dumps({'model': 'google/embeddinggemma-2', 'model_directory': str(args.model_dir),
        'descriptions_version': definitions['version'],
        'descriptions_sha256': hashlib.sha256(definitions_path.read_bytes()).hexdigest(),
        'device': 'cpu', 'dtype': 'float32', 'audio_encoder_loaded': True,
        'transcript': None, 'windows': rows, **aggregate,
        'interpretation': 'Relative similarities to fixed descriptions; uncalibrated and experimental. '
                          'Theme rankings can reflect delivery/timbre and do not establish the words or meaning of the lyrics.'},
        allow_nan=False))


if __name__ == '__main__':
    main()
