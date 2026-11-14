# Sound and mathematics expansion

Authorized 2026-10-29: cover all gaps from the linked-reference review. Preserve existing profiles and user sound/phrasing preferences. No new runtime dependencies, models, alternate checkout or duplicated audio library.

## Priority and acceptance checklist

1. Tuning: adjustable concert pitch; just, Pythagorean, meantone, EDO and Scala ratio/cents scales; shared frequency conversion in every melodic renderer, including slides.
2. Excitation and resonance: pluck/strike/bow/pickup position, hammer width/hardness, stiffness; material/body resonators and shared sympathetic response. Preserve the existing sound when controls are absent.
3. Sound design: validated envelopes and routing for LFO, envelope, velocity, pressure and seeded random modulation; editable partials and spectra; FM algorithms, feedback and operator envelopes; ladder and diode filters.
4. Sources and voices: imported-buffer granular synthesis, independent traversal/pitch and duration; separate vocal time/formant transformation; FOF/VOSIM, scanned synthesis, GENDY, Shepard/Risset and colored noise.
5. Instruments: all 37 named gaps from the review, with distinct material, excitation, resonance or performance parameters; no duplicate alias-only profiles.
6. Composition: wider scales with arbitrary degree counts, explicit extended-chord voicings, second-order melodic probabilities and phrase-level leap/cadence constraints. Preserve default accompaniment and seed behavior.
7. Verification: analytical tuning/partial/filter checks; seeded determinism; validation rejection; profile stability across rates/registers; score-to-audio and CLI integration; complete regression suite and existing Python checks.
8. Delivery: document exact controls, examples and approximation limits; update project Obsidian references; commit only task changes. Listening examples should reuse the existing generated_beats location and stay small.

External design references: https://aatishb.com/stringmath/ ; https://www.dsprelated.com/freebooks/pasp/Commuted_Synthesis.html ; https://www.huygens-fokker.org/scala/scl_format.html ; https://csound.com/manual/siggen/additive/ ; https://csound.com/docs/manual/SiggenScanTop.html ; https://csound.com/docs/manual/gendy.html ; https://csound.com/manual/opcodes/hsboscil/ ; https://csound.com/manual/opcodes/vosim/ . Instagram reels and AMS page were unavailable; no claims are made about their contents. Ripon paper was only partially available through search.

## Completion evidence

All eight implementation/delivery areas are covered in v1.10; exact options and approximation limits are in `SOUND_MATH.md`. Verification: 149 Node tests, 7 Python checks, six measured listening previews, no failures. The Obsidian supplement records the code commit and current profile/algorithm inventory. Existing unrelated listening-set files are excluded from the task commits.
