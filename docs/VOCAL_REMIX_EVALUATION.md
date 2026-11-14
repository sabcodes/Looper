# Set10: five accompaniments around a supplied vocal

Input: `vocals/Radiohead - Let Down vocals merged.wav` (local only, ignored by
Git). The user identifies this as verse 2 followed by the chorus and supplies
**A major / 125 BPM**. At that tempo the complete 49.92-second file is exactly
26 bars of 4/4. Earlier online tempo listings and a preliminary vocal-only onset
estimate were not used to override the user's values.

Outputs live in `generated_beats/set10/`: five full-excerpt MP3 mixes, gzip
instrumental scores, exact prompts/seeds, source/timing analysis, codec/level
checks, research links and a blank listening scorecard. No source audio is
copied into the output, no decoded WAV is retained, and no external cache,
model, runtime or dependency is downloaded. Approved cap: 10 MB including codec
temporaries; one temporary MP3 is bounded below 1.22 MB.

| Case | Direction | Bass | Harmony |
|---|---|---|---|
| 01 | Halftime trip-hop | Saturated 808 | Sparse broken Rhodes |
| 02 | Swung UK garage | Garage sub between kicks | Short organ offbeats |
| 03 | Four-on-the-floor deep house | Rounded analog on upbeats | Long analog pad |
| 04 | Indie-electronic | Electric bass | Fingerpicked acoustic guitar |
| 05 | Broken-beat electronica | Sine sub | Restrained dark pad |

The original stereo vocal is decoded/resampled from 48 kHz to 44.1 kHz in
memory, without trimming, shifting, stretching, pitch shifting, chopping or
speech resynthesis. It enters the output at the original file position. The
first audible entrance is retained rather than snapped to a beat. The music
mix alone is faded during the last 0.8 seconds; its 450–4000 Hz band is gently
ducked from the vocal envelope (up to about 3.35 dB). The vocal receives only
global safety/loudness gains. Mixes share the same target instrumental RMS,
and integrated loudness is matched by attenuation only, with true-peak and
format/duration checks after encoding.

## Composition and alignment

`data/let-down-vocal-remixes.json` freezes the five hand-directed recipes.
`scripts/lib/vocal-remix.js` reuses the existing prompt configuration, drum
sequencer, downstream kick-consuming bass engine, minimal voicing search and
JavaScript audio renderer. Explicit recipe overrides and the custom harmonic
plan are retained as experiment metadata. This is a creative arrangement study,
not an automatic prompt-following evaluation or an exact original transcription.

All five share a sparse A-major reharmonization, with A/E/F# minor verse colors
and D/E/A/F# minor chorus colors. The verse spans bars 1–16, chorus bars 17–25,
with a one-bar closing tail. Chord changes within chorus bars also constrain
bass and harmony note endings. The original singing remains the lead: no new
synth lead or arpeggio part competes with it. There are no global stutters,
air pockets or tape brakes through the vocal.

**Alignment is inferred:** grid zero is the supplied file boundary; the chorus
entrance at 30.72 seconds follows the identified excerpt and form. This was not
manually tapped or verified with lyric force alignment. Duration being an exact
bar multiple does not prove the first downbeat or every phrase/chord boundary.
Listen for a consistent early/late feel, a wrong chord under a held word or a
mismatch at the chorus before treating these as accepted arrangements. The
source's key and BPM come from the user, not an acoustic transcription claim.

## Reproduction and validation

- `node scripts/generate-vocal-remix-set.js --plan`: source/hash/size preflight.
- `node scripts/generate-vocal-remix-set.js`: render into a new set10 folder;
  refuses to overwrite existing outputs.
- `node --test test/vocal-remix.test.js`: deterministic scores and distinct
  grooves, exact 26-bar duration, chord-bounded note pitches/tails, monophonic
  bass, unison/counterpoint/offbeat coupling, unchanged vocal sample positions
  and stereo when music is silent, bounded deterministic mixing.
- `node --test`: full suite; local log in set10. Tests do not certify human
  timing fit, genre fidelity, vocal intelligibility or musical quality.

The original vocal hash is recorded before decoding and verified after all
renders. Engine/data/helper/fixture hashes are checked before and after the
batch. Codec MP3 hashes, durations, stereo/sample rate, level matching and true
peaks are retained. Raw synthesis/mixing stays in memory. Compression and
resampling use the already installed FFmpeg.

## Research

- [Apple Music song credits](https://music.apple.com/us/song/1097861834).
- [Citizen Insane song archive](https://citizeninsane.eu/music/okc/letdown.html)
  for lyric section order, cross-checked with the user's provided excerpt.
- [Ethan Hein's published harmonic/form analysis](https://www.musicradar.com/artists/if-the-point-of-radiohead-songs-isnt-to-make-you-feel-good-what-is-their-music-for-a-music-professor-breaks-down-the-theory-behind-radioheads-let-down)
  informed the major-key ambiguity and verse/chorus harmonic colors. The
  source's original tempo listings do not replace the user's 125 BPM setting.

Lyrics are not transcribed into the fixture, score or reports. The engine's
ordinary CLI, instrument formulas and existing native spoken-vocal workflow
are unchanged. This task adds only the evaluation fixture, helper and runner.

Final run: **158 tests passed, 0 failed, 0 skipped**. Independent regeneration
of all five saved scores plus the decoded original vocal reproduced each full
mixed PCM hash exactly. All five MP3s passed independent hash, duration,
44.1 kHz stereo, true-peak and level checks. Reported integrated levels are
-18.3 to -18.1 LUFS; the highest true peak is -4.6 dBFS. Final retained size is
**6,170,522 bytes**, with a conservative codec-inclusive peak of 7,390,522 bytes.
Source WAV hash remained unchanged; no temporary files remain. These checks
establish file/signal integrity and replay, not human timing or harmony fit.
See local `verification.json`, `source-analysis.json` and `full-tests.log`.

## Set11: favorites, new seeds and quieter vocals

User feedback on set10: **03 and 05 are favorites**; the vocal is too loud
relative to the rest of the track. Exact source identities and verbatim
feedback are retained in `data/vocal-remix-feedback.json`. This does not imply
rejection of the other examples, numeric quality ratings, or confirmed timing.

The follow-up is in `generated_beats/set11/`, under a separately approved
10 MB cap including temporaries. Six complete 49.92-second mixes:

- **03-R / 05-R**: exact favorite instrumental scores and seeds, with only the
  vocal input lowered 6 dB relative to the backing. The 6 dB amount is an
  engineering trial, not a numeric value supplied by the user.
- **03-N1 / 03-N2**: two new deep-house seeds.
- **05-N1 / 05-N2**: two new dark-breakbeat seeds.

`deriveVocalRemixSpec` uses a named seeded stream to vary bounded soft pad/sub
colors, hat patterns/swing, broken-drum phrase ordering, pad inversions/register
and gate, and bass rests/length. House retains its four-on-the-floor identity;
all harmonic material remains tied to the same A-major vocal plan. The new
seeds change actual rhythmic and pitched material rather than just velocities.
None introduce metallic Reese or a competing synth lead.

`mixExternalVocal` accepts `vocalDb` in -24…0 dB, default 0. The original vocal
still drives the midrange-duck detector, so reducing its audible level does
not change that backing processing. The input gain is applied to the vocal
component before the shared safety/loudness gains, preserving the specified
relative reduction. The default 0 dB path retains the original mixed PCM;
original set10 media/reports are not overwritten. Both R versions reproduce
the old full-mix PCM at 0 dB before applying the quieter-vocal control.

Run the additional fixture with:

```sh
node scripts/generate-vocal-remix-set.js --fixture let-down-favorite-variations.json --folder set11 --plan
node scripts/generate-vocal-remix-set.js --fixture let-down-favorite-variations.json --folder set11
```

Fixture names are restricted to data/ JSON filenames and output to numbered
set folders; existing folders are refused. A major, 125 BPM, source position,
pitch, speed and form remain fixed. The original set10 alignment caveat still
applies. The target matches loudness within the new set; this does not force
the new quieter-vocal mixes to match set10's total integrated loudness.

Nine focused tests cover all original/new score safety and replay, new-seed
musical differences, exact favorite score preservation, the isolated -6 dB
vocal change, and prior generalization/evaluator/synthesis checks. Independent
saved-file verification checks every full mixed PCM replay, original source
hash, 0 dB reference replay, relative gain change, codec duration/format/levels
and final disk usage. See set11 `verification.json` and `focused-tests.log`.
These are signal and control checks; the new seed and balance preferences
remain open for listening. No new models, downloads or core engine changes.

Final set11 verification: all six full mixed PCM replays and codec/hash checks
passed; the two 0 dB reference replays match the original set10 PCM exactly.
The measured control ratio is -6 dB vocal-to-backing for all six versions.
**9 focused tests passed, 0 failed**. Final retained size is **7,381,533 bytes**;
conservative codec-inclusive peak is 8,601,533 bytes, under the approved 10 MB
cap. Source vocal unchanged; no temporary files remain.

## Set12: darker breakbeat, piano and violin

The user prefers **05-N1 and 05-N2** and requests vocals **another 12 dB
quieter** plus three new dark-breakbeat seeds with violin and darker/sadder
piano. Exact favorites, hashes and verbatim feedback are recorded in
`data/dark-breakbeat-feedback.json`.

Set12 uses `vocalDb: -18`: -6 dB from set11 plus the newly requested -12 dB,
relative to the original set10 input balance. The backing RMS target stays
fixed. Shared safety/master gains do not alter this vocal-to-backing ratio.
No vocal pitch, speed, source position or stereo changes are introduced.

Three full 49.92-second / 26-bar mixes in `generated_beats/set12/`:

- **DB-1 — Rain-room piano:** sparse descending acoustic-piano phrases.
- **DB-2 — Falling violin:** restrained bowed-violin counterlines.
- **DB-3 — Piano and violin dusk:** combines both layers with reduced pad level.

The existing `acoustic_piano` and `fiddle` profiles supply the instruments;
there are no new instrument formulas, sampled instruments or model downloads.
Soft hammer/low-pass controls darken the piano, and filtered legato envelopes
soften the violin. Descending contours, restrained density and F#-minor colors
within the A-major pitch collection aim for a sadder feel; this is an artistic
intent, not a measured mood score. The shared bass/harmony grid stays in A major
at 125 BPM, preserving the inferred vocal/form alignment. New melodic notes
may use diatonic extensions rather than only the current triad.

The optional `addRemixLayers` path is inactive for old fixtures. Existing set10
and set11 outputs stay unchanged. New event lists and per-part mix settings are
retained in compressed scores for deterministic replay. `layers` is stored in
the new manifest; the listening guide explains the cumulative vocal reduction.

```sh
node scripts/generate-vocal-remix-set.js --fixture let-down-dark-acoustic-remixes.json --folder set12 --plan
node scripts/generate-vocal-remix-set.js --fixture let-down-dark-acoustic-remixes.json --folder set12
```

The user approved 6 MB including temporary files. Ten focused tests pass,
including actual isolated piano/violin PCM, note bounds and pitch collection,
replay, and the additional -12 dB balance control. Independent full-file checks
rebuild all scores, regenerate all three complete mixes with the original
vocal, compare exact mixed PCM/file hashes, measure codec loudness/true peak,
check duration/format, and verify source identity and final storage. See local
`verification.json` and `render-and-tests.log`. Layer realism, mood, groove and
balance remain for human listening. No core engine defaults are changed.

Final set12 results: **10 focused tests passed**; three independent full mixed
PCM replays and encoded-file checks passed. Verified vocal reduction is -12 dB
from set11 / -18 dB from set10. Retained size: **3,716,798 bytes**; conservative
codec-inclusive peak: 4,936,798 bytes, within the 6 MB cap. Input vocal unchanged;
no temporary files remain. The whole mixes are quieter overall than set11;
relative vocal reduction is preserved rather than normalized back upward.
