# v1.9: sound selection and musical phrasing

The renderer stays offline, deterministic Node.js ESM, using the existing
procedural instruments. No dependencies or instrument models were added.
Local LLM integration is deferred. Do not download a local LLM without the
user's explicit approval.

## Sound selection

Unspecified bass and harmony sounds now use small seeded palettes built from
existing profiles. Indie/bedroom pop can choose electric or acoustic guitar,
Rhodes, organ or PWM harmony, with electric bass, warm sub or dark analog bass.
House, synthwave, techno, lo-fi and related presets have conservative alternatives.
Jazz, classical, country and Latin families retain their signature preset voices;
log drums and acid bass also retain their defining sound. This is deliberately
bounded selection, not arbitrary instrument substitution.

Named instruments and explicit bass textures take priority. Piano exclusions
filter piano candidates. A generic sustained-bass request selects articulation
without forcing Reese. Automatic selection no longer chooses `metallic_reese`;
an explicit metallic-bass request still can. Other procedural instruments can
still sound metallic: this change does not claim to solve perceived timbre by
removing one profile name.

The score records `config.soundDesign.palette`: the seed, candidates, selected
profile and whether selection came from the prompt, palette or preset.

## Independent controls

`--seed` remains the overall repeatable seed. Optional `--sound-seed` and
`--phrase-seed` default to that seed, and let an evaluation hold one factor fixed.
The API accepts `soundSeed` and `phraseSeed` alongside `seed`.

```sh
# Same music seed and phrasing; change only eligible sound choices.
node bin/makebeats.js "indie pop in F major at 120bpm, 32 bars" --seed 42 --sound-seed a --phrase-seed fixed --dry-run
node bin/makebeats.js "indie pop in F major at 120bpm, 32 bars" --seed 42 --sound-seed b --phrase-seed fixed --dry-run

# Keep sound choices and drums; try another accompaniment/lead/bass phrase.
node bin/makebeats.js "indie pop with bouncy bass and lead melody, 32 bars" --seed 42 --sound-seed fixed --phrase-seed another --dry-run
```

Sound rerolls keep the preset/requested accompaniment basis instead of using the
new timbre to reroll the phrase. Phrase rerolls preserve the chord progression,
drums, tempo, key, meter, arrangement and sound choices. Phrase seeds control
accompaniment, melodic hooks and the designed held/bounce/response bass path;
ordinary genre bass coupling patterns retain their existing scheduling.
Explicit independent part cycles keep their clock. Automatic output filenames
include overridden seeds so these variants can coexist.

## Phrasing

- Comping can choose a motif instead of restoring the same preset stab grid.
- Strummed accompaniment has several rhythmic shapes. Country boom/chuck keeps
  its existing anchors. Broken chords and riffs use different pitch contours.
- Indie defaults can choose strums, broken figures, riffs, sustained harmony or
  offbeats. Explicit accompaniment instructions still override defaults.
- Bass and lead calls repeat before their answers; the turnaround develops the
  motif. Lead answers have fewer attacks and a short final note to leave breath.
- Held bass releases at chord and section boundaries and follows tempo/meter
  edits. It remains monophonic, with the existing kick ducking.
- `interlocking accompaniment` leaves a limited space around bass pickups while
  retaining beat anchors. It applies to comp/funk/riff patterns, and is automatic
  for otherwise unspecified indie/bedroom-pop and synth-funk accompaniment.
  `independent accompaniment` disables this interaction. The same planner serves
  built-in keys and additional harmony parts.

The parser now scopes drum/keys/lead call-and-response cues away from bass.
Unqualified `call and response` retains its existing bass meaning, as do explicit
bass response requests. The set5 leak affected 05, 07 and 12; 11 explicitly
requested bass responses and continues to receive them. This correctness fix is
not proof of why the user disliked 12. None of the favored instruments are
banned based on the small, mixed-factor listening set.

## Verification and limits

The complete Node suite passed **134/134**, including existing genre, vocal,
codec, timing, deterministic PCM and export tests. Nine new regressions cover
independent seeds, explicit slots, texture locks, exclusions, cue scoping,
repeated/answering motifs, coordination, held-note boundaries and in-memory
rendering. The saved 20-case recipe checker now also checks intended bass
phrasing, so a drum cue cannot silently satisfy the old narrower checks.

A 24-seed score sweep for indie pop reached three bass profiles, five harmony
profiles and five accompaniment styles. Named instruments stayed fixed.
All 20 set5 recipes passed their explicit constraints after the upgrade. The
same command on this engine version is repeatable; old seeds are **not promised
to reproduce older engine versions**. Original set5 audio, scores and manifest
were preserved.

Small local evidence files live under `generated_beats/`:

- `sound-phrasing-v1.9-tests.log`: complete suite output.
- `sound-phrasing-v1.9-focused-tests.log`: new regressions and strengthened recipes.
- `sound-phrasing-v1.9-evaluation.json`: source hashes, diversity sweep and original
  score hashes with before/after phrase inventories.

No new listening collection was rendered or retained. Short synthesis checks ran
in memory; existing suite codec/speech temporaries are cleaned by the tests.
These checks establish reproducibility and structural behavior, not improved
musical taste. The next listening comparison should hold sounds fixed while
comparing phrasing, then hold phrasing fixed while comparing sounds. Keep the
original favorites as references and obtain a separate budget for retained audio.
