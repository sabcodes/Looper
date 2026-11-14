# Set9: full arrangements and interpretation follow-up

Listening folder: `generated_beats/set9/`. Open `listening.md` for three complete
32-bar tracks, section timestamps and a blank development/transition scorecard:

| Selection | Sound | Duration |
|---|---|---|
| 09 E | Saturated 808 + PWM | 60.95 s |
| 10 R | Original garage sub + organ | 57.31 s |
| 11 S | Rounded dark analog bass + dark pad | 76.80 s |

These render the exact compressed scores selected in set8/deep-bass, without
recomposition, new patterns or seed rerolls. Scores are relative links to the
existing archives. Before encoding each full track, its selected 16-second
excerpt must reproduce the earlier raw PCM hash exactly. Whole-song attenuation
toward -18 LUFS can differ from attenuation used on the earlier excerpt.
MP3s use the existing 192 kbps encoder; WAV intermediates are not retained.

`scripts/generate-full-arrangement-set.js --plan` checks hashes, pinned source
identities and storage without writing. Omit `--plan` to render; an existing set9
folder is never overwritten. The renderer intentionally requires the original
source snapshot and stops if the engine changed. No models or downloads.
Approved storage is 8,000,000 bytes including temporary files, all inside set9;
rendering stays in memory and one codec temporary stays below 2 MB.

The manifest retains structural metrics from `analyzeScore`, section event
onsets/sounding voices/RMS, 200 ms energy windows around section boundaries and
ending samples. These are descriptive diagnostics. They do not score transition
quality, perceived repetition, realism, audible sustain or emotional fit. The
three exact excerpts were preferred; full-track musical acceptance remains open.
The saved full scores preserve their original prompt interpretations, including
10 R's earlier `comp` phrasing. 09 E and 11 S remain deliberate sound overrides
of their original prompts, not evidence of ordinary instrument interpretation.

## Future-composition fixes

After freezing/rendering the chosen full tracks, two engine changes address
set8 findings without rewriting that listening baseline:

- Accompaniment accepts `offbeat organ chords`, `off-beat electric piano chords`
  and `off beat guitar comping`, with negated requests ignored. The 4/4 offbeat
  bank, answer and turnaround now keep chord attacks on eighth-note upbeats
  (steps 2/6/10/14). This applies to shared primary/layered harmony policy;
  odd-meter grouping remains its separate existing policy.
- Context inference combines social company with daylight/domestic activity,
  reflective mood with homeward travel, and playfulness with walking. It uses
  existing indie/pop, R&B/lofi and dance/funk families, with matching tempo and
  energy priors. Evidence and review-needed flags remain exposed. Isolated
  nouns such as friends or train do not activate these new combinations.
  Explicit styles, numerical tempo/key and exclusions retain precedence.

New regressions failed before implementation and pass after it. They cover
paraphrases and multiple seeds, score replay, separate musical plans, negative
requests, actual upbeat note positions and explicit overrides. The existing
multi-bar variation check caught an early over-quantized approach that lost
motif diversity; the final bank/answer/turnaround changes retain variation.

`generated_beats/set9/parser-regression.json` checks all 24 original set8 prompt
and seed combinations with future compositions, without writing new audio:
16/16 detailed/contrast cases pass observable constraints (previously 14/16),
all 24 pass event safety/replay, and the six neutral-fallback cases now resolve
without identical musical-plan groups. The vague settings infer indie pop at
104 BPM, alternative R&B at 86 BPM, nu-disco at 118 BPM; the quiet dawn case
retains classical minimal at 80 BPM. This is a development regression informed
by the earlier failures, not a held-out semantic benchmark. The new choices
still need listening; no genre label proves mood accuracy.

Full suite output is retained in `generated_beats/set9/full-tests.log`. See
`verification.json` for final checks, hashes and storage after reports. Engine
DSP, voice formulas, automatic bass palettes and local-LLM policy are unchanged.

Final verification: **155 tests passed, 0 failed, 0 skipped**. Independent file
checks confirmed all three selected score links, audio hashes, full durations,
44.1 kHz stereo format, -18 LUFS (reported precision) and peaks at or below
-4 dBFS. PCM endpoints reach zero; this does not certify a musically satisfying
ending. Final retained size including regression report and log is recorded in
`verification.json` and remains below 4.8 MB; conservative codec-inclusive peak
stays below 6.7 MB against the approved 8 MB cap.
