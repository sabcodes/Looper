# Bass phrasing and varied-prompt development evaluation

The version-1.3 results below are historical structural diagnostics. Human listening found that their vague-prompt expectations were too weak. Version 1.4 strengthens those cases and adds contextual musical interpretation; see [the feedback and correction](INTERPRETATION_FEEDBACK.md).

Version 1.3 keeps the existing sound palette and separates bass tone from phrase shape. The user's preferred distorted dark analog synth is one useful sound; the other analog, metallic, FM, sub and pad voices remain available for different requests.

## Prompt controls

- `bouncy bass riff` / `rhythmic bass`: a four-bar cycle with short responses, gaps, accent changes and chord-tone movement.
- `call and response bass phrases`: longer calls alternating with shorter answers and pauses.
- `sustained bass`: retains held foundations. An explicit phrase request takes priority over sustained articulation.
- `bass throughout`: enables bass in every section. This describes presence across the arrangement; bouncing/call-response phrases can still contain deliberate rests.
- `no piano or lead or arpeggios`: propagates exclusions across the instrument list.
- `no keys`: removes harmony, lead and arpeggio voices while retaining melodic bass/log drums.
- `drums only`, `bass only`, `drums and sub only`, `no drums`, `no bass`: control musical roles. With no drum events, bass uses an independent phrase clock after consuming the empty kick array.

Negation uses a bounded grammar. A comma followed by a positive phrase, such as `no lead, bass between the kicks`, ends the exclusion. Unsupported language can still be missed. `no piano` substitutes pads only when the original harmonic voice was a piano; it preserves an existing non-piano synth-stab role.

`techno_rave` is separate from house: default 132 BPM, straight swing, downbeat kicks, a rolling bass ostinato and syncopated synth stabs. It reuses existing procedural synths and is a broad rave/techno approximation, not a catalog of historical substyles. Eight general techno examples extend the small classifier corpus to 112 examples across 14 intents. The 50 evaluation prompts are stored separately and are not training examples.

Keys accept spelled accidentals such as `in B flat major` as well as `in Bb major`. Classification records whether the primary style is explicit, inferred, or a default. Inferred/mixed interpretations are marked for review; TF-IDF similarities are not probabilities. Vague requests still often select house or synth-pop, so a mood word alone does not guarantee a distinctive arrangement.

## Controlled phrasing comparison

```sh
node scripts/compare-bass-phrasing.js
```

Three fresh numbered previews use the preferred B distorted analog recipe at 100 BPM, F minor, seed 202, sauce 0. Drums, chord progression, lowered chord register, quiet pad balance and stereo positions stay fixed. Bass note lengths, timing, accent velocities and response pitches vary. No DSP voice changes or reference audio sampling are involved.

The first set, `generated_beats/bass-phrasing-001.*`, measured -16.0/-16.2/-16.0 LUFS for held/bounce/response. Gate coverage was 100%/73%/75%; this measures scheduled note gates, not a listener's impression of sustain. The source reference analysis motivated breathing and contour rather than a purported note transcription. Each 16-second excerpt starts at bar 20. Full 32-bar scores, prompts, source identities and unfilled listening ratings are retained.

## The 50-case workflow

```sh
# Writes a fresh named structural report; labels do not overwrite previous reports.
node scripts/evaluate-varied-prompts.js my-run

# Writes only preview audio plus full scores, under a 40 MB batch cap.
node scripts/generate-varied-listening-set.js

# Optional analysis: use an existing Python environment containing the analysis libraries.
# PYTHON is the path to that environment's executable. No installs/downloads occur.
"$PYTHON" -B scripts/analyze-listening-set.py \
  --manifest generated_beats/varied-50-001.manifest.json --semantic
```

The fixture `data/varied-prompt-evaluation.json` contains 10 vague prompts, 10 sound descriptions, 14 named styles, 10 explicit constraint cases and 6 terse/negative cases. Examples range from a happy beach-day song to 90s techno with heavy subs and no piano. Seeds are 5000–5049, and the exact prompts/expectations are saved with each batch.

Each case gets a complete 32-bar score. The renderer synthesizes the full arrangement in memory and retains a 16-second MP3 excerpt from bar 20; it does not save 50 full audio tracks or intermediate WAVs. Full-track audio can be generated later using the saved prompt, seed and engine version. The manifest includes artifact/source hashes, interpreted parameters, individual checks, raw/encoded loudness, codec format and preview offsets. Distinct hashes prove different files, not perceptual diversity.

Preview gain uses attenuation toward -16 LUFS and retains at least 1 dB of encoded true-peak headroom. Transient-heavy clips may be quieter to preserve that headroom. The score files use `.score.json`, avoiding accidental full-score timing assumptions when a short clip is analyzed.

### Recorded development results

The baseline met expectations in 36/50 cases. Shared fixes addressed exclusion lists, instrument-only requests, spelled accidentals, descriptive vocabulary and techno/house separation. The resulting batch meets all **124 observable checks across 44 constrained cases**. Six open-ended cases have no fixed musical target and are not counted as semantic successes.

The first listening set contains 50 stereo 44.1-kHz, 192-kbps MP3 previews. Audio plus full scores occupy 29.52 MB, with a further small manifest/listening/diagnostic report overhead. Encoded loudness ranges from -17.8 to -16.0 LUFS; the highest true peak is -1.6 dBFS. All duration/format/silence/headroom checks passed. The retained set spans 14 selected intents and 15 bass profiles; those configuration counts do not certify audible genre separation.

This is a development discovery/regression set, not an unbiased held-out benchmark: it was used to find and fix parser gaps. `npm test` runs its event/settings assertions alongside the existing mathematical, deterministic render and export checks. Human prompt fit, groove, tone, usefulness and full-arrangement judgments remain open.

### Audio diagnostics and remaining listening priorities

The optional analyzer reuses the existing Stem Splitter `analyze()` function for tempo/key estimates, librosa/SciPy for spectral measurements, and the already cached CLAP model for semantic contrasts. The model loads once for all 50 clips. It does not become a generator dependency. All decoding and embedding audio stays in memory, all output/cache paths remain under `generated_beats/`, and model/network downloads are disabled.

Description version 3 adds a fourteenth techno comparison to the prior fixed descriptions. Per-case reports include genre ranks, mood/texture contrasts and an audio-similarity matrix. Only explicit genre requests receive requested-style ranks. Short full mixes, modal keys, half/double tempo errors and missing instruments can confound the estimates; ranks are not acceptance tests.

The first diagnostics flag these useful listening comparisons:

- Cases 01/08: happy beach day versus calm rainy evening. Both resolve to synth-pop, with very similar model embeddings. Mood/activity differentiation needs human review.
- Cases 06/28: warm nostalgic groove versus explicit 80s synth-pop. Shared sound recipes can be appropriate, but may still feel repetitive.
- Cases 24/44: amapiano with/without keys. Low diagnostic genre ranks suggest reviewing the log-drum/percussion identity; removing piano also makes a piano-heavy genre description less suitable.
- Case 26: baile funk. Review rhythmic identity and percussion color.
- Cases 20/40: industrial bass phrasing/tone. The user's listening preference takes priority over a model's genre label.

The listening index includes all audio, prompts, interpretations and full-score links. The review report lists the closest-sounding pairs and genre requests to inspect first. No automatic score is presented as proof that the 50 songs sound good or satisfy the user.

## Parallel vocals work

This work is on `sabcodex/phrasing-intent-evals`. The vocals implementation uses its separate `sabcodex/add-vocals` worktree. This change leaves vocal source files, vocal CLI options and the DSP implementation to that work. `src/composition.js` and README are shared integration points; combine their independent additions when the branches are integrated. Generated listening artifacts remain local and ignored by Git; the prompts, runners, tests and findings are versioned.
