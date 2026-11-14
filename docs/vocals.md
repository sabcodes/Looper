# Vocal generation

The optional vocal layer speaks supplied English words in the local macOS voices: **Zarvox** (default), **Ralph**, **Fred**, **Trinoids**, **Whisper**, **Albert**, **Junior**, **Kathy**, **Boing**, **Samantha**, **Karen**, **Moira**, or **Tessa**. It schedules phrases, repeats a hook, creates word chops and build stutters, and leaves space around transitions. No model, runtime, npm package or voice is downloaded. Vocal rendering requires macOS with the selected voice already available and the existing FFmpeg installation, including when exporting WAV. Instrumentals retain their original dependency requirements.

From this checkout:

```sh
./bin/makebeats.js "dark house in F minor at 125bpm" \
  --lyrics "Move your body. Feel the rhythm. Stay with me." \
  --hook "Move your body" \
  --vocals auto --vocal-density 0.75 --vocal-chops 0.8 \
  --seed 42 --preview 16 --json --output vocals-demo
```

`--lyrics` enables vocals automatically. Separate phrases with sentence punctuation, newlines, semicolons, `/`, or `|`. Quote the complete text in the shell. Punctuation divides phrases; words are normalized to lowercase English letters/numbers, apostrophes and internal hyphens. The hook defaults to the first phrase; a custom hook can introduce additional words. This version accepts up to 1200 lyric characters, 16 lyric phrases, 32 words per phrase, 200 hook characters and 96 unique words including the hook. Use `--voice NAME` (case-insensitive). The thirteen supported names in the table below are Apple system voices accessed through `/usr/bin/say`. The backend does not install voices or model assets. To list available macOS voices, run `say -v "?"`. Missing voices must already be installed by the user; the generator does not download them. Lyrics are supplied by the caller; the engine does not write lyrics.

| Control | Meaning |
| --- | --- |
| `--vocals auto\|off` | Generate the arrangement, or render the same instrumental without vocals. |
| `--voice NAME` | Select `zarvox`, `ralph`, `fred`, `trinoids`, `whisper`, `albert`, `junior`, `kathy`, `boing`, `samantha`, `karen`, `moira` or `tessa`; default Zarvox. |
| `--vocal-pitch N` | Transpose -24 to +24 semitones while preserving word frame counts. Use `--vocal-pitch=-5` for a negative value. |
| `--vocal-note NOTE` | Shift estimated voiced pitch center to a note such as F3/C#4, or `root` for the nearest octave of the song root. |
| `--vocal-range LOW:HIGH` | Move the estimated pitch center into a register such as C3:C4. |
| `--hook TEXT` | Recognizable phrase used in the breakdown, build and drop. |
| `--vocal-density 0..1` | Probability of optional phrases, teasers and build hits; default 0.45. Zero silences every vocal. At nonzero density, verse/breakdown/build/drop retain their opening call. |
| `--vocal-chops 0..1` | Probability of answering chops; default 0.55. Zero disables chops and stutters. Nonzero enables density-controlled build repeats, with sixteenths at 0.7 and above. |
| `--vocal-every 1\|2\|4\|8` | Phrase opportunity interval in verse, breakdown and drop; default four bars. Density may skip later opportunities. Intro/outro and build use their own transition patterns. |
| `--vocal-section NAME` | Restrict vocals to `intro`, `verse`, `breakdown`, `build`, `drop` or `outro`; default `auto` includes all sections. |
| `--dry-run` | Inspect the complete seeded event plan without invoking speech synthesis or writing files. |

## Arrangement

Bar numbers here are human-facing (1–32); score bars remain zero-based. The following is the default layout. Trance presets use the longer build recorded in the score's sections. Vocal placement uses the actual steps per bar in all eight supported meters, with a quarter-note vocal gap before the drop.

- Intro (1–4): optional quiet hook-ending teaser in bar 3.
- Verse (5–12): cycle through supplied phrases, with optional word answers when repeat spacing leaves room.
- Breakdown (13–16): exposed hook, no chop answers.
- Build (17–20): hook first, then density-controlled quarter/eighth/sixteenth word stutters. The final beat before the drop has no vocals or vocal echo, even with sauce zero.
- Drop (21–28): hook at entry, optional later repeats and word chops. Garage answers start offbeat; footwork, Jersey and IDM use faster answers.
- Outro (29–32): optional quiet final-word teaser in bar 31, followed by vocal silence.

Vocal events never overlap each other. Full phrases receive at most two bars and never cross their repeat interval or section boundary. Short phrases retain their speaking speed. A phrase that exceeds its slot can be resampled up to 1.8× speed, changing pitch along with speed; longer phrases fail with a request to shorten the text or lower the tempo. This is robotic speech and rhythmic chopping, not melody-following singing or syllable-aligned rap.

Each needed word is synthesized **once per render**, trimmed, level-adjusted and kept in memory. Full phrases concatenate those words with short gaps. This provides exact word boundaries and deliberately segmented robotic delivery. Chops replay or gate the actual generated word buffers; short fades reduce clicks. There is no phoneme/syllable boundary detector. Quiet stereo echoes are clipped to each event's reserved window. All vocals then pass through the existing full-mix stutters, tape brake, air-pocket muting, normalization and edge fades.

## Pitch and female voices

Kathy, Samantha, Karen, Moira and Tessa provide native female-voiced starting points. All five were listed and successfully synthesized locally on the development Mac; availability still depends on the user's installed macOS voice assets. Select one with `--voice samantha`, for example.

Pitch controls are mutually exclusive. No pitch option leaves the original speech unchanged. A semitone shift works even on unvoiced/noisy material. Note and range modes estimate a median pitch center from periodic speech frames, then apply one global transposition to the word bank. Automatic modes measure the processed bank and can refine the shift twice using the original buffers. Range targets sit slightly inside a boundary when space permits. Residual error is recorded; these remain approximate speech-register controls. They preserve the speech's intonation contour; they do not quantize each syllable to the scale, create singing, or guarantee every instantaneous pitch lies inside a range. Whispered, noisy and polyphonic voices may have no stable fundamental; use `--vocal-pitch` when note/register estimation fails. Notes use scientific notation (C4 = middle C), between C2 and C6. Automatic note/register shifts are also limited to 24 semitones.

```sh
# Higher register, same word lengths and arrangement:
./bin/makebeats.js "house in F minor 125bpm" --lyrics "Feel the rhythm" --voice fred --vocal-pitch 5 --output fred-high

# Native female voice, estimated pitch center near F3:
./bin/makebeats.js "house in F minor 125bpm" --lyrics "Feel the rhythm" --voice samantha --vocal-note F3 --output samantha-f3

# Move the estimated center into a register:
./bin/makebeats.js "house" --lyrics "Feel the rhythm" --voice fred --vocal-range C4:C5 --output fred-register
```

The local pitch tool uses FFmpeg's sample-rate shift, resampling and tempo compensation (`asetrate`, `aresample`, chained `atempo`), with padding/trim to preserve exact word frame counts. It rebuilds phrases from the shifted words, so phrase/chop timing remains consistent. These filters are available in the existing FFmpeg installation; no Rubber Band library or other runtime is installed. See the [FFmpeg filter reference](https://ffmpeg.org/ffmpeg-filters.html#asetrate).

This shifts both pitch and vocal resonance/formant frequencies. Raising a male-voiced source can produce a brighter or smaller-sounding voice, sometimes a chipmunk effect; it does not guarantee a natural female timbre. Native female voices give another starting point. Large shifts and short consonants can expose time-stretch artifacts. Existing overlong phrase fitting can additionally speed up a phrase (up to 1.8×), which shifts pitch further; use short phrases when targeting a register.

For a matched comparison, prepare an unpitched bank once and reuse it:

```js
import { compose, prepareVocalSamples, pitchVocalSamples } from './src/index.js';
const options = { lyrics: 'Feel the rhythm', voice: 'fred' };
const originalScore = compose('house', options);
const raw = await prepareVocalSamples(originalScore);
const higherScore = compose('house', { ...options, vocalPitch: 5 });
const higher = await pitchVocalSamples(higherScore, raw);
// renderAudio(higherScore, { vocalSamples: higher });
```

`pitchVocalSamples` expects an unprocessed bank of the same voice; it returns new buffers and leaves the original unchanged. The result records applied semitones, input hashes, output hashes and, for automatic modes, estimated/target/achieved Hz, residual cents, refinement count and the number of voiced frames. The CLI writes pitch-result metadata into exported score JSON. `--dry-run` records the requested settings without synthesizing or estimating pitch.

## API and reproducibility

```js
import { compose, prepareVocalSamples, renderAudio } from './src/index.js';

const score = compose('house 125bpm', {
  seed: 42,
  voice: 'ralph',
  lyrics: 'Move your body. Feel the rhythm.',
  hook: 'Move your body',
  vocalDensity: 0.75,
  vocalChops: 0.8,
  vocalEvery: 4,
  vocalSection: 'auto',
});
const vocalSamples = await prepareVocalSamples(score, { sampleRate: 44100 });
const mix = renderAudio(score, { vocalSamples });
const vocals = renderAudio(score, { vocalSamples, voices: ['vocals'] });
```

Use matching sample rates for preparation and rendering. Excluding `vocals` through `voices` does not require prepared speech. Density zero also needs no speech. Stem renders normalize independently, as the existing API does; they are listening/analysis tools rather than additive stems.

Arrangement decisions use the independent `vocals:arrangement` PRNG stream. The same seed/settings/engine produce the same plan; instrument events and instrumental PCM remain unchanged when vocals are disabled or excluded. Native speech bytes can vary between successive runs on the same Mac; macOS, installed voice and FFmpeg versions can also affect them. The seed controls placement and chopping, not the native speech synthesizer. Exported score JSON records source sample hashes and native runtime information after synthesis; dry-run JSON contains only the plan. Given the same prepared buffers, vocal mixing is deterministic. Temporary `.speech-*` directories live under this checkout's `generated_beats/` and are removed on success or caught failure; a forcibly killed Node process can leave one behind. Nothing is installed or cached outside the project.

## Integration

Vocal scheduling shares the score's section boundaries and meter with the v1.6
instrument arranger. Both vocals and supplemental percussion can be isolated
through the renderer's `voices` selection. Vocal arrangement uses an independent
random stream and does not change instrumental notes or sound when disabled.

Implementation files include `src/vocals.js`, `src/speech.js` and
`src/vocal-pitch.js`; shared integration points are in composition, rendering,
exports and the CLI. Tests cover the original 4/4 behavior and every preset in
all supported meters, including the longer trance build.

Run `npm test` for instrumental and vocal regressions. Native speech tests run on macOS when FFmpeg is available; other platforms still exercise scheduling, buffer mixing, silence and CLI planning using deterministic test buffers.
