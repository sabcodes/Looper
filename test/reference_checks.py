"""Optional-analysis checks; run with the existing music-analysis Python runtime."""
import importlib.util
from pathlib import Path
import sys
import unittest
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from deconstruct_audio import RATE, SOURCES, activity_and_changes, bass_phrases, beat_grid, separate
spec=importlib.util.spec_from_file_location('references',Path(__file__).resolve().parents[1]/'scripts/study_references.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ReferenceChecks(unittest.TestCase):
    def test_window_selection_finds_sustained_low_section(self):
        rate=8000;t=np.arange(48*rate)/rate
        y=.002*np.sin(2*np.pi*700*t)
        active=(t>=20)&(t<36)
        y[active]+=.4*np.sin(2*np.pi*65*t[active])
        best,_,_=module.select_windows(y,rate)
        overlap=max(0,min(best['start']+16,36)-max(best['start'],20))
        self.assertGreaterEqual(overlap,12)

    def test_frame_energy_is_well_defined(self):
        energy=module.frame_rms(np.ones(8000),8000)
        self.assertTrue(np.isfinite(energy).all())
        self.assertAlmostEqual(float(np.median(energy)),1)

    def test_offbeat_summary_keeps_beat_grid_dependency(self):
        beats=np.arange(0,6,.6)
        off=module.onset_summary([.3,.9,1.5,2.1],beats)
        on=module.onset_summary([.6,1.2,1.8,2.4],beats)
        self.assertEqual(off['offbeat_fraction'],1)
        self.assertEqual(on['offbeat_fraction'],0)
        self.assertIsNone(module.onset_summary([],beats)['offbeat_fraction'])

    def test_deconstruction_timing_preserves_original_audio_offset(self):
        rate, offset = RATE // 4, 5.25
        t = np.arange(8 * rate) / rate
        drums = np.zeros_like(t)
        attack = np.arange(300) / rate
        for start in np.arange(.25, 7.8, .5):
            frame = round(start * rate)
            drums[frame:frame + len(attack)] = np.sin(2 * np.pi * 880 * attack) * np.exp(-120 * attack)
        grid = beat_grid(drums, offset)
        self.assertAlmostEqual(grid['bpm'], 120, delta=1)
        self.assertGreater(len(grid['times_seconds']), 10)
        for beat in grid['times_seconds']:
            self.assertAlmostEqual((beat - offset - .25) * 2, round((beat - offset - .25) * 2), delta=.12)

        bass = np.zeros_like(t)
        for start, hz in [(1, 55), (3, 73.416), (6, 82.407)]:
            on = (t >= start) & (t < start + .7)
            bass[on] = .4 * np.sin(2 * np.pi * hz * (t[on] - start))
        regions = bass_phrases(bass, offset)
        self.assertEqual([region['midi'] for region in regions], [33, 38, 40])
        for region, start in zip(regions, [1, 3, 6]):
            self.assertAlmostEqual(region['start_seconds'], offset + start, delta=.05)
        self.assertEqual(beat_grid(np.zeros_like(t), offset), {'bpm': None, 'times_seconds': []})
        self.assertEqual(bass_phrases(np.zeros_like(t), offset), [])

    def test_deconstruction_detects_sustained_part_changes(self):
        stems = {name: np.zeros((2, 10 * RATE)) for name in SOURCES}
        stems['drums'][:, :5 * RATE] = .35
        stems['bass'][:, 5 * RATE:] = .35
        windows, changes = activity_and_changes(stems, 3.5)
        self.assertEqual(windows[0]['active'], ['drums'])
        self.assertEqual(windows[-1]['active'], ['bass'])
        self.assertEqual([change['time_seconds'] for change in changes], [8.5])

    def test_missing_checkpoint_fails_before_loading_model(self):
        path = Path(__file__).parent / 'no-checkpoints'
        with self.assertRaisesRegex(ValueError, 'checkpoint missing'):
            separate(np.zeros((2, RATE), dtype=np.float32), path)


if __name__=='__main__':unittest.main()
