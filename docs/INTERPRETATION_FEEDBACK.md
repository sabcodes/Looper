# Context interpretation after human listening

The first 50-case listening set had a real interpretation defect. Dark driving music and reading/relaxation both became bright-house recipes, vague activity prompts converged on house/synth-pop, and more descriptive dark techno kept the same basic synth/chord recipe. Its structural checks missed these problems because vague cases had almost no musical expectations. Passing those checks did not validate the interpretations.

## Reproduced causes

Five original feedback tests failed before the fix. Minimal probes showed `relax read` had no useful classifier features, `bounce` had relevant evidence below a threshold that discarded it in favor of house, and `dark heavy techno` retained the ordinary rolling-saw bass and chord register. Mood mainly affected scale, with little connection to instrumental roles, register or arrangement.

Version 1.4 adds `src/intent-context.js`, a small offline semantic dictionary combining activity, energy, atmosphere, groove and instrumental cues. Reading plus relaxation, for example, favors quiet jazz/piano; night plus driving favors darker bass-led electronics. The rules match concepts and combinations, not complete evaluation prompt strings. Stop words no longer dominate TF-IDF features. Original corpus examples remain separate from evaluation prompts.

Explicit named styles retain priority. Close contextual alternatives can vary with the supplied seed; the same prompt, seed and version replay exactly. Classification records matched cue evidence, component scores and alternatives. Scores are not probabilities. Unsupported wording can still be missed: this is a bounded deterministic compiler, not general language reasoning. Unknown input uses `neutral_groove` and reports its style as unresolved, rather than declaring bright house.

## Musical changes reach the score

Context now affects tempo defaults, event density, bass voice/emphasis, harmonic register, chord patterns, dynamics and default lead/arpeggio roles. Explicit BPM/key/mode, instruments and exclusions retain their overrides. Genre tempo ranges constrain inferred tempos; an explicit BPM can override the range.

New `jazz_lounge` and `classical_minimal` presets reuse the existing procedural voices. Jazz adds seventh-chord comping, walking bass and softer drums. Quiet piano uses broken-chord figures with left-hand notes and omits a drum kit/sub by default. These are simple procedural approximations; the FM piano voice is not a sampled acoustic piano or a claim of authentic classical performance.

Dark-heavy techno selects a darker distorted bass voice with longer phrases, lower harmonic notes, quieter chords and a sparser pattern. Ordinary heavy rave bass can retain its rolling articulation with a Reese texture. These changes produce different note/voice/mix data even when both requests correctly belong to techno.

Bass-specific instructions stay scoped: `bouncy bass riff` changes bass phrasing without changing the track's tempo or drums. A separate regression caught and fixed that interaction while developing the context rules.

## Same prompts and seeds, revised examples

The first correction set is `generated_beats/context-review-001.*`. It preserves the original clips and generates ten new 16-second excerpts plus full 32-bar scores. Original prompt text and seeds are unchanged; style defaults including sauce may change as part of the corrected interpretation. The listening index links each original clip beside its revision. Full before/after parameter rows cover all 50 prompts.

| Case | Original interpretation | Revised interpretation |
| --- | --- | --- |
| 02: dark late-night drive | House, 125 BPM, plucked bass/piano | Techno, 130 BPM, dark distorted bass and lower/quiet pads |
| 03: relax and read | House, 125 BPM | Quiet broken piano, 80 BPM, no drum kit |
| 04: scary underground atmosphere | Techno, 132 BPM | Slow dark industrial atmosphere, 82 BPM |
| 05: bright road trip | Synth-pop, 112 BPM | Synth-pop, 122 BPM, energetic lead with less arpeggio clutter |
| 06: warm nostalgic groove | Synth-pop, 112 BPM | Jazz, 92 BPM, warm bass and seventh-chord comping |
| 07: make it bounce | House, 125 BPM | Jersey club, 138 BPM, syncopated kicks and unison 808 |
| 08: calm rainy evening | Synth-pop, 112 BPM | Sparse lo-fi, 78 BPM, restrained piano/drums |
| 09: intense workout | House, 125 BPM | Footwork, 160 BPM, dense drums and bass emphasis |
| 35: heavy 90s techno, no piano | Generic rolling saw techno | Rolling Reese bass; techno rhythm retained |
| 50: dark heavy subs, no piano/lead | Same rolling-saw recipe | Longer distorted-bass phrases, lower/sparser harmony |

The new examples are rendered in Node at 44.1 kHz. MP3 codec and signal measurements use existing FFmpeg. Calm piano remains quieter because preview matching only attenuates; these clips are not all loudness matched. Listen at a comfortable playback volume. Raw/encoded measurements, source identities, complete score data and unfilled human ratings are saved.

```sh
# Uses the saved first listening set as the before baseline; writes a fresh number.
node scripts/review-interpretation-feedback.js

# Structural report for the revised 50-case fixture.
node scripts/evaluate-varied-prompts.js my-context-report

# Optional signal/tempo/key diagnostics, using an existing analysis Python.
"$PYTHON" -B scripts/analyze-listening-set.py \
  --manifest generated_beats/context-review-001.manifest.json
```

The correction runner counts the original listening/phrasing sets and development reports toward the agreed combined 40 MB cap. Additional runs can exceed that cap and stop; reusing the runner does not authorize growing storage beyond the budget. It retains no full-track audio or intermediate WAVs. Generation uses no Python or model dependency. Optional diagnostic analysis reuses the existing local environment and performs no downloads.

## Verification and limits

- 53 Node tests pass, including seven feedback/paraphrase/precedence tests and deterministic seed replay.
- All 23 older intent regressions pass. Regional and instrumental cues remain intact rather than letting generic “bounce” override London garage or Brazilian rhythms.
- The version-2 fixture now checks plausible style families, tempo ranges, instruments and energy for vague prompts. Its 165 observable checks pass across 49 constrained cases; “make a beat” remains open-ended.
- Ten revised previews pass stereo/sample-rate/duration/silence/true-peak checks. Source/audio/score identities are recorded for replay.

These are development regression results informed by human feedback, not held-out accuracy. They do not certify groove, timbre, genre fidelity or usefulness. Human comparison of the revised clips remains the acceptance test. The earlier audio and its weaker reports are preserved, with their engine/data versions, rather than reinterpreted as successes.

This branch continues to leave DSP/vocal implementation to the separate vocals worktree. Shared composition additions preserve the original score shape for integration.


## Listening feedback — case 06, 2026-10-27

For “A warm nostalgic groove,” the user likes that the revised interpretation explores different vibes and grooves, but leans toward the original version's music. For this ask, indie/pop character is a preferred direction. Jazz remains a plausible alternative; the current jazz version needs a fuller, more identifiable jazz ensemble rather than chord color alone.

This is a preference for this example, not a rejection of jazz or a universal rule that nostalgia means one genre. Revisit the current jazz/lo-fi-only expectation for case 06 when interpretation work resumes; its passing structural checks do not mean the jazz choice was preferred musically.

The user explicitly requested notes only and assigned instrument development to another agent. This feedback makes no changes to parsing, composition, instruments, tests or rendered audio.
