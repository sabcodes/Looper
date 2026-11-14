# Expanded palette listening evaluation — cases 26–45

Rendered on 2026-10-27 from merged main at 54d9e133c3444b5deb7745b83a725bdb8367fde8, using the integrated instrumental and vocal APIs. No engine modules or intent training data were changed.

Twenty 16-second stereo MP3 previews at 44.1 kHz / 192 kbps are retained in generated_beats/ with exact prompts, seed values, SHA-256 hashes, audio measurements, full 32-bar gzip-compressed JSON scores and acoustic diagnostics. Full arrangements were rendered in memory before excerpting. No full-length WAV or MP3 copies were retained.

Sixteen examples are instrumental. Cases 26, 36, 37 and 45 each have one brief spoken phrase at the drop, no chops or stutters, and vocal velocity scaled by 0.4 (about -8 dB before shared mastering). The complete modified event plan is saved in the score. Native speech sample hashes are saved; speech bytes themselves are not guaranteed reproducible by seed. Mixing a fixed prepared bank was verified deterministic in all four cases.

## Verification

- Merged-main regression suite: 102 passed, zero failures.
- Preview signal checks: 20/20 passed format/duration, non-silence and true-peak headroom checks.
- Structural requirements: 180/181 passed; 19/20 cases pass every narrow check.
- Full score gzip checksums, decompressed JSON hashes, audio hashes, prompt/seed identity and current source hashes were independently verified.
- Acoustic diagnostics analyzed all 20 clips using the existing local Stem Splitter/librosa tooling. No semantic model, runtime or dependency was downloaded.
- Maximum true peak: -1.7 dBTP. Preview loudness: -17.4 to -16 LUFS. Matching only attenuates, so playback levels are not identical.

## Remaining findings

| Case | Result | Interpretation |
| --- | --- | --- |
| 26 | Sunday dancefloor / Hammond / electric bass becomes jazz at 80 BPM | Instrument checks pass, but the desired soulful dancefloor feel still needs review |
| 33 | 5/4 and 128 BPM work, but cycleSteps is null | Natural wording “percussion cycle of 15 steps” is not accepted by the narrower cycle grammar; audio is preserved as requested |
| 36 | Intimate kalimba / electric-bass groove becomes classical at 80 BPM | Timbres are selected, but the intended R&B/downtempo pocket may be missing |
| 42 | Caribbean courtyard / steelpan / bongos becomes Jersey club at 138 BPM | Requested instrument presence does not establish Caribbean groove fidelity |

All 17 explicitly named primary genres matched their expected preset. The three vague cases deliberately do not assert one exact genre, so the high structural pass count must not be treated as an overall prompt-following or music-quality score. No human listening ratings have been assigned.

The 5/4 test keeps BPM as quarter notes. The trance example verifies the eight-bar build. Instrument/kit checks, the 3-against-2 percussion counts, acid slides, 2-3 clave direction, cowbell exclusions, conga/clap exclusions and the four light-vocal plans are recorded individually in the manifest.

## Local artifacts and replay

- generated_beats/expanded-20-001.listening.md
- generated_beats/expanded-20-001.manifest.json
- generated_beats/expanded-20-001.prompts.json
- generated_beats/expanded-20-001.audit.json
- generated_beats/expanded-20-001.diagnostics.json

The source fixture is data/expanded-palette-20.json and the runner is scripts/generate-expanded-listening-set.js. The runner records the vocal velocity transform explicitly. Running it again creates another audio batch and consumes more disk; the existing approved budget must still be respected. Existing earlier listening sets are preserved. The new batch adds approximately 8.4 MB; together with palette-vocals-001, retained evaluation files remain below the approved 25 MB total. Speech temporary files stayed under generated_beats/ and were cleaned up.

Read a full score without creating a decompressed copy using:

    gunzip -c generated_beats/expanded-20-001-29.score.json.gz
