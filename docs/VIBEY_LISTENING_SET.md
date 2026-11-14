# Vibey listening set - set4

The October 27, 2026 user attachment supplies 25 detailed palettes. Each has three
randomly selected, saved seeds: **75 previews**, 16 seconds each. The completed
set lives under `generated_beats/set4/`, with `listening.md` as the entry point.
The same effective prompt, key and tempo are used within a trio; seeds were not
rerolled to select winners. Source engine: v1.8, code behavior at `4f5c7af`;
the generation-time repository head was `8dfac6e`.

## What is retained

- 75 stereo MP3s at 44.1 kHz / 192 kbps.
- Full 32-bar scores as `.score.json.gz`, including all layered parts and applied
  vocal/choir gain transforms.
- Original supplied wording, edited prompts, seeds, declared approximations,
  actual profiles, source hashes, codec/loudness measurements and excerpt bounds.
- `audit.json` and `audit-relocated.json`, original-palette coverage findings,
  acoustic diagnostics, planned compositions and logs.

Existing audio was moved from the initial `vibey-75-001` folder to `set4` at the
user's request. Audio, score and manifest identities are unchanged. `relocation.json`
records the move and indexes `generation-tool.original.js`, preserving the exact
original generator before its future folder naming was changed. Catalogue links
were updated; the original run log still truthfully contains the earlier path.

The final folder uses about **32.4 MB total**, below the additional **45 MB** cap.
No full-length audio, intermediate WAVs, new models or runtimes were retained.
Speech temporary files used the project root's generated_beats/ and were cleaned.

## Voice and production choices

Every source specification names a lyric fragment. These use short, restrained
native speech/chops in one selected section; vocal velocity is scaled x0.4.
Wordless choir events use x0.35. The same prepared voice bank is reused within
each trio, controlling the native speech source while musical seeds vary.

Vocoder cases call the existing `vocode()` with an existing supersaw carrier.
Other examples use the supplied native voice, optional pitch shift, chopping
and existing vocal-bus room/hall/drive controls. These are procedural operations;
lyric-following singing, natural expressive chant and language-specific Latin
pronunciation are not claimed. Exact native speech bytes can vary when prepared
again; source hashes are retained.

## Declared adaptations and findings

- Unsupported 2/4 bluegrass/bossa requests use 4/4 with a two-beat feel.
- Botanica's unmetered drift uses held voicings and bounded rubato on 4/4.
- Exact custom section sequences, solo rotations and detailed dynamic trajectories
  use the closest existing club/pop/AABA/rondo/variations forms.
- Choir words are separate spoken approximations over wordless choir layers.
- Some listed legacy synth/bass combinations are not independently selected by
  the prompt compiler. Actual voices are inventoried instead of credited by name.

All **75 signal checks passed**. The adapted narrow requirements passed
**1142/1146** checks, with 71/75 cases passing every narrow check. These are not
whole-prompt accuracy or music-quality scores. All 25 trios have distinct note
fingerprints and controlled speech-bank hashes; different fingerprints do not
prove a perceptually better result.

The narrow misses are the absent distorted-analog layer in Industrial Bass
02A/B/C, where the metallic/Reese request wins, and a final ghost-snare tail in
Bossa 12C that exceeds the full-track boundary by about 69.3 ms and is clipped.
All event times are finite, and that final-bar tail is outside the saved preview.

A stricter inventory found 51/117 original listed synth-profile/articulation/
brush requests present across the relevant variants. It exposes absent legacy
layers, standard snares instead of requested brushes in Bossa/Country, and the
Synth Funk slap cue omitted by the first prompt adaptation. That last point is
an adaptation miss, not evidence that the engine lacks slap support. These
checks overlap and do not cover every musical request. See the saved findings
for exact cases. No human listening ratings have been assigned.

Encoded true peaks are at most -1.4 dBTP; measured loudness ranges -17.8 to
-15.9 LUFS. Matching only attenuates. Acoustic analysis of all 75 clips reused
the existing local Stem Splitter/librosa runtime without loading a semantic
model. Tempo/key estimates are diagnostics, not score-key or genre proof.

## Tools and replay

```sh
# Read existing results first.
node scripts/audit-vibey-set.js set4 audit-another-name.json

# A new render consumes another media budget; this is not an inspection command.
node scripts/generate-vibey-set.js set5
```

The audit writes a fresh JSON report and refuses overwrite. `audit.json` and
`audit-relocated.json` already exist. It verifies audio, compressed/uncompressed
scores, generation-source identity (including any recorded tool snapshot), saved
seeds and controlled speech-bank hashes. `data/vibey-75.json` is the replayable
input fixture. The generator uses its saved seeds, rather than generating new
random seeds on every replay.

Future generator runs create `setN/` subfolders, picking the next available
number by default or accepting an explicit unused set name. The 45 MB check is
per new batch and does not authorize another run; check actual storage/agreement.
The batch analyzer now uses the manifest's containing directory for its reports
and validates containment under generated_beats/. Existing flat batch manifests
remain supported. The existing four Python analysis checks passed, and actual
75-file nested-folder analysis completed successfully. Engine modules were not
changed for this listening set.
