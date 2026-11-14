# Set8: fresh end-to-end prompt evaluation on v1.10

Local collection: `generated_beats/set8/`. Engine/data revision:
`6030bebb66fd44f97b51efceec9d15ca8a7be0f4` (v1.10.0, including granular pitch
calibration). This evaluates ordinary `compose(prompt, options)` with no
post-composition sound substitutions. The expansion is reused unchanged.

## Fixture and generation

`data/generalization-evaluation.json` freezes 12 new prompts and the two seeds
`generalization-20261029-a` / `generalization-20261029-b` before listening:

| Cases | Category | Scope |
|---|---|---|
| 01–04 | Vague | Kitchen/social, last train home, quiet dawn, playful walking |
| 05–08 | Detailed | Liquid D&B/celesta/alto flute; 6/8 country/resonator guitar; 3/4 chamber/harpsichord/recorder/just tuning; electro/additive/FM/Markov melody |
| 09–12 | Contrasts | No piano/lead/arps; bass between kicks/offbeat organ; explicitly metallic continuous bass; drums-only footwork |

All arrangements have 32 bars. Vocals are off. Two seeds produce 24 case entries;
A/B mean different seeds, not before/after versions. Vague prompts have no single
required genre or mood label. The selected prior prompt fixtures contained 99
`prompt` strings; none exactly duplicates a new prompt. This is a fresh project
evaluation, not an independent population-level benchmark or accuracy estimate.

`scripts/generate-generalization-set.js` verifies the runtime matches the pinned
commit, hashes engine/data/evaluation sources, checks score replay and event
safety before rendering, and refuses an existing manifest. Sources are rechecked
before every case and after generation. It retains 16-second focal MP3 previews
and gzip full scores. Rendering stays in memory. Identical complete renderer
inputs, after removal of non-rendered prompt/classification/messages, reuse a
local audio link. Every prompt and seed remains reported, including duplicates
and failed requested settings. No seed reroll, sound swap, model or download.

## Results

- Full Node suite: **153 passed, 0 failed, 0 skipped**. This includes the other
  agent's mathematical/synthesis checks and four added evaluation/integration tests.
- The six selected new voices were checked at notes 36/60/84, at 16/44.1 kHz,
  low/high velocities, deterministic PCM replay and bounded post-release energy.
  The output DC blocker can retain a few PCM counts after note-off, so release
  checks bound that energy rather than requiring exact zero bytes.
- **14/16 detailed/contrast cases** pass all requested observable settings.
  Across all entries, 22/24 have no failed applicable constraints; the eight
  vague entries are not evidence of semantic accuracy.
- **24/24** pass event safety, score replay, file hashes, 16-second stereo format
  and encoded peak checks. Highest encoded true peak is **-3.3 dBFS**.
- **20 new MP3 files + 4 audio links** supply the 24 playable entries.
- Eight archived listening references (six case identities, including mixed/tied
  alternatives) were hash-verified in place. They were not regenerated on the
  new DSP; previous human preferences are not assumed to persist automatically.
- **38 source hashes** were verified, including evaluation tooling/fixture files.
- Retained file/link size after independent verification: **8,401,435 bytes**,
  under the separately approved 12,000,000-byte allowance. Codec temporary files
  remain inside set8 and below 0.5 MB at once. No temporary files remain.

The suite being green does not erase evaluation misses. The tests verify the
evaluator can detect failures and that events/rendering are safe; they do not
silently redefine a failed prompt as expected engine behavior.

## Findings retained for follow-up

1. **Offbeat qualifier miss:** 10-A and 10-B request “sparse offbeat organ chords”
   but receive `comp`. The existing accompaniment regex recognizes “offbeat
   chords” and does not bridge the instrument qualifier. Actual garage bass
   counterpoint passes. Prompt and expectation were left unchanged.
2. **Vague-context collapse:** 01, 02 and 04 select unresolved neutral fallback
   and produce identical musical plans for a given seed. Groups are
   01-A/02-A/04-A and 01-B/02-B/04-B. Exact-renderer equivalence supports audio
   reuse; it is not evidence that the different briefs were understood.
3. **Human quality remains open:** new-instrument realism, mood fit, groove,
   perceived repetition, usefulness and full-track development are unscored.
   The focal previews do not test complete transitions, build/drop development
   or endings. Full-arrangement listening should follow selection of examples.

No engine changes were made to improve these evaluation results. Fixing the
qualifier grammar and testing broader contextual cues are separate follow-ups;
keep the frozen results as the pre-fix record.

## Local artifacts

- `listening.md`: grouped playback, actual interpretations and visible failures.
- `scorecard.csv`: blank prompt-fit/groove/sound/repetition/usefulness ratings.
- `prompts.json`: exact fixture; each full score preserves its prompt and seed.
- `manifest.json`: pinned commit, source identities, per-case checks and codec data.
- `evaluation.json` / `verification.json`: results, denominator clarification,
  independent replays/hashes, duplicates and storage.
- `reference-anchors.json`: links and hashes for accepted/mixed/tied references.
- `focused-tests.log`, `full-tests.log`, `render.log`: execution evidence.

Human feedback has not been filled in. No global instrument preference or local
LLM change follows from these checks. Do not download a local LLM without the
user's explicit approval.

## Bass preference follow-up

The user reported: “and 9-12 I think some of them wouldve sounded better with a
deep bass or 808 instead of the metallic sound”. This is range-level feedback;
no particular seed or individual case within 09–12 was identified. Preserve the
verbatim report in `data/generalization-feedback.json` and local `feedback.json`.
It does not establish a global instrument ban or numeric quality rating.

`scripts/generate-deep-bass-check.js` adds six 16-second comparisons under
`generated_beats/set8/deep-bass/`, within the existing whole-set8 12 MB allowance.
Use `--plan` for read-only storage/source preflight. It refuses an existing output
folder. No engine or selector defaults change.

The source cases are fixed before rendering: **09-B** (PWM harmony), **10-A**
(organ), **11-A** (dark pad). R links the original MP3/score; S replaces only the
bass profile with `dark_analog_bass`, E with `saturated_808`. Notes, register,
velocities, durations, glide instructions, phrasing, other voices and effects are
verified unchanged. Reference raw preview PCM must reproduce exactly on the
current engine. Complete mix loudness must match within 0.3 LU using attenuation;
true peak, duration, stereo format, source identities and saved-file hashes are
checked. Different instrument attack, decay, intrinsic gain and interaction with
existing mix processing remain part of the sound change.

Why these sounds: in the current `src/dsp.js` bass branch, `warm_sub`, `sine_sub`
and `garage_sub` share the same oscillator/decay path for otherwise identical
events. Renaming among them would not provide a useful sound comparison here.
The rounded analog and saturated 808 paths are distinct. This test does not
change octave, add glides or redesign the bass rhythm.

09 already uses sine sub; 10 garage sub. The metallic impression may involve
harmony or other harmonics, so bass replacement alone may leave it audible.
11 explicitly requests metallic bass; its alternatives are deliberate creative
overrides rather than prompt-following results. 12 has no pitched events and
stays out of this bass-only test. A separate harmony treatment can follow if
bass swaps leave the unwanted character. Listening preferences remain unfilled;
see the extension's `listening.md`, `scorecard.csv`, `manifest.json` and
`audit.json` for playback and verification evidence.

Confirmed listening choices for the bass-only follow-up: **09 E**
(`saturated_808` + unchanged PWM), **10 R** (original `garage_sub` + organ),
**11 S** (`dark_analog_bass` + dark pad). Exact selections, hashes and seeds are
saved in `data/deep-bass-feedback.json` and local `deep-bass/feedback.json`.
Separate dimension ratings and whether the metallic impression remained were
not supplied. These choices support contextual sound preferences; they do not
change global defaults or the original prompt-following results.
