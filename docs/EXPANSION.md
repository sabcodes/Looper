# Current sound-math supplement

As of October 29, 2026, see [v1.10 Sound and Mathematics](SOUND_MATH.md) for the current 103-profile registry and new controls. The v1.7 baseline below remains a historical reference.

# v1.7: complete music-engine expansion

The ordered work is recorded in [EXPANSION_PLAN.md](EXPANSION_PLAN.md).
This release expands v1.6 to **97 primary presets** (including neutral), **56
named instrument/synth profiles**, layered parts, flexible arrangements and a
separate production system. Existing acoustic, percussion and electronic voices
are reused. Instrumental generation remains offline and dependency-free.

## Try it

Run from the project root. These commands create audio only when you run them;
this implementation does not leave an extra listening collection on disk.

```sh
node bin/makebeats.js "melodic house 32 bars with supersaw and kalimba, plate reverb 20%, true peak limiter" --seed 17 --format wav --output v17-melodic.wav
node bin/makebeats.js "bebop AABA with trumpet and acoustic piano, chamber reverb" --seed 17 --format wav --output v17-bebop.wav
node bin/makebeats.js "bluegrass 32 bars with banjo and mandolin and fiddle, room reverb 15%" --seed 17 --format wav --output v17-bluegrass.wav
node bin/makebeats.js "orchestral classical rondo rubato fermata, hall reverb 25%" --seed 17 --format wav --output v17-orchestra.wav
node bin/makebeats.js "afrobeats 32 bars with electric guitar and marimba, spring reverb" --seed 17 --format wav --output v17-afrobeats.wav
node bin/makebeats.js "house 16 bars at 120bpm change to 7/8 at bar 9 tempo 90 at bar 9, quintuplet hats" --seed 17 --format wav --output v17-meter.wav
```

Append `--dry-run` to inspect the complete plan without synthesizing or saving.
Append `--json` to save the score. `--preview 8` cuts an excerpt at the first
chorus/drop, or at the middle section of an acoustic form, using actual timeline
seconds. Optional spoken vocals and pitch controls from v1.6 remain available.

## Arrangements and musical development

- Lengths: integer **8–128 bars**, with a ten-minute duration ceiling. Ordinary
  prompts retain 32 bars; explicit forms choose their natural default length.
- Forms: club (32), `pop form` / `verse chorus form` (48), `AABA` (32),
  `12-bar blues` / `blues form` (24: two choruses), `rondo` (40),
  `theme and variations` (32), `extended club` / `extended mix` (64).
  An explicit bar count scales section boundaries while preserving coverage.
- Repeated A/theme passages reuse harmonic degrees. B/C and variations change
  motif material. The blues form follows I–IV–V functions across twelve bars.
- `chord every 1 bar`, `chord every 2 bars`, `chord every 4 bars`,
  `fast harmonic rhythm`, `slow harmonic rhythm` change actual chord placement.
- `secondary dominants`, `borrowed chords` / `modal interchange`,
  `tritone substitutions`, `modal harmony` alter chord pitch classes.
- `modulate to G major at bar 17` changes the tonal center from that chord
  boundary onward; supported target modes are major, minor, dorian, mixolydian.
- `motif inversion`, `motif retrograde`, `motif fragmentation`,
  `motif augmentation`, `motif diminution`, `motif transpose -2` operate on
  the lead motif. Transposition is in scale degrees, from -7 to +7.
- `rubato` adds bounded bar-level tempo motion; `fermata` lengthens the final bar.
  This is an explicit procedural timing interpretation rather than phrase-level
  performance inference.
- `change to 7/8 at bar 9` or `meter 7/8 at bar 9`, and `tempo 90 at bar 9`,
  edit the common timeline. Bar numbers in prompts start at one; score indices
  start at zero. BPM remains quarter notes. Existing eight meters are reused.
  Events, vocals, effects automation, preview positions and analysis boundaries
  use that timeline. Tempo changes are steps at bar boundaries, not ramps.

## Independent parts

Naming several instruments adds the extra instruments as independent named parts.
The primary harmony, bass, lead and arp remain compatible with previous scores.
An instrument already present in a preset ensemble is reused. Exclusions apply
to both original roles and additional parts. Chamber and orchestral presets
supply distinct cello, violin, harp and/or timpani parts.

Advanced CLI example:

```sh
node bin/makebeats.js "jazz 16 bars room reverb" --format wav --seed 17 \
  --parts '[{"name":"clarinet_answer","profile":"clarinet","role":"counterpoint","cycle":15,"pan":0.4,"send":0.7,"gain":0.5}]' \
  --mix '{"buses":{"drums":{"compress":true,"threshold":-20},"harmony":{"sidechain":true,"eq":[{"frequency":800,"gain":-3,"q":1}]}}}' \
  --output v17-parts.wav
```

The same arrays/objects work as `compose(prompt, { parts, mix, seed })`.
Part fields: unique `name`, `profile`, `role` (`harmony`, `bass`, `lead`, `arp`,
`counterpoint`), `gain` 0–2, `pan` -1–1, `register` -24–24 semitones,
`send` 0–2, optional independent `cycle` 3–64 sixteenth steps, `articulation`,
`pedal`, `vowel` a/i/u, `pressure` .1–1, `detune` 0–40 cents,
`fmRatios` (four positive ratios up to 16), `fmIndices` (three values 0–12),
and per-part `mix` settings. At most sixteen additional parts are allowed.
`PART_INSTRUMENTS` exports the supported names, including existing Rhodes,
analog lead/pad, Reese and sine-sub profiles.

Counterpoint uses a bounded candidate search over chord tones, with register,
leap and perfect-interval penalties against a chord-root cantus. This is a
practical sketch generator, not a full species-counterpoint or orchestration
rule solver. Chord changes remain quantized to 1/2/4-bar boundaries.

## Instruments and synthesis

| Family | Added profiles and working method |
| --- | --- |
| Brass | Trumpet, trombone, French horn: nonlinear lip excitation, lossy bore delay feedback and bell radiation difference; different brightness parameters |
| Reed woodwinds | Clarinet, oboe, bassoon: nonlinear reed pressure model and bore feedback, with closed-bore reflection for clarinet |
| Free reeds | Accordion, harmonica, bandoneon: pressure-shaped harmonic excitation, odd/even weighting and detuned reed beating |
| Guitars | Electric guitar: plucked string, pickup difference, nonlinear amp and low-pass cabinet; mandolin/12-string: paired delay strings; ukulele: shorter plucked decay |
| Sitar | Plucked delay string with nonlinear bridge and decaying sympathetic partials |
| Membranes and plates | Tabla, djembe, cajon, pandeiro, frame drum, timpani, gong, tubular bells: separate modal ratios, damping and attack/noise components |
| Choir | Voiced excitation, vowel-weighted harmonic formants, vibrato and breath noise |
| Wavetable | Phase-accumulator table lookup, linear interpolation and continuous table morphing |
| Supersaw/unison | Two independent stereo banks of seven detuned band-limited oscillators |
| FM/PM | Four operators in a serial phase-modulation graph, independently configurable ratios and modulation indices |
| Granular | Overlapping Hann-windowed grains of a seeded procedural source, with independent source offsets and playback rates |
| Spectral | Inverse FFT of a shaped harmonic spectrum; public STFT analysis/resynthesis supports magnitude freeze and spectral tilt |
| Nonlinear oscillator styles | Wavefolding, piecewise phase distortion, master/slave hard sync, moving pulse width, ring modulation |
| Formant/vocoder | Vowel-weighted harmonics and per-band procedural modulation; public `vocode` also transfers envelopes from supplied audio using twelve resonator bands |

All new synth profiles run at 4× sample rate and pass a 63-tap FIR decimator.
Wavetable oscillators also limit harmonics for their internal rate. Existing
polyBLEP oscillators remain in use. The additional physical models are compact
procedural approximations; they are not calibrated acoustic or hardware clones.
Original legacy nonlinear drum/analog paths remain their established recipes.

Existing profiles gain `legato`, `staccato`, `pizzicato`, `muted`, `palm mute`,
`slap bass`, `slide` and `tongued` controls where applicable. Bowed strings add
pressure-dependent friction feedback. Plucked strings can mute, slide and slap;
wind attacks can shorten for tonguing; `sustain pedal` extends piano modes and
adds a sympathetic partial. Set a part's articulation directly for independent
performance. These are synthesis gestures, not sampled round-robin articulations.

Public DSP helpers: `fft`, `spectralResynthesize(Float32Array, options)`,
`convolve(signal, impulse, blockSize)`, `vocode(carrier, modulator, sampleRate)`.
STFT options are `size` (power of two 32–8192), `hop` (up to half the window),
`freeze` (source sample index or null), `tilt` (-2–2).

## Grooves

All v1.6 timing, percussion, clave, tresillo, triplets and shuffle remain.
Added controls:

- `eighth swing 62` swings pairs of eighths; `swing 62` retains sixteenth swing.
- `mpc groove`, `bossa groove`, `samba groove`, `cascara groove`, `songo groove`,
  `train groove`, `second line groove`: distinct patterns, timing and accents.
- `humanized`: correlated slow timing drift across a phrase plus bounded local
  motion, using deterministic mathematics rather than unrelated random offsets.
- `quintuplet hats`, `septuplet hats`: five/seven evenly spaced pulses per beat.
- `5 against 4 polyrhythm`: arbitrary 2–16 pulse trains on agogô/woodblock.
- Named parts can have separate continuous cycles that cross bar boundaries.
  `<part_name> cycle 15 steps` also sets an automatically detected part's cycle.
- Acoustic turnarounds prefer lighter snare pickups; electronic fills use toms,
  and build acceleration follows the actual build section's length.

These templates are stylized, meter-aware sketches. They do not encode every
regional or performer-specific interpretation of the named traditions.

## Reverb and mixing

Choose `<style> reverb`, optionally with a percentage, e.g. `plate reverb 25%`.

| Style | Algorithm |
| --- | --- |
| Room / chamber / hall | Early taps, input allpass diffusion and orthogonal four-line feedback delay network; different size/RT60/damping |
| Plate | Brighter diffusion/feedback tank, distinct from the old short stereo delay |
| Spring | Cascaded dispersive allpasses feeding a lossy delay network |
| Convolution | Partitioned FFT convolution with a seeded synthetic IR by default |
| Shimmer | Windowed dual-head octave-up delay reads inside the feedback network |
| Reverse | Convolution with a reversed synthetic decay IR |
| Gated | Finite 180 ms synthetic response; tails stop at the gate |
| Ducked | Hall-like network with dry-envelope-controlled wet attenuation |

The library accepts an optional mono `Float32Array` IR through
`renderAudio(score, { impulseResponse })`, at the render sample rate, up to four
seconds (and at most 384000 samples). It does not download or load IR files.
Rendering keeps the requested song duration; effect tails at its end are faded.

Mix presets: `dry mix`, `cinematic mix`, `dub mix`, `parallel compression`,
`techno rumble`. Dub raises the stereo delay send/feedback; rumble filters a
kick-only room return and ducks it under new kicks.

Other prompt controls: `eq 1200hz -3db q 1`, `compression`, `multiband`,
`dynamic eq`, `chorus effect`, `flanger`, `phaser`, `rotary`, `tape saturation`,
`true peak limiter`, `sidechain compression`.

The mix object exposes `reverb`, `wet` 0–1, `decay` .1–8 s, up to eight `eq`
objects (`frequency`, `gain`, `q`), `modulation`, `compress`, `parallel`,
`multiband`, `dynamicEq`, `tape`, `drive` 1–8, `threshold` -60–0 dB,
`ratio` 1–20, `attack` .0001–1 s, `release` .005–3 s, `limiter`, `sidechain`.
`buses` accepts separate `drums`, `bass`, `harmony`, `lead`, `arp`, `vocals`
settings. Sidechains use a kick envelope. Per-part sends feed the shared reverb;
per-part and bus reverbs can also be set independently.

EQ uses RBJ peaking biquads. Compression uses linked stereo peak detection with
attack/release smoothing. Multiband/dynamic EQ use low/high split envelopes.
Tape combines saturation with modulated delay wow/flutter. The master drive
uses four interpolated nonlinear evaluations per sample; new oscillator engines
have the stronger FIR oversampling path described above. The lookahead limiter
uses 4× windowed-sinc intersample probes; this is an offline peak estimator,
not a certified broadcast loudness implementation. Limiting does not trigger
subsequent gain amplification.

## Summable stems

`--stems --format wav` (or flac) exports the mix plus `.stem-<name>` files.
MP3 stem export is rejected because it cannot preserve exact reconstruction.
Use `renderStems(score, options)` in the library. All stems share one gain;
no individual stem is normalized. The `fx` stem contains shared effect returns
and the nonlinear master residual. Keep it and all other stems at unity.
Integer PCM reconstruction differs only by accumulated rounding (normally a
few least-significant units). The shared gain reserves headroom for cancelling
components, so this mix can be quieter than a normal standalone render.

The renderer makes two passes per stem to keep temporary float-buffer memory
independent of the number of parts; stem export is slower than ordinary export.
Returned PCM buffers still scale with track duration and number of stems.

## Remaining style coverage added in v1.7

- House/disco/funk: melodic, progressive, organic, bass and future house; disco,
  nu disco, French house, synth funk.
- Hard dance: hardgroove, hard techno, hardstyle, hardcore.
- Bass/rap: future bass, melodic dubstep, colour/color bass; rage, plugg,
  pluggnb, cloud rap.
- African/pop: Afrobeats, Afropop, Afro-fusion; bedroom pop, indie pop,
  dream pop, shoegaze. Afrobeats remains distinct from Afro house.
- Drum & bass: dancefloor D&B, minimal rollers, drumfunk.
- Latin: bossa nova, samba, salsa, bachata, cumbia.
- Jazz: bebop, hard bop, modal jazz, jazz fusion.
- Country: honky tonk, Western swing, independent bluegrass.
- Classical: baroque, Romantic, chamber and orchestral classical.
- Experimental: botanica, with granular/spectral voices and an organic mallet part.

Each preset has explicit drum/bass/key phrases and palettes; several add their
own ensembles, forms or harmonic cycles. One primary style still resolves per
prompt. This release does not claim full stylistic authenticity or human-quality
orchestration merely from a preset name.

## Algorithm references

- [Julius O. Smith, Physical Audio Signal Processing](https://www.dsprelated.com/freebooks/pasp/): waveguides, modal models and feedback reverberation.
- [W3C/RBJ Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/): peaking biquad equations.
- [XMOS plate-reverb documentation](https://www.xmos.com/documentation/XM-015103-UG/html/doc/rst/05_api_reference/modules/reverb.html): diffusion/tank terminology. The compact plate here is its own FDN implementation, not a copied Dattorro circuit.

## Verification

- `npm test`: **118 passed, 0 failed**, including complete renders for all 97
  presets, deterministic profile checks at 8/44.1 kHz, native speech/pitch,
  existing MP3/FLAC export checks, DSP contracts and stem reconstruction.
- Additional composition sweep: **108** form/meter/tempo/vocal combinations.
- `python3 -B test/analysis_checks.py`: **4 passed**.
- `test/reference_checks.py` in the existing local analysis runtime:
  **3 passed**. No runtime was installed or copied.
- Independent FFmpeg EBU R128 true-peak check of a processed hardcore render:
  **-8.0 dBFS**, with the output streamed through a pipe and not saved.
- `git diff --check`: no whitespace errors.
Automated checks establish deterministic structure, algorithm behavior, finite
signals, non-silence, headroom and regression compatibility. Listening remains
the final check of musical usefulness and acoustic character.
