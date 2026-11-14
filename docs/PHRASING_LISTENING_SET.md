# Set6: matched phrasing listening comparisons

Local collection: `generated_beats/set6/`. It contains six before/after pairs of
16-second, 44.1 kHz stereo MP3 previews at 192 kbps, plus gzip full scores,
prompts, a listening catalog, scorecard, manifest and verification reports.
Retained size after the final audit: 5,160,548 bytes, within the separately
approved 6,000,000-byte budget. Audio stays local and is ignored by Git.

Cases 08, 12 and 20 were previously disliked; 02, 09 and 13 were favorites.
`A-before` uses the archived set5 v1.8 score. Its freshly rendered preview PCM
matches the original set5 preview PCM hash in every case. `B-after` uses v1.9
phrasing and the exact saved prompt, seed and options. Excerpt positions match
set5, including clips spanning section boundaries.

Assertions preserve chords, drums, sections, automation, sidechain, tempo, key,
meter, timeline, production, sound controls, primary profiles and additional
instrument definitions. Bass, harmony, lead and layered-harmony phrasing may
change. Case 12 also receives the drum-cue/bass-phrasing parsing correction.
This collection does not isolate a single instrument or test new sound palettes.

Each pair uses a common attenuation-only loudness target. All six pairs matched
to 0.0 LU at FFmpeg's reported precision, and all encoded true peaks were below
-1 dBFS. Full rendering occurred in memory; no WAV intermediate or model download
was used. Original set5 files were preserved. Six new scores replayed exactly
under the recorded source hashes; all twelve audio/score pairs passed hash checks.

Open `listening.md` for paired playback. Use `scorecard.csv` or provide chat
feedback on groove, sound, repetition and overall preference. Unreported rating
dimensions remain blank. Signal checks establish valid comparisons, not improved
musical quality.

The generator is `scripts/generate-phrasing-listening-set.js`; it refuses an
existing output folder and enforces a 6 MB output limit. A future collection
requires a fresh agreed location/budget. The complete manifest and `audit.json`
are authoritative; `completion.json` records the final independent replay/file
check and measured storage, and `render.log` records progress.


## Listening feedback

The user preferred B overall for 08, 12, 02 and 09, slightly preferred A for 20,
and found 13 about the same. In 12, A wins groove while B wins repetition and
overall feel. In 09, B explicitly has more funk/groove. Other dimension ratings
were not supplied and were not inferred. The direction of the repetition change
in 12 was not specified.

Exact wording, seeds and before/after artifact hashes are tracked in
`data/phrasing-listening-feedback.json`; local copies, the filled scorecard and
readable notes are in `generated_beats/set6/feedback.json`, `scorecard.csv` and
`feedback.md`. All 12 audio files and 12 scores were hash-verified, and the
original generation manifest remains unchanged. Folder use after feedback was
5,384,860 bytes, below the 6 MB cap; the completion file retains its original
render-time storage snapshot.

These six comparisons support retaining the new phrasing as a promising
option, with 12 and 20 as specific regression references. They do not establish
a universal phrasing rule or identify a particular instrument as the cause.
No engine defaults, media files or scores were changed in response to this
feedback. The next sound-selection test should freeze phrasing; the groove
tradeoff in 12 can be tested separately without reintroducing the parsing bug.
