import type { SimConfig, Weights } from '../types';

export const DEFAULT_WEIGHTS: Weights = {
  population: 1.0,
  hazard: 1.0,
  urgency: 1.5,
  information: 0.6,
  distance: 0.8,
  battery: 0.3,
  redundancy: 0.5,
};

export const DEFAULT_CONFIG: SimConfig = {
  seed: 42,
  droneCount: 6,
  sensorRange: 5,
  batteryCapacity: 750,
  speed: 8,
  survivorCount: 40,
  info: { geography: true, population: false, elevation: false, disaster: false },
  scenario: 'none',
  tsunamiImpactTime: 45,
  tsunamiRunupM: 12,
  weights: DEFAULT_WEIGHTS,
};
