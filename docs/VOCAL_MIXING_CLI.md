# Vocal mixing CLI

This experimental tool mixes an already separated vocal stem with a short procedural backing. It estimates BPM/key and optionally compares delivery/theme embeddings; it does not separate vocals or transcribe lyrics.

## Requirements

- Node.js 22+ and FFmpeg.
- A local Python environment with librosa, NumPy and the dependencies of a trusted Stem Splitter installation exposing `cli.py:analyze()`.
- For semantic comparisons, a Python environment with compatible PyTorch/SentenceTransformers and an already downloaded `google/embeddinggemma-2` checkpoint with audio weights. Use `--no-semantics` to skip this step.

Supply runtime/source/model paths explicitly; no other project's folders are searched or copied, and downloads are disabled during a run.

```sh
npm run vocalmix -- --help
npm run vocalmix -- "/path/to/vocals.mp3" \
  --python "/path/to/analysis-env/bin/python" \
  --stem-project "/path/to/Stem-Splitter" \
  --no-semantics --plan
npm run vocalmix -- "/path/to/vocals.mp3" \
  --python "/path/to/analysis-env/bin/python" \
  --stem-project "/path/to/Stem-Splitter" \
  --no-semantics --offset 30 --seconds 24 --output first-test
```

To enable embeddings, omit `--no-semantics` and add `--semantic-python "/path/to/semantic-env/bin/python"` and `--model-dir "/path/to/embeddinggemma-2"`. The default Python is `.venv/bin/python`; default semantic Python is the selected analysis Python, and default model folder is `models/embeddinggemma-2/`.

Each run creates `generated_beats/vocal-mixing/NAME/` containing `mix.mp3`, `analysis.json`, and `backing.score.json`. Existing run folders are protected. Excerpts are 4–60 seconds (default 24), retained output is limited to 5 MB per run, and decoded/rendered audio stays in memory. `--plan` checks paths/options and prints destinations without writing or loading models.

Use `--bpm 140 --key "F minor"` to override uncertain estimates; `--prompt` overrides the suggested backing style. `--vocal-db` and `--music-rms` control balance. The original vocal's timing and pitch are retained.

Model similarities and tempo/key estimates are experimental. Listen to assess alignment, harmony and balance. Reports include local file/model paths and should be reviewed before sharing.

Run `node --test test/vocal-mixing.test.js test/vocal-remix.test.js` for checks that do not load models.
