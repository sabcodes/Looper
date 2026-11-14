# Reference audio analysis

Reference audio is read in place. Private file paths, recordings, excerpts, embeddings, raw measurements and listening records belong under ignored `generated_beats/`. Keep the procedural Node.js generation runtime independent of optional analysis environments and models.

## Run

Prepare a private input manifest under `generated_beats/`:

```json
{
  "version": 1,
  "entries": [
    {"id": "reference-one", "label": "Reference one", "source": "/path/to/reference.wav", "kind": "reference"}
  ]
}
```

Using an existing Python environment with librosa, NumPy, SciPy and optionally the already cached CLAP checkpoint:

```sh
/path/to/existing/python -B scripts/study_references.py --manifest generated_beats/my-inputs.json --output my-study.json
# Add --semantic for cached local CLAP comparisons; no model downloads occur.
node scripts/export-reference-excerpts.js --report generated_beats/my-study.json --prefix my-study
```

The study scans up to 180 seconds of each file at reduced resolution. It ranks 16-second windows on a four-second grid using low-band energy, activity and envelope floor. It records the selected passage plus alternatives, source identity, sample metadata, method versions and elapsed/memory measurements. Selection is an automated proposal; the user can specify preferred timestamps.

The exporter reads the original passage again, applies attenuation before encoding, measures the encoded excerpt, and adjusts from the original if necessary to match audition loudness. It never substitutes an attenuated intermediate recording as the new source. Use a fresh prefix; `--force` explicitly allows replacing previously exported excerpts under that prefix. Original source files are never output destinations.

## Analyze generated audio

Ordinary analysis requires a Python environment with librosa, NumPy, SciPy and psutil, plus a trusted local Stem Splitter project exposing `cli.py:analyze()`:

```sh
node bin/analyzebeats.js generated_beats/track.wav --python /path/to/analysis-env/bin/python --stem-project /path/to/Stem-Splitter
```

For optional CLAP comparisons, add `--semantic --model-dir /path/to/prepared-clap`. This requires compatible PyTorch/Transformers and a local `laion/clap-htsat-unfused` checkpoint with a `.ready` JSON manifest containing `repository: "laion/clap-htsat-unfused"` and `dimension: 512`. The default model directory is `models/clap/`. No weights or runtimes are downloaded automatically. The reference-study `--semantic` mode uses the same default directory.

## Deconstruct a local mix

Use the separate analysis mode for a finished local audio file:

```sh
node bin/analyzebeats.js /path/to/reference.mp3 --python /path/to/analysis-env/bin/python --deconstruct
node bin/analyzebeats.js /path/to/reference.mp3 --python /path/to/analysis-env/bin/python --deconstruct --offset 30 --seconds 15 --stems
```

The report includes the estimated pulse, bass pitch regions with voicing
probabilities, activity by part in one-second windows, and candidate section
changes. Times are relative to the source file, including when using an
offset. An adjacent Looper score is summarized separately when available.
It does not guide the estimates.

This mode reads up to 60 seconds at a time and uses an existing Python
environment with PyTorch, Demucs, librosa, SciPy and SoundFile. It looks for
an explicitly selected Python runtime and the cached four-part htdemucs checkpoint
`955717e8-8726e21a.th`. Use `--python` and `--checkpoint-dir` for other
existing locations. Model integrity is checked before loading.

Add `--stems` to save drums, bass, vocals and other as time-aligned stereo
FLAC files in a new folder under `generated_beats/`. The files share one
gain to retain their relative levels. Source leakage can affect every
estimate, particularly quiet parts, fast bass notes and material that
falls between instrument categories. Section candidates are sustained
changes in level, and the beat grid can be offset or half/double-time.

### Calibration with Looper scores

Two new 16-bar instrumental mixes were passed to the separator without
their scores. Estimated bass pitch was compared at the center of each
score note. Beat timing was measured against the closest score beat.

| Generated fixture | Score / estimated BPM | Median beat error | Bass pitch matches | Section changes within one second |
| --- | ---: | ---: | ---: | ---: |
| Deep house (seed 167) | 120 / 120.19 | 16.3 ms | 32 / 32 | 5 / 5 |
| Synth-pop (seed 238) | 108 / 107.67 | 14.7 ms | 62 / 64 | 5 / 5 |

Each run returned 48 beat times for a 64-beat score. All returned times
were within 70 ms of the score grid. The drums, bass and other estimates
improved by 14.2–28.2 dB in scale-invariant signal-to-distortion ratio
compared with using the whole mix as each source. These fixtures measure
performance on generated music. Vocal isolation and accuracy on outside
recordings remain unmeasured.

## Interpretation

Harmonic/percussive separation supplies tonal/percussive regions of a mixture, not isolated bass and kick stems. Low-band pitch estimates can be affected by distortion, overlapping instruments, voicing gaps and octave ambiguity. Treat stable pitch regions as diagnostic, not a note-length transcription.

Calibration against a generated example found 66 low-tonal spectral-flux peaks despite only four known bass-note starts. Those peaks include modulation, ducking and changing harmonics. The report therefore calls them **flux peaks** and explicitly rejects treating them as note attacks, exact syncopation, swing or kick/bass timing. A test verifies simple window-selection and grid-summary behavior, while the real generated baseline tests the interpretation's limits.

Cached CLAP compares fixed descriptions and full-mix embeddings. It cannot establish a true source instrument, user preference or bass-only similarity. Differences in vocals and other layers are confounds. Retain scores and alternatives without turning them into a musical pass/fail label.

## Design use

Retain a palette of useful sound families for different vibes and intents. A preference within a particular comparison is scoped to those examples. Reference studies can motivate new optional controls—such as held foundations with shorter responses, brief spaces, pitch movement, and separate clean-sub/harmonic-body balance—but changes need listening comparisons with the timbre and loudness controlled.

## Verify

```sh
npm test
python3 -B test/analysis_checks.py
/path/to/existing/python -B test/reference_checks.py
```

The last check needs NumPy/SciPy from the existing music-analysis runtime. No installation or model acquisition is part of the tests. Audio/reference data is not required for the core Node checks or the standard-library analysis checks.
