import { clamp } from './random.js';

// Trapezoidal state-variable filter, Andrew Simper / Cytomic:
// https://cytomic.com/files/dsp/SvfLinearTrapOptimised2.pdf
// State is per voice; cutoff and Q can move without replacing filter history.
export class StateVariableFilter {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.ic1 = 0;
    this.ic2 = 0;
    this.band = 0;
  }
  process(input, cutoff, q = .707) {
    const g = Math.tan(Math.PI * clamp(cutoff, 10, this.sampleRate * .42) / this.sampleRate);
    const k = 1 / clamp(q, .35, 4);
    const v1 = (this.ic1 + g * (input - this.ic2)) / (1 + g * (g + k));
    const v2 = this.ic2 + g * v1;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.band = v1;
    return v2;
  }
}
