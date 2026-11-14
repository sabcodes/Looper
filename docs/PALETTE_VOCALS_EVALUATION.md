# Instrument and vocal evaluation — 25 prompts

Run date: 2026-10-27. Batch: `palette-vocals-001`. The captured working-tree engine identified itself as **1.6.0**. Another agent was still developing genres/instruments; this is a frozen development snapshot, not a release certification.

## Scope and playback

All 25 original requests and expanded prompts are retained in `data/palette-vocals-25.json`, along with supplied short lyrics, hooks, voice settings, expectations and explicit gaps. The attachment supplied vocal directions for 15 examples; these were aligned with the original 25-case numbering. Lyrics were shortened for the existing phrase slots; extra short English phrases were added where useful. Seventeen examples have native speech vocals, eight remain instrumental. Ambient cafe chatter was not replaced with a foreground singer.

Local artifacts (ignored by Git) are under `generated_beats/`:

- `palette-vocals-001.listening.md`: all 25 previews, prompts, lyrics, interpretation comparisons and misses.
- `palette-vocals-001.manifest.json`: measured loudness, exact settings, checks and source/audio hashes.
- `palette-vocals-001.audit.json`: output verification and vocal boundary probes.
- `palette-vocals-001.diagnostics.json`: existing Stem Splitter/librosa tempo/key and spectral diagnostics.
- `palette-vocals-001.sources/`: small exact source snapshot, including the separate vocal implementation.

Each MP3 is 16 seconds, 44.1 kHz stereo at 192 kbps. Full 32-bar scores are retained as compact JSON; full-track audio was not retained. Most excerpts begin at bar 20. Case 04 includes eight seconds before and after the drop. The artifacts use about **13.8 MB total**, within the approved additional 25 MB. No models, runtimes or dependencies were downloaded.

## What passed

- All 25 outputs passed duration/format, non-silence and true-peak checks; maximum true peak was -2.1 dBTP. Loudness ranged from -19.9 to -16 LUFS; attenuation-only matching does not make every clip equally loud.
- 111/130 observable requirements passed; 12/25 cases passed every narrow requirement. These are settings/event/signal results, not musical-quality scores or full-prompt success rates. Twenty-three cases retain capability gaps or listening questions.
- Six new-preset probes (deep house, speed garage, trap, Afro house, liquid D&B, country) selected the expected presets and rendered deterministic non-silent audio.
- All 21 registered instrument profiles rendered deterministic non-silent isolated notes. The main 25 examples do not individually request every new preset/instrument.
- 156 scheduling probes covered 13 voices × six new genres × two tempo extremes (40/240 BPM), including repeat plans, boundaries, air pockets, density zero and vocals off.
- Seventeen vocal previews contain nonzero vocal energy when isolated; the prepared-bank vocal renders replayed exactly. Eight instrumental bridge renders matched the original renderer byte for byte. These checks do not establish vocal intelligibility or realism in the full mix.

## Interpretation and capability findings

Preserve the original and expanded prompt results separately: cases 02, 04, 06, 07, 10, 13, 17, 20 changed primary style after expansion. Adding musical/vocal adjectives can redirect interpretation even though lyrics themselves are supplied separately.

| Case | Captured result | Follow-up for the appropriate owner |
| --- | --- | --- |
| 01 | Sunny beach ask selects bright house/piano; no ukulele | Keep the missing acoustic-pop/ukulele intent visible rather than treating generic brightness as complete success |
| 06 | Original study ask selects lo-fi; expanded version becomes deep house at 122 BPM | Instrument words should not overwhelm focus/chill intent; 110 BPM is a development preference in this fixture, not a universal limit for study music |
| 07 | Acoustic guitar is present, style remains jazz | Indie/pop preference is still relevant; ambient chatter remains absent |
| 10 | Country becomes neutral after vocal/style expansion | Preserve folk identity; single speech voice is not a harmonized duet or fingerpicked performance |
| 12 | 3/4 works, but accordion waltz becomes industrial bass | Missing accordion and waltz style must not be credited as covered |
| 13 | Delta blues changes from country to baile funk | Genre interpretation miss; resonator/slide profile and blues performance are absent |
| 14 | Trap works, only flute wins the lead role | No independent fiddle+flute ensemble; one instrument per role is a real limitation |
| 15 | Industrial techno works, plural church organs does not select organ | Improve instrument-name parsing separately from building new instruments; opera remains unavailable |
| 16 | Electro works; shamisen/taiko absent | Retain explicit unsupported-instrument gaps |
| 17 | Thriller expansion becomes synth-pop; 132 lead events despite no pop lead hook | Negation and cinematic style miss; string clusters and low brass braams are absent |
| 18 | Strings present; orchestral brass and real choir absent | Speech pulses are not a choral or orchestral climax |
| 19 | Solo grand-piano/no-drums/no-bass checks pass | Fixed grid does not implement rubato; short delay does not establish concert-hall acoustics |
| 20 | Ukulele/glockenspiel request becomes classical acoustic piano | Instrument absence and acoustic-indie style mismatch |
| 21 | F# major, 128 BPM, pad role, lead and four-on-floor work | Bass sidechain exists; pad sidechain is absent; sung belt is absent |
| 22 | Liquid D&B, 174 BPM, D minor, Rhodes and kick variation work | Requested glides produce zero gliding bass events |
| 23 | 7/8 and 140 BPM work; guitar becomes generic acoustic guitar | No tapping model; generic polyrhythmic language does not activate the explicit groove control |
| 24 | Organ and 85 BPM work; primary style is bassline | E-flat minor incorrectly becomes C minor; swung live drums remain straight (50) |
| 25 | B minor/115 BPM/synth-pop/bass/drums and hook scheduling work | Native robotic speech is appropriate to audition; full verse-chorus songwriting is not implemented |

Existing acoustic diagnostics analyzed all 25 clips without loading a semantic model. Tempo estimates disagree by over 3% even allowing half/double in cases 10, 11, 13, 14, 22. These are diagnostic listening flags; syncopated patterns and speech can confuse the estimator. Key estimates from a short mixed-audio excerpt are not reliable evidence that the score key is wrong. The case 24 root failure above comes from the actual parsed configuration.

## Integration and reproducibility

The main working-tree CLI did not yet include the vocal branch. The evaluation snapshots the current source plus `src/vocals.js`, `speech.js` and `vocal-pitch.js` from `.worktrees/vocals`. In memory only, it inserts the existing `mixVocals` call after instrumental effects and before shared automation/mastering, allows vocal stem selection, and redirects temporary speech files into the root `generated_beats/`. Guarded string matches fail if those integration seams change. Production modules and the other worktree were not modified or merged.

The seed fixes composition and vocal placement. Native macOS speech bytes can vary across runs; sample hashes and runtime information are saved, but the speech sample bank is not retained. Exact audio replay requires the same prepared buffers. The fixed 4/4 vocal scheduler is not used on the instrumental 3/4 and 7/8 cases.

Before capture, `npm test` in the actively edited main tree reported 64/66 passing: an IDM prompt resolved to sgija, and call-and-response bass wording changed drums. Those results are recorded as a time-specific baseline, not a claim about the later working tree or the complete frozen snapshot.

## Commands

```sh
node scripts/evaluate-palette-vocals.js
node scripts/audit-palette-vocals.js palette-vocals-001
```

The generator creates a new batch; it does not overwrite existing audio. Each new render is another media write and needs an agreed budget. The local vocal worktree is required until real integration replaces the evaluation bridge. Audit is read-only apart from its small fresh report and refuses to overwrite an existing audit. Instrument building, parser fixes, additional arrangements, merges and new media batches are follow-up work owned separately.

Human listening ratings remain blank. No instrument or genre implementation was changed for this evaluation.
