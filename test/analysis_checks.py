"""Small checks for the optional analysis worker; requires only Python stdlib."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('analyzer', Path(__file__).resolve().parents[1] / 'scripts/analyze_audio.py')
analyzer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analyzer)


class AnalysisChecks(unittest.TestCase):
    def test_half_and_double_tempo_remain_explicit_candidates(self):
        half = analyzer.tempo_relation(67.5, 135)
        self.assertEqual(half['raw_estimate_bpm'], 67.5)
        self.assertEqual(half['candidate_multiplier'], 2)
        self.assertTrue(half['within_three_percent_allowing_half_double'])
        double = analyzer.tempo_relation(270, 135)
        self.assertEqual(double['candidate_multiplier'], .5)
        self.assertEqual(double['adjusted_candidate_bpm'], 135)

    def test_bad_match_and_absent_tempo_are_not_passes(self):
        self.assertFalse(analyzer.tempo_relation(100, 135)['within_three_percent_allowing_half_double'])
        self.assertIsNone(analyzer.tempo_relation(0, 135))
        self.assertIsNone(analyzer.tempo_relation(135, None))

    def test_loudness_extracts_final_summary(self):
        output = SimpleNamespace(returncode=0, stderr='I: -70.0 LUFS\nI: -15.8 LUFS\nLRA: 6.8 LU\nPeak: -0.4 dBFS\n')
        with patch.object(analyzer.subprocess, 'run', return_value=output) as run:
            self.assertEqual(analyzer.loudness(Path('unused.mp3')), {
                'integrated_lufs': -15.8, 'loudness_range_lu': 6.8, 'true_peak_dbfs': -.4})
            args = run.call_args.args[0]
            self.assertEqual(args[args.index('-protocol_whitelist') + 1], 'file,pipe')
            self.assertLess(args.index('-protocol_whitelist'), args.index('-i'))

    def test_encoder_analysis_failure_remains_visible(self):
        with patch.object(analyzer.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stderr='bad audio')):
            self.assertEqual(analyzer.loudness(Path('unused.mp3')), {'error': 'bad audio'})


if __name__ == '__main__':
    unittest.main()
