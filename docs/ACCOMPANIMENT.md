# v1.8: accompaniment phrases and meter selection

This change builds directly on expansion commit `3e377ec`. Its layered parts,
production, forms, motifs, instruments and timeline are reused. No new instrument
models, dependencies or genre presets are added.

## Accompaniment

Built-in keys and additional harmony parts now share a phrase planner. It chooses
held voicings, broken chords, short riffs, strums, offbeat patterns or syncopated
comping using the instrument, genre and seed. A phrase has a repeating opening,
answers and turnarounds over two, four or eight bars. Introductions, breakdowns
and bridges thin the accompaniment; drops and choruses bring fuller responses.
Sustained parts hold across bars and end at chord or section boundaries. Odd and
compound meters use the actual bar groups and timeline rather than looping a
four-beat accompaniment template. Chord changes and tempo/meter edits remain
owned by the v1.7 timeline.

Prompt controls:

```sh
node bin/makebeats.js "deep house with acoustic piano, held chords, 4-bar accompaniment phrases" --seed 41 --dry-run
node bin/makebeats.js "deep house with acoustic piano, broken chords" --seed 41 --dry-run
node bin/makebeats.js "synth funk with clavinet, chord riff, 8-bar accompaniment phrases" --seed 918 --dry-run
node bin/makebeats.js "country with strummed chords" --seed 12 --dry-run
```

Recognized phrasing includes `held chords`, `sustained chords`, `legato chords`,
`whole-note chords`, `no stabs`, `broken chords`, `rolling piano`, `fingerpicked
accompaniment`, `arpeggiated accompaniment`, `chord riff`, `strummed chords`,
`offbeat chords`, `syncopated comping` and `sparse stabs`. Phrase lengths are 2,
4 or 8 bars and do not change the requested song length. A short seed-based
phrase grammar still supplies the material; this is not a general composition
or performance model.

A layered harmony part can specify `pattern` as `sustain`, `broken`, `riff`,
`strum`, `comp`, `offbeat` or `funk`. Parts with an explicit independent `cycle`
keep that clock; combining a pattern and a cycle is rejected. Other part roles
retain their v1.7 scheduling. Instrument/role exclusions continue to apply.

```js
compose('jazz with acoustic piano', {
  seed: 41,
  parts: [{ name: 'warm_answer', profile: 'organ', role: 'harmony', pattern: 'sustain' }],
});
```

The compiled score records `config.accompaniment` and each additional harmony
part records its own accompaniment policy. Changing the accompaniment preserves
the independent drum, bass, lead and arpeggio random streams.

## Meter

Selection follows this precedence:

1. Explicit numeric signature, including the existing timeline meter changes.
2. Form cues: `waltz` → 3/4, `jig` → 6/8, `slip jig` → 9/8.
3. Genre default, currently 4/4 for the existing presets.

`vary meter`, `random meter`, `seeded meter` or `choose a suitable meter` requests
one seed-based initial signature from the genre's allowed set. It does not
randomly switch signatures between bars. Explicit signatures and form cues take
priority over this optional selection.

- Classical: 4/4, 3/4, 6/8 or 12/8.
- Jazz and country families: 4/4, 3/4 or 6/8.
- IDM: 4/4, 5/4 or 7/8.
- Other current styles: 4/4; explicit overrides still accept every supported meter.

An archetype may declare `default_meter` and `meter_options`. Current presets
retain their established defaults. Configurations record `meterSource` and
`meterChoices`. BPM continues to measure quarter notes in all meters.

```sh
node bin/makebeats.js "classical waltz with acoustic piano" --seed 9 --dry-run
node bin/makebeats.js "jazz, vary meter" --seed 9 --dry-run
node bin/makebeats.js "house in 4/4" --seed 9 --dry-run
```

## Listening comparison and verification

The v1.7 baseline passed 118 tests. Focused regressions first exposed the repeated
attack bars, fixed layered-harmony clock, missing form inference and held-note
boundary gaps. The complete final test result is recorded in
`generated_beats/phrasing-final-tests.log`.

`generated_beats/phrasing-compare-001.listening.md` compares three matched
12-second examples: acoustic piano in deep house, clavinet in synth funk and
wavetable synth in progressive house. Prompts, seeds, chord progressions, drums,
bass, lead and arpeggios are identical across each pair. The encoded previews
have measured loudness and true-peak headroom; attenuation-only matching can leave
quieter clips. Human preference remains a listening decision.

Across the eight-bar drop, the baseline repeated one attack shape in each case.
The new piano has four attack shapes, the clavinet three, and the synth uses
held voicings alternating with bars without a new attack. More attack patterns
are not automatically better; the held example intentionally has fewer triggers.

```sh
node scripts/compare-accompaniment.js before
node scripts/compare-accompaniment.js after phrasing-compare-NNN
```

These commands create a fresh collection and require an agreed output budget.
Existing before/after files are never overwritten. Full scores are gzip JSON;
only preview audio is retained, and no intermediate WAV is written.
