# Set7: sound-only listening comparisons

Local output: `generated_beats/set7/`. Three groups use cases 02, 08 and 09,
whose v1.9/set6 B versions the user preferred. Each group contains:

- A: the preferred set6 B reference, linked in place.
- B: the identical performance with only the primary bass profile replaced.
- C: the identical performance with only the primary harmony profile replaced.

| Case | A reference | B: bass only | C: harmony only |
|---|---|---|---|
| 02 | Upright bass + PWM | Warm sub | Rhodes |
| 08 | Upright bass + vibraphone | Electric bass | Acoustic piano |
| 09 | Acid bass + vibraphone | Deep analog bass | Organ |

The answering acoustic-piano part in 09 remains unchanged. Leads, drums and all
other instrument parts remain unchanged in every comparison. Six new MP3 files
and gzip scores are retained; three audio links and three score links reuse
set6 files. Keep set6 and set7 as sibling folders so these links resolve.

The fixture is `data/sound-only-listening.json`; the generator is
`scripts/generate-sound-only-set.js`. `--plan` validates inputs and estimates
storage without writing media. Generation refuses an existing output folder
and enforces the separately agreed 4,000,000-byte cap. New collections require
their own agreed storage budget.

These are deliberate evaluation overrides applied after composition. The
original prompts name their instruments and remain recorded as provenance;
ordinary prompt/seed generation correctly keeps those named instruments pinned.
This collection tests sound preference on frozen phrasing, not prompt following
or the automatic palette selector's ability to infer intent.

Each variant preserves pitches, onsets, durations, velocities, articulation,
glide instructions, drum events, chords, sections, arrangement, automation,
sidechain and production. Only the target event profile and corresponding sound
metadata change. Inherent oscillator/envelope behavior changes with the
instrument; identical event durations do not imply identical audible decay.
A global attenuation matches listening level without changing performance data.

All nine listening clips are 16 seconds, stereo, 44.1 kHz MP3 at 192 kbps. The
six new clips match their reference at 0.0 LU at FFmpeg's reported precision;
each has encoded true peak below -1 dBFS. The generator's frozen-performance
checks were followed by six independent profile-only comparisons of saved
scores, file-hash checks, verification of all reference links, and verification
of the 27 engine/data source hashes. Syntax validation also passed. The engine
itself was not modified for this batch.

Retained file/link bytes including reports and render log: 2,607,562 (about
2.61 MB). Rendering stayed in memory, codec temporaries stayed inside set7 and
were removed, and no downloads, external caches, models or dependencies were
added. Original set6 references and their scores remain unchanged.

Open `listening.md` for grouped playback. `scorecard.csv` records supplied
bass preference A/B, harmony preference A/C, overall A/B/C and notes. Unspecified
preferences remain blank; signal checks alone do not establish taste.
`manifest.json`, `audit.json`, `completion.json` and `render.log` preserve the
comparison recipe and verification evidence.


## Human feedback

The user explicitly confirmed the order as 02, 08 and 09.

| Case | Bass | Harmony | Overall |
|---|---|---|---|
| 02 | B: warm sub | C: Rhodes | C |
| 08 | A/B sound the same | C: acoustic piano | C |
| 09 | B: dark analog bass | C: organ | C |

In 02, the user perceived that B removed the metallic synth. The actual
controlled change was upright bass to warm sub while PWM remained unchanged.
Keep both facts: this is a report about the mix's sound, not an isolated voice
identification or a reason to ban PWM. The 08 result supplies no preferred bass.

Exact wording, ordering clarification, seeds and all nine audio/score identities
are preserved in `data/sound-selection-feedback.json` and the local
`generated_beats/set7/feedback.json`. The scorecard and readable feedback note
were updated. All original audio/score hashes were verified and the generation
manifest was preserved. Storage after feedback is 2,617,083 file/link bytes,
within the 4 MB cap; the completion report keeps its render-time snapshot.

At the initial set7 review, C retained the original bass and the combined
warm-sub/Rhodes version of 02 and analog-bass/organ version of 09 had not yet
been heard. The combined extension and its feedback are recorded below. For 08,
retain the current bass when testing acoustic-piano harmony because no bass
preference was supplied. No engine or audio changes were made from this feedback.

## Combined preference extension

After feedback, the user requested a combination check. Two new 16-second
previews live in `generated_beats/set7/combined/`, with linked C references:

- 02 C: upright bass + Rhodes; D: warm sub + Rhodes.
- 09 C: acid bass + organ; D: dark analog bass + organ.
- 08 retains C (upright bass + acoustic piano); no duplicate clip was needed
  because A/B bass sounded the same and C already supplied the preferred harmony.

`scripts/generate-combined-sound-check.js` derives the combinations from the
saved set7 feedback. The D bass event arrays exactly match the respective B
scores, while keys, leads, arpeggios, additional parts, drums, chords, sections,
automation and sidechain exactly match C. Performance configuration is unchanged;
only the bass profile metadata differs from C. All source scores/audio hashes
and 27 engine/data source hashes were verified. Both new clips match reference
loudness at 0.0 LU at the meter's reported precision and have encoded true peak
below -1 dBFS. A descriptive reference-bass metadata label was corrected during
final verification; the audio and score data were unaffected.

This is a small continuation of set7 within its existing 4 MB allowance. The
entire set7 folder after the extension and independent verification uses
3,500,322 file/link bytes. The generator reserves room for a temporary 386 KB
MP3 and checks the projected peak against the whole-folder cap before rendering.
Rendering stays in memory and no downloads or external caches are used.
The C media are reused through links, and previous comparisons remain unchanged.

Open `combined/listening.md` for C/D playback. `combined/scorecard.csv` now
records the supplied C/D preferences; individual dimensions remain blank. `combined/manifest.json`,
`completion.json`, `verification.json` and `render.log` record the two pairs and
verification. The parent generation snapshots retain their historical sizes.
No engine defaults were changed.


### Combined listening result

The user answered “D for both.” This confirms D over C for 02 (warm sub +
Rhodes) and 09 (dark analog bass + organ) on these exact performances. Separate
bass-balance, groove, overall-feel ratings and preference strength were not
supplied. 08 remains at its earlier C choice: upright bass + acoustic piano.

`data/combined-sound-feedback.json` and local `combined/feedback.json` preserve
the wording, seeds, profile combinations and audio/score hashes. All four audio
and four score hashes were reverified; the original manifest is unchanged.
Whole set7 storage after feedback is 3,510,747 file/link bytes, within the 4 MB
cap. No new audio, engine defaults or model downloads followed from this rating.
Use the confirmed combinations as positive reference recipes while preserving
explicit user instrument requests; do not infer universal instrument preferences.
