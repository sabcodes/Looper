# Indie Pop variation listening set

Set5 responds to the user's feedback that the set4 sounds, especially #8, were too metallic and repetitive. It uses twenty saved recipes based on the upbeat indie-pop brief, varying instrument palettes as well as note generation. Instrumental 16-second MP3 previews and gzip full 32-bar scores live in `generated_beats/set5/` under a separately approved 12 MB cap. The audio and personal listening reports remain Git-ignored.

`data/indie-variation-20.json` retains the original request, adaptations, one master seed, twenty clip seeds, expanded prompts, structured extra-part options and expected choices. `scripts/lib/indie-variations.js` uses that master seed to shuffle balanced banks: eight bass sounds (no metallic Reese), ten harmony sounds, twelve major roots, five forms, six accompaniment styles and six BPM choices. It varies bass phrasing, drum cues, swing, chord interval, phrase length and motif transformation too. Additional harmony parts can have a different pattern from the primary part.

This is an explicit evaluation tool, not a change to normal seed semantics. Key, tempo, instrument names and structure were deliberately loosened for this experiment. All examples keep the indie-pop intent, 4/4 and 32 bars. Multiple factors vary together, so the batch explores preferences rather than isolating one cause.

```sh
# Already completed in set5. A new render requires its own storage agreement.
node scripts/generate-indie-variation-set.js set6
# Read source hashes, compressed score/audio hashes and score replays;
# writes a new audit.json and refuses to overwrite an existing audit.
node scripts/audit-indie-variation-set.js set5
node --test test/indie-variations.test.js
```

The renderer uses existing Node composition/synthesis, gzip and FFmpeg. It retains no full-track audio or temporary WAVs. Audio checks verify duration, stereo format, non-silence and headroom, with attenuation-only loudness matching. Signal checks do not establish perceived tone or musical quality.

Results: all twenty signal checks and score replays passed; 125 Node tests and four Python analysis checks passed. Eight bass profiles, ten harmony profiles, twelve roots, five forms and six accompaniment styles actually occur. A key/tempo-independent grid attack-shape audit finds three kick, six bass, fifteen harmony and four lead inventories (including no lead). Whole-mix acoustic diagnostics were produced with existing local tools and no semantic model. See `generated_beats/set5/listening.md`, `findings.md`, `audit.json` and `set5-indie-variation-20.diagnostics.json`.

A shared alias fix makes `electric bass guitar` one complete instrument name rather than leaving a stray acoustic-guitar match. Existing set4 audio is preserved. Preset diversity does not guarantee perceived diversity: guitar, FM, clavinet and other profiles may still sound metallic. Human feedback remains the deciding evidence.

## Human feedback — October 28, 2026

Favorites: **01, 02, 04, 05, 06, 09, 11, 13, 14, 15, 16, 18**. Explicit dislikes: **08, 12, 20**, because the rhythm of an unidentified metallic-sounding part felt off. The other five clips were broadly positive without being marked favorites. No numeric scores or global instrument bans were supplied. `data/indie-variation-feedback.json` records the seeded preferences; private audio-hash-bound feedback and comparisons are in `generated_beats/set5/feedback.json` and `feedback.md`. The original manifest and audio remain unchanged.

Favorite02/disliked12 both use PWM; favorite09/disliked08 both use vibraphone; favorite13/disliked20 both use acoustic guitar. This supports investigating how parts work together before rejecting those instruments. A reproduced parser defect makes `drum call and response` also select bass call-response, overriding intended sustained bass in12 and affecting05/07 too. It is a correctness defect, not proof of the audible cause. No engine change or additional render was made during feedback capture.
