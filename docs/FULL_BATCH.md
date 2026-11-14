# Full batch: styles, instruments and rhythm

This document describes v1.6. For the subsequent full expansion, see
[the v1.7 guide](EXPANSION.md).

Version 1.6 implements the full earlier wishlist while reusing the engine's
existing synthesis, seeded composition, voice leading, arrangement and export
paths. The 50 presets include the neutral fallback. These are instrumental
procedural sketches; the tests establish musical structure and signal stability,
not fidelity to commercial recordings or realistic acoustic performance.

## Styles

| Family | Supported requested styles | Distinguishing behavior |
| --- | --- | --- |
| House | House, deep house, soulful house, tech house | Different bass phrases, chord density, sevenths, organs and percussion |
| Garage | UK garage/2-step, speed garage, bassline, UK funky | Skipping versus steady kicks, Reese/FM bass and interlocking hand percussion |
| Drum & bass | Liquid D&B, jungle, jump-up, neurofunk | Different break phrases, ghost snares, bass articulation and modulation |
| Techno | Rave/Detroit techno, minimal, dub, industrial, acid techno | Sparse motifs, delayed chords, driven drums or resonant acid bass |
| Hip-hop/R&B | Lo-fi, boom bap, trap, drill, alternative R&B | Separate kick/backbeat patterns, bass styles and harmonic density |
| Memphis/phonk | Memphis rap, phonk | Dark bell riffs versus a pitched cowbell hook and distorted 808 textures |
| African electronic | Afro house, gqom | Interlocking hand percussion versus broken kick phrases and sparse harmony |
| Amapiano | Amapiano, private-school piano, sgija | Existing log-drum synthesis with different bass phrases, ninth voicings and percussion |
| Caribbean/Latin | Dancehall, reggaeton, Dominican dembow | Separate riddim, backbeat and bass patterns with different tempo defaults |
| Electro | Classic electro, Miami bass | Broken 808-style drums, different bass patterns, stabs and optional arpeggios |
| Trance | Progressive trance, psytrance | Eight-bar builds, pads/hooks versus dense offbeat bass and FM plucks |
| Downtempo | Trip-hop, dub | Swung breaks versus sparse skanking organ chords, bass and stronger feedback delays |
| Acoustic | Jazz lounge, minimal classical, country/bluegrass | Existing comping, walking bass, broken figures, legato strings, strums and rolls |
| Existing additional styles | Footwork/juke, Jersey club, baile funk, synthwave, synth-pop, IDM, industrial bass, dubstep | Existing implementations retained |

Each new preset supplies drum and bass phrases plus an instrument palette;
neighboring requested styles are not just alternate names for one preset.
Aliases within a style, such as `bluegrass` for country and `Detroit techno` for
rave techno, remain aliases. One primary style is selected for a prompt.

## Instruments and algorithms

The acoustic piano, guitar, upright bass, banjo, harp, vibraphone, bowed strings,
cello, fiddle, flute, saxophone and pedal steel from version 1.5 are reused.
The existing FM electric piano/Rhodes, log drum, surdo, 808, sub, analog, Reese,
growl, bell, brass, lead and pad implementations are also reused.

| Added sound | Procedural algorithm |
| --- | --- |
| Organ / Hammond-like keys | Additive drawbar harmonics with a short noise key-click |
| Clavinet | Short, bright Karplus–Strong decay with mild nonlinear saturation |
| Electric / bass guitar | Damped plucked-string delay line plus a rounded fundamental |
| Acid bass / 303-style bass | Band-limited additive saw source into the existing resonant state-variable filter, with an envelope sweep and optional slides |
| FM bass | Sine carrier, decaying two-to-one FM modulation and amplitude decay |
| Marimba | Short modal partials near ratios 1, 3.99 and 10.65 |
| Kalimba / thumb piano | Plucked modal partials near ratios 1, 2.75 and 5.4 |
| Steelpan | Longer modal partials near ratios 1, 2, 2.99 and 4.1 |
| Melodic cowbell | Two pitched partials with fast decay, used for the phonk lead |
| Bongos | Pitched resonator with a short pitch bend and attack noise |
| Claves / woodblocks | Short high-frequency or paired woody resonances |
| Cowbells / agogô | Paired nonlinear tones or ringing bell partials |
| Tambourine / crash cymbal | Shaped noise and metallic components with different decay times |

Claps, rimshots/sidesticks, open hats, shakers, congas, rides, brushes, kick,
snare and tom synthesis remain in use. `808 kit`, `909 kit`, and `soft kit`
select different core drum frequency, noise, decay and transient parameters;
these are stylized palettes rather than exact hardware emulations.

There is one tonal instrument profile per musical role (harmony, bass, lead and
arpeggio). Naming multiple harmony instruments does not create a full layered
orchestra. Instrument exclusions and mixed lists such as `no piano or claps or
saxophone` apply to the matching roles/voices. `no cowbells` suppresses both
phonk's melodic cowbell and its percussion cowbell.

## Groove controls

| Request | Behavior |
| --- | --- |
| `hat swing 62`, `keys swing 58` | Independent per-role swing, reusing the existing timing function |
| `late snare`, `pushed percussion` | +12 ms snare or -6 ms supplemental percussion |
| `snare offset 15ms`, `bass offset -5ms` | Explicit bounded -30 to +30 ms offsets |
| `triplet hats` / `triplet groove` | Three hat pulses per quarter note, with true fractional step positions |
| `shuffle hats` / `shuffle groove` | First and last pulses of that triplet grid |
| `funk ghost notes` / `funk groove` | Quiet intervening snares around the backbeat |
| `tresillo` | Repeating 3+3+2 eighth-note grouping in kick and bass |
| `3-2 son clave`, `2-3 son clave` | Complementary two-bar son clave patterns on claves |
| `3 against 2 polyrhythm` | Three equally spaced agogô pulses against two woodblock pulses per bar |
| `percussion cycle 15 steps` | A continuous Euclidean percussion cycle that crosses bar boundaries |
| `long percussion cycles` | A 20-step cycle, repeating against rather than resetting at each bar |
| `drum call and response` | Alternating drum phrases, alongside the existing bass phrasing controls |

`call and response bass phrases` continues to alter only the bass phrasing.
True triplet/shuffle selection affects the hat subdivision; it does not quantize
every tonal part to triplets. Clave/tresillo definitions use a 4/4 reference;
other meters extend or clip those reference phrases to fit. Swing accepts 50–75
percent. Open hats choke at the next closed/open hat. Existing fills, ratchets,
seeded timing/velocity variation and kick-aware bass behavior remain available.

## Meter and timing

Supported signatures are **3/4, 4/4, 5/4, 7/4, 6/8, 7/8, 9/8 and 12/8**.
The duration is `32 × numerator × 4 / denominator × 60 / BPM` seconds.
BPM always measures quarter notes. For example, 6/8 at 120 BPM lasts 48 seconds
for 32 bars; 12/8 lasts 96 seconds. The default remains 4/4.

Drum anchors follow metric groups: compound eighth meters use dotted-quarter
anchors; 7/8 groups 2+2+3 eighth notes; 5/4 groups 3+2 quarter notes; 7/4 groups
3+2+2. Other phrases extend or clip on the same sixteenth-note clock instead of
stretching four beats across a differently sized bar. Section placement remains
in bars, and audio, previews and analysis use the score's actual bar duration.
Trance presets use an eight-bar build from bar 12 through bar 19.

## Validation and references

`test/full-batch.test.js` checks all requested new styles, distinctions between
neighboring styles, individual percussion sounds, drum-kit sound differences,
clave direction, evenly spaced polyrhythms, continuous cycles, subdivision timing,
mixed exclusions, meter durations/accents and CLI parsing. Every preset is also
composed in all eight supported meters, and the remaining 27 styles are rendered
as full tracks in memory. Existing regression and acoustic synthesis tests remain.

The percussion/clave vocabulary is informed by
[Berklee's clave lesson](https://pulse.berklee.edu/content/public/pub_unit_assets/lessons/lesson5_banded/The%20Clave_lesson.pdf).
[Roska's production discussion](https://blog.native-instruments.com/roska-kick-snares-kontakt/)
and [Mina's account](https://blog.native-instruments.com/mina-on-getting-that-global-sound/)
provide artist context for UK funky and its neighboring influences. The exact
preset patterns and synthesis approximations here are implementation choices,
not claims of a single canonical formula for those genres.
