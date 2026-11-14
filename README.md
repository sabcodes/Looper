# Looper

Looper turns text prompts into repeatable beats and instrumental tracks, with a desktop editor and command-line tools. It uses JavaScript/Node.js for procedural audio synthesis, Electron for the UI, and optional Python/MLX tools for local model assistance.

## Requirements

- **Node.js 22+** and npm to run from source; Git to clone the repo.
- **FFmpeg** on your PATH for MP3/FLAC export and vocals. Instrumental WAV generation needs only Node.js.
- Optional local LLM: an **Apple silicon Mac**, Python 3.10+, MLX-VLM and the model described below.

## Download and start

For the standalone macOS UI, download the ZIP matching your Mac from [Releases](https://github.com/sabcodes/Looper/releases), unzip it, and open Looper. It includes its own runtime and asks where to save your beats. Current beta builds are ad-hoc signed and not Apple notarized.

To run from source, clone the repo or choose **Code → Download ZIP** on GitHub:

```sh
git clone https://github.com/sabcodes/Looper.git
cd Looper
```

Start the UI:

```sh
mkdir -p .cache/tmp
electron_config_cache="$PWD/.cache/electron" TMPDIR="$PWD/.cache/tmp" npm ci --cache .cache/npm
npm run desktop
```

Enter a prompt, inspect the arrangement, then generate. Open a saved score to edit notes, audition parts, or make seeded variations.

## CLI

Generate a WAV and score without installing npm dependencies:

```sh
node bin/makebeats.js "warm deep house in F minor at 124bpm, 8 bars" --format wav --seed 42 --json
node bin/makebeats.js --help
```

Outputs go in `generated_beats/`. Existing files are protected; use a new `--output NAME` or explicitly pass `--force` to replace them. MP3 is the CLI default and requires FFmpeg.

Optional analysis and vocal-mixing tools reuse separately installed Python dependencies and local models:

```sh
node bin/analyzebeats.js --help
npm run vocalmix -- --help
```

See [audio analysis](docs/REFERENCE_ANALYSIS.md) and [vocal mixing](docs/VOCAL_MIXING_CLI.md) for their required runtimes and flags.

## Load a local LLM (optional)

The supported desktop bridge uses [Liquid LFM3-1.7B-MLX-4bit](https://huggingface.co/LiquidAI/LFM3-1.7B-MLX-4bit) with MLX-VLM 0.7.11+. Basic beat generation works without it; the model helps **Suggest direction** and unfamiliar part-edit prompts. GGUF files and Ollama endpoints are not supported by this bridge.

For a new setup, these commands create a local Python environment and download the model (about 1 GB of weights, plus runtime dependencies and download cache). Skip them if you already have a compatible environment and model:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install "mlx-vlm>=0.7.11" huggingface_hub
HF_HOME="$PWD/.cache/huggingface" .venv/bin/hf download LiquidAI/LFM3-1.7B-MLX-4bit --local-dir models/LFM3-1.7B-MLX-4bit
```

Point Looper at the installed Python and complete model folder, then start the UI from the same terminal:

```sh
export LOOPER_LIQUID_PYTHON="$PWD/.venv/bin/python"
export LOOPER_LIQUID_MODEL="$PWD/models/LFM3-1.7B-MLX-4bit"
npm run desktop
```

Both values must be absolute paths. For an existing installation, use its paths instead. Looper loads the model on demand, runs inference locally, and does not download models automatically. Model weights have their own [license](https://huggingface.co/LiquidAI/LFM3-1.7B-MLX-4bit); they are not included in this repo.

## More

[Engine controls](docs/EXPANSION.md) · [Sound and tuning](docs/SOUND_MATH.md) · [Spoken vocals](docs/vocals.md)

Run `npm test` and `python3 -B test/analysis_checks.py` to check the source. See [SECURITY.md](SECURITY.md) for reporting a vulnerability.

Code is licensed under [MIT](LICENSE). Dependencies and optional models retain their own licenses.
