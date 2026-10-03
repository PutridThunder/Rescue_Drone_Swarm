import type { SimConfig, Weights } from "../types";

export const DEFAULT_WEIGHTS: Weights = {
  population: 1.0,
  hazard: 1.0,
  urgency: 3,
  information: 0.6,
  distance: 0.8,
  battery: 0.3,
  redundancy: 0.5,
};

export const DEFAULT_CONFIG: SimConfig = {
  seed: 42,
  droneCount: 6,
  truckCount: 2,
  flightAltitudeM: 20,
  sensorRange: 4,
  batteryCapacity: 1500,
  speed: 6,
  survivorCount: 25,
  info: {
    geography: true,
    population: false,
    elevation: false,
    disaster: false,
    crowds: false,
  },
  scenario: "none",
  tsunamiImpactTime: 60,
  tsunamiRunupM: 12,
  weights: DEFAULT_WEIGHTS,
};
