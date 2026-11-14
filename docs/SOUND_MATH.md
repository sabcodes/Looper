# Sound and mathematics — v1.10

Implemented October 29, 2026. This expands the existing v1.9 engine without adding dependencies or genre duplicates. There are **103 registered instrument profiles**: the previous 56, 37 additional named acoustic instruments, two richer modal percussion profiles, and eight additional synthesis profiles. The 97 primary genre presets are retained. Legacy DSP recipes such as Rhodes and Reese remain available separately.

## Tuning

Prompts accept `19 edo`, `24 tet`, `just intonation`, `pythagorean tuning`, `quarter comma meantone`, and `A4=432Hz` / `concert pitch 432`.

`--tuning JSON` or `compose(prompt, {tuning})` accepts:

| Setting | Values |
| --- | --- |
| system | `edo`, `just`, `pythagorean`, `meantone`, `scala`, `custom` |
| divisions | Integer 1–128 for EDO; default 12 |
| concertPitch | A4 reference 300–500 Hz; default 440 |
| mapping | `chromatic` (default) or `degree` |
| ratios | Custom ascending intervals, excluding implicit 1/1 and ending with the repeating period; 1–128 entries, period <=16/1 |
| scala | Actual `.scl` text, at most 64 KiB; description/count/intervals; comments supported |

Chromatic mapping preserves keyboard octaves and rounds each semitone position to the nearest tuning step. Thus 24-EDO chromatic mapping leaves ordinary integer notes unchanged; fractional notes, the quarter-tone scale, or `mapping:"degree"` expose the additional steps. Degree mapping advances one tuning degree per note-number increment; a 12-key register offset then spans 12 degrees, which is not necessarily an octave. Scala/custom periods need not be 2/1. Ratios must be positive, ascending and above 1/1; this reader intentionally rejects nonascending or zero intervals.

Tuning is anchored to the initial song tonic, with its reference frequency derived from concert A4. It is a fixed keyboard tuning, not automatic adaptive retuning at every chord or modulation. `tunedHz(note,tuning,root)` is public. Instrumental score events record `frequency` and `fromFrequency` when nonstandard tuning is active. Pitch offsets/cents and slides preserve those frequencies; native speech pitch targeting remains its separate system.

```sh
node bin/makebeats.js "classical in C major with harpsichord 16 bars just intonation A4=432Hz" --format wav
node bin/makebeats.js "synth pop in C quarter tone 16 bars 24 edo with additive synth" --format wav
node bin/makebeats.js "house with handpan 19 edo" --tuning '{"mapping":"degree"}' --dry-run
```

## Excitation and resonant bodies

Use `--timbre JSON` for shared settings, or put the same fields on an additional `--parts` entry. Part settings override shared settings. All timbre settings are optional; the old unconfigured acoustic voice paths remain available.

| Field | Range / behavior |
| --- | --- |
| pluckPosition, pickupPosition, bowPosition | 0.02–0.98 of string length |
| hammerWidth | 0.005–0.8 of string length |
| hardness | 0–1; changes struck-string harmonic rolloff |
| stiffness | 0–0.02; dispersive partial correction |
| body | `none`, `guitar`, `violin`, `piano`, `wood`, `metal`, `glass` |
| bodySize | 0.25–4; larger bodies lower modal frequencies |
| bodyMix | 0–1, default 0.25 in position-based strings; otherwise model-specific |
| sympathetic | 0–1; shared part resonances excited by every note, with bounded coupling |

Position controls select a modal string path for supported plucked/bowed/struck strings. Pluck amplitudes include `sin(n*pi*p)/(n*n*p*(1-p))`; pickup position contributes another spatial factor. Hammer width introduces sinc-like suppression; hardness shapes rolloff. Stiffness uses `f_n = n*f_1*sqrt((1+B*n*n)/(1+B))`. Bow position/pressure shape a sustained friction-like excitation. Soundboards/bodies use damped modal filters, rather than an external recording.

Shared sympathetic modes retain energy across notes within a part, with at most 32 distinct tuning frequencies and weak bounded inter-mode feedback. Shared timbre settings also apply a bank across built-in pitched voices. These are compact approximations: no calibrated hammer collision, complete Helmholtz bow solver, measured body impulse response, FEM mesh, or full two-way string/body mechanical simulation is claimed.

```sh
node bin/makebeats.js "classical with acoustic guitar" --timbre '{"pluckPosition":0.12,"pickupPosition":0.8,"body":"guitar","sympathetic":0.4}' --format wav
node bin/makebeats.js "chamber classical" --parts '[{"name":"viola_answer","profile":"viola","role":"counterpoint","bowPosition":0.15,"pressure":0.7,"sympathetic":0.3}]' --format wav
```

## Envelopes, modulation and filters

`envelope` uses seconds for `attack` (0–10), `decay` (0.001–10), `release` (0.001–10), and `sustain` (0–1). Release is inside the event's allocated duration; it does not extend the score. Existing click-prevention fades remain.

`modulation` accepts at most 16 routes. Each has `source`, `target`, `amount` (-4..4), optional `rate` (0.01–100 Hz), optional `beats` (0.03125–32 quarter-note beats), and `shape` (`sine`, `triangle`, `square`, `sample_hold`). Sources: `lfo`, `envelope`, `velocity`, `pressure`, `random`. Targets: `pitch`, `cutoff`, `morph`, `fm`, `pan`, `gain`.

Pitch/cutoff amounts are octaves; pitch is bounded to +/-2 octaves and cutoff to +/-4. Pan is an offset clamped to the stereo field. Gain adds to unity and clamps 0–4. Morph is clamped 0–1. FM multiplies modulation depth by `1+value`, bounded 0–5. Each route has its own seeded initial phase. `random` uses deterministic sample-and-hold. Beat rates follow the owning bar's tempo; a sustained note keeps its onset tempo. Morph affects additive/wavetable synthesis, and FM depth affects the FM synth; other profiles do not have those parameters.

`filterModel`: `svf`, `ladder`, `diode`; `cutoff`: 20–30000 Hz, clamped to the render rate; `resonance`: 0–0.95. A cutoff route or explicit cutoff enables an SVF if no model is named. Ladder/diode use four nonlinear one-pole stages, feedback, 4x substepping and DC rejection. They are stable character filters, not exact transistor/diode circuit or zero-delay-feedback reconstructions. Pitch modulation uses bounded fractional resampling for stateful voices; extreme bright pitch modulation can still alias.

```sh
node bin/makebeats.js "house with wavetable synth" --parts '[{"name":"moving","profile":"wavetable","filterModel":"ladder","cutoff":900,"resonance":0.65,"modulation":[{"source":"lfo","target":"cutoff","amount":2,"beats":2},{"source":"lfo","target":"pan","amount":0.5,"rate":0.3}]}]' --format wav
```

## Editable partials, FM and new synthesis

`additive` exposes 1–64 partials. Each partial has `ratio` (0.01–128), `amplitude` (0–1), `phase` (+/-2*pi), `decay` (0.005–30 seconds), and optional `targetRatio`/`targetAmplitude`. `spectrumMorph` (0–1) or a morph route blends the spectra. Partial phases integrate frequency continuously. A supplied partial list can also replace another profile's excitation. Partials above the internal synthesis bandwidth are excluded; the shared synth path renders at 4x rate and FIR decimates.

The formula is `sum(a_n(t) * sin(phase_n(t)))`, allowing harmonic, inharmonic, bell, organ, sine, triangle and other custom spectra. Ratios need not be integers.

FM keeps `fmRatios` (four positive ratios <=16) and `fmIndices` (three indices 0–12), and adds `fmAlgorithm`: `serial`, `parallel`, `pairs`, `branch`; `fmFeedback`: 0–4; and `operatorEnvelopes`: four ADSR objects. Serial is the existing default topology; the other arrangements and independent envelopes provide different timbres.

| Profile | Algorithm and controls |
| --- | --- |
| additive | Editable partial bank and spectrum morphing |
| scanned | 32-node circular mass/spring system updated near 1 kHz and scanned at note frequency; `scanStiffness` 0.01–0.24, `scanDamping` 0.8–0.9999 |
| gendy | Twelve bounded stochastic waveform vertices and segment durations; `stochasticRate` 0.01–1. Pitch is an approximate center, not a precisely tuned oscillator. |
| shepard | Octave-spaced, Gaussian-weighted sine layers |
| risset | Same octave layers with continuous logarithmic ascent/descent; `rissetRate` -0.5..0.5 octaves/second |
| fof | Overlapping damped formant bursts repeated at the fundamental |
| vosim | Decaying sine-squared pulse groups |
| colored_noise | `noiseColor`: white, pink, brown, blue, violet; prompts such as `pink noise` also select the profile/color |

FOF/VOSIM support the existing `vowel` field (`a`, `i`, `u`) on parts. They produce vowel-like tones, not words or trained singing voices. Scanned/GENDY are compact implementations of the algorithm families, not binary replicas of Csound opcodes. Risset octave wraps are weighted to reduce discontinuities; this is not a phase-perfect psychoacoustic reference renderer.

## Imported-source granular synthesis

The `granular` profile accepts `sample`: a mono array/Float32Array of 1–384000 frames, each finite in [-1,1], and `sampleRate`: 8000–96000. The programmatic API accepts a decoded user buffer; the CLI accepts an array in part JSON. This does not automatically open/decode arbitrary audio files or download samples.

Controls: `grainSize` 0.01–0.5 seconds, `grainDensity` 1–100 grains/second, `grainPosition` 0–1, `scanRate` -4..4 source-seconds per output-second, `pitchRatio` 0.25–4. A Hann overlap window and bounded position jitter blend the grains. Source addressing wraps. `scanRate:0` freezes traversal while pitch can change independently. Without an imported buffer, the profile uses its procedural source, calibrated to its actual internal sample-rate-dependent root so note pitch is preserved across render rates. Imported sampleRate defaults to the output render rate when omitted. Grain duration and note/event duration remain independent.

```js
const sample = Array.from({length: 8000}, (_, i) => 0.4 * Math.sin(2*Math.PI*220*i/8000));
const score = compose('ambient house 8 bars', {parts:[{
  name:'frozen_source', profile:'granular', sample, sampleRate:8000,
  grainSize:0.12, grainDensity:35, scanRate:0, grainPosition:0.3, pitchRatio:1.5
}]});
```

## Vocal duration and formants

`--vocal-stretch 0.5..2` / API `vocalStretch` changes prepared word durations independently of pitch; `--vocal-formant -12..12` / `vocalFormant` independently shifts a smoothed spectral envelope. Phase-vocoder overlap-add propagates phases for stretching, while envelope warping changes broad vowel regions. Words are transformed first and phrases rebuilt with their original 25-ms gaps. Existing vocal pitch options run before these transforms. The bank records settings and updated hashes; rendering rejects mismatched prepared banks.

`transformVocalBuffer(Float32Array,{stretch,formant,size})` and `transformVocalBank` are public for already prepared audio. FFT size is 128–4096, default 1024; buffer cap 3,840,000 frames. Results have exactly `round(inputFrames*stretch)` frames. This is an approximate spectral transform: transient smearing, metallic texture and imperfect formant preservation are possible. The mixer still fits speech into its allocated score slot and may speed up an overlong word/phrase, or reject one that needs >1.8x compression. Stretching does not extend section boundaries.

## New named acoustic profiles

Viola, piccolo, alto flute, bass clarinet, English horn, contrabassoon, tuba, cornet, flugelhorn, recorder, ocarina, panpipes, bagpipes, harpsichord, celesta, dulcimer, autoharp, resonator guitar/dobro, bouzouki, oud, kora, koto, shamisen, guzheng, erhu, sarangi, bansuri, shakuhachi, didgeridoo, handpan (including hang-style aliases), singing bowl, glass harmonica, cuíca, berimbau, talking drum, güiro, cabasa.

Each selects distinct excitation, modal ratios, spectral weights, course detuning, breath, pressure, drone, scrape rate or decay parameters. `modal_cymbal` and `modal_plate` add 16- and 10-mode inharmonic percussion. The corresponding actual profile IDs, alias regexes and model parameters live in `src/acoustics.js` and are available through `ACOUSTIC_PROFILES`. These names do not imply sample-library realism or culturally complete performance rules. Existing violin/fiddle, organ/Hammond and other synonyms remain aliases, not duplicate profiles.

## Scales, extended harmony and phrase constraints

The six existing scales gain Lydian, Locrian, melodic minor (ascending form), major/minor pentatonic, blues, whole tone, octatonic diminished (whole-half), chromatic and an explicitly synthetic quarter-tone scale. Use `in C major pentatonic`, etc. Scale-degree lookup handles 5/6/7/8/12-note scales instead of assuming seven everywhere. The quarter-tone collection is not presented as a complete maqam/raga system.

`7th chords`, `9th chords`, `11th chords`, `13th chords` or `--development '{"chordSize":9}'` add thirds to the current scale-based chord. `chordSize` accepts 3, 7, 9, 11, 13 (these are chord-extension labels, not literal voice counts). Core triads retain the exhaustive voice-leading search; extra voices use bounded upper registers rather than an exhaustive seven-voice optimizer. Unusual scales create scale-based stacks, not conventional jazz spellings.

`markov melody` / `second order melody`, `phrase cadences`, `max leap 5`, or API `development:{melodyModel:'second_order',cadence:true,maxLeap:5}` enable conditional pitch proposals using two prior degrees, chord-tone weights and continuation/reversal weights. A projection to nearby scale tones enforces the semitone leap bound; phrase endings favor reachable chord tones. It is a designed probability model, not a model trained on recordings. Restrictive leap limits can prevent a requested cadence; phrase rests, repetition and accompaniment retain the existing policy. `melodyModel:'motif'` is default. These controls affect an enabled lead; they do not force a lead past `no lead`.

## References and verification

- Wave equation, initial conditions and string modes: https://aatishb.com/stringmath/
- Body models and commuted synthesis: https://www.dsprelated.com/freebooks/pasp/Commuted_Synthesis.html
- Scala exchange format: https://www.huygens-fokker.org/scala/scl_format.html
- Stiff strings: https://arxiv.org/abs/1603.05516
- Algorithm families: https://csound.com/manual/siggen/additive/ ; https://csound.com/docs/manual/SiggenScanTop.html ; https://csound.com/docs/manual/gendy.html ; https://csound.com/manual/opcodes/hsboscil/ ; https://csound.com/manual/opcodes/vosim/

`test/sound-math.test.js` checks analytical tuning, excitation suppression, partial frequencies, filter attenuation/DC stability, deterministic modulation, sampled grains, shared resonance/stem reconstruction, new profiles, vocal pitch-preserving duration changes, scales, phrase limits and CLI wiring. The existing full suite retains all genre, meter, phrasing, seed, exclusion, audio, export and native-vocal checks. Automated measurements do not establish instrument realism or replace user listening feedback.

## Verified delivery — October 29, 2026

- `npm test`: **149 passed, 0 failed, 0 skipped** (83.90 seconds, final rerun after granular source calibration).
- `python3 -B test/analysis_checks.py`: **4 passed**.
- Existing local analysis runtime `python -B test/reference_checks.py`: **3 passed**; no runtime installed.
- All 103 profiles stable/distinct at 8/44.1 kHz; new acoustic profiles additionally checked across three registers.
- Six four-second PCM16 stereo/22050-Hz listening previews: checksums, exact duration/format, finite nonzero audio and FFmpeg true peaks verified. Highest true peak: -2.4 dBFS.
- Local manifest: `generated_beats/v110-listening-previews-001.json`. Audio retained: **2,117,064 bytes**. Reusable generator: `scripts/preview-sound-math.js` (protects existing outputs).

No user listening ratings have been supplied for these new previews.
