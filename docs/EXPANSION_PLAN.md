# Music engine expansion plan

Scope: complete the additional instruments, synthesis methods, styles, forms,
grooves and production tools discussed after v1.6. Reuse existing implementations.
No downloads, dependencies, alternate checkouts or stored listening renders.
Existing untracked listening-evaluation work is outside this change.

## Priority and acceptance

1. **Arrangement foundation** — variable bars; pop, AABA, blues, rondo,
   theme/variation and extended club forms; independently named/layered parts;
   tempo/rubato/fermata and meter changes on one shared musical timeline.
   Verify section coverage, event bounds, vocals and preview/export timing.
2. **Sound generation** — wavetable, unison, multi-operator FM/PM, granular,
   spectral, wavefolding, phase distortion, sync, PWM, ring modulation,
   formants/vocoder; brass/reeds, free reeds, guitars, paired strings, sitar,
   membrane/plate percussion and choir. Improve existing articulation controls.
   Verify deterministic output, pitch behavior, finite samples and distinctions.
3. **Space and mixing** — room, hall, chamber, plate, spring, convolution,
   shimmer, reverse/gated/ducked reverb; per-part sends and buses, EQ,
   compression, dynamics, modulation, tape and oversampled saturation;
   shared-gain stems that reconstruct the mix.
   Verify impulse responses, dynamics, signal stability and stem reconstruction.
4. **Musical behavior** — motif transformations, harmonic rhythm, borrowing,
   secondary dominants, substitutions/modulation, bounded counterpoint;
   swing grids, groove templates, correlated humanization, tuplets,
   arbitrary N:M patterns, independent part cycles and idiomatic fills.
5. **Style coverage** — distinct presets for the remaining electronic, pop,
   African, Latin, jazz, country and classical subgenres; classifier examples
   and analysis descriptions. Verify every preset composes and renders.
6. **Release checks** — regression suite, new contract/integration tests,
   full preset signal checks, optional Python analysis checks, CLI dry runs,
   documentation and self-review. Commit only this task's changes.

The acoustic and genre models are procedural approximations. Acceptance means
working algorithms and observable musical behavior, not sample-library realism
or an assertion that a genre has one canonical equation.

## Status

Priorities 1–6 are implemented and verified. The final self-review covered short
forms, repeated-section vocals, tempo/meter edits, exclusions, parameter parsing,
shared stem headroom and preservation of unrelated untracked files.

Validation: 118 Node tests; complete audio renders for all 97 presets; 56 profile
stability checks at 8 and 44.1 kHz; 108 additional form/meter/tempo/vocal boundary
combinations; four standard-library analysis checks; three reference-analysis
checks in the existing local analysis NumPy/SciPy runtime; an independent
FFmpeg true-peak measurement; and git diff whitespace checks.

See EXPANSION.md for listening commands and explicit model/algorithm limits.
No dependencies, downloads, alternate checkout or stored listening collection
were added. The completed work is committed on sabcodex/complete-music-expansion.

## Next music-quality priorities

1. **Intent and Blueprint.** Implemented style selection and locking in desktop
   inspection. Explicit prompt constraints still apply. Checked instrument
   exclusions during style inference, short chord voicings, Hammond dancefloor
   and Caribbean groove cues, and odd-meter percussion cycles.
2. **Edit generated parts.** Implemented saved-score editing of individual
   drum hits, harmony, bass, leads, arps, and layered parts. Render a new
   audio and score pair from staged edits while preserving other score events.
3. **Arrangement development.** Implemented recurring lead motifs, related
   arpeggio responses, quieter handoffs, and a closing cadence for lead and
   default harmony parts. Compare matched full-track renders for repetition,
   transitions, and how the ending feels.
4. **Reference deconstruction.** Implemented local mix analysis and optional
   four-stem export via the cached Demucs model. Verified the estimated beat
   grid, bass pitch regions and section changes against two generated scores
   and compared the separated audio with Looper's original parts.
5. **Ensembles and articulation.** Soulful house adds short Rhodes replies to
   the Hammond. Dancehall gives organ or steelpan short offbeat chords and a
   palm-muted guitar reply. The main part leaves room for each reply on
   alternating bars. Explicit accompaniment and instrument choices take
   precedence. Compared both styles with matched seeds and playback loudness.
6. **Optional local LLM.** Implemented **Suggest direction** in the Blueprint.
   The existing Liquid LFM3 1.7B MLX model chooses a style or abstains. Looper
   filters the shortlist using generated scores so named parts have notes or
   hits. The choice is optional. Accepted styles use the existing Blueprint
   lock and the original prompt and seed. Matched listening pairs favored
   Liquid's depot and steelpan grooves. The closing-time take also had a
   preferred feel, with a missing rimshot part that prompted the guard.
7. **Solo and mute in the part editor.** Implemented temporary audition controls
   for editable parts, with a full-mix reset and playhead preservation.
8. **Reroll or prompt a soloed part.** Implemented seeded changes to sound,
   notes and rhythm, or both, plus prompts for instrument and phrasing changes.
   Compare in solo or preview in the full mix before saving an edited copy.
9. **Pedal-steel phrasing.** Implemented short pickups, sustained chord-tone
   replies, and bends against a held string. Rendered a matched A/B in solo
   and in the mix, with the same backing score and seed.

The Looper v2 beta build includes all nine priorities. Next, test the installed
app, fix any regressions found in testing, then work on the UI.
