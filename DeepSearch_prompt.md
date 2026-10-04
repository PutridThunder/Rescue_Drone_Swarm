# DeepSearch Prompt

DeepSearch should take an input of coordinates and a short description of the disaster scenario or desired search conditions, and output a JSON object that assigns float weights (up to 1 decimal place) to a drone search algorithm.

The goal is to estimate which priorities matter most for the target area and mission context, and then produce a relative set of weights for the following factors:
- Population
- Hazard
- Urgency
- Unsearched area
- Distance cost
- Battery cost
- Avoid overlap

## Input format

The input should include:

1. target coordinates in the form `lat, lon`
2. a description of the disaster scenario or the search goal, for example:
   - tsunami flood response
   - wildfire spread and evacuation support
   - coastal storm and ocean hazard monitoring
   - urban search and rescue after building collapse
   - environmental rescue and remote inspection

Example input:

```text
49.2827, -123.1207
Disaster scenario: tsunami warning in a dense coastal urban area with low-lying waterfront infrastructure and time-sensitive survivor rescue.
```

## Output format

Return only valid JSON with the following structure:

```json
{
  "coordinates": [49.2827, -123.1207],
  "scenario": "tsunami warning in a dense coastal urban area with low-lying waterfront infrastructure and time-sensitive survivor rescue",
  "weights": {
    "population": 0.8,
    "hazard": 0.9,
    "urgency": 0.9,
    "unsearched_area": 0.8,
    "distance_cost": 0.4,
    "battery_cost": 0.5,
    "avoid_overlap": 0.6
  }
}
```

## Rules

- Each weight must be a float between 0.0 and 1.0.
- Round values to 1 decimal place maximum.
- The weights must be relative to the given mission and location.
- Use the coordinates to infer local population density, hazard level, access constraints, and geographic pressure.
- Use the scenario text to infer urgency, time sensitivity, environmental dynamics, and mission objectives.
- Consider search coverage, risk reduction, route efficiency, battery preservation, and overlap minimisation.
- Output must be valid JSON only; no markdown fences, commentary, or explanatory text outside the object.

## Example

Input:
```text
49.2827, -123.1207
Disaster scenario: coastal urban tsunami warning, dense population, urgent survivor rescue, flood risk, and limited route safety.
```

Output:
```json
{
  "coordinates": [49.2827, -123.1207],
  "scenario": "coastal urban tsunami warning, dense population, urgent survivor rescue, flood risk, and limited route safety",
  "weights": {
    "population": 0.8,
    "hazard": 0.9,
    "urgency": 0.9,
    "unsearched_area": 0.8,
    "distance_cost": 0.4,
    "battery_cost": 0.5,
    "avoid_overlap": 0.6
  }
}
```

## Prompt to use directly

DeepSearch should take an input of coordinates in the form "lat, lon" and a brief description of the disaster scenario or desired search conditions. It should output JSON that gives float weights (up to 1 decimal place) to a drone search algorithm. The parameters represent the prioritisation of the following factors: Population, Hazard, Urgency, Unsearched area, Distance cost, Battery cost, Avoid overlap.

Return only valid JSON in this exact structure:

{
  "coordinates": [<latitude>, <longitude>],
  "scenario": "<disaster scenario or desired search conditions>",
  "weights": {
    "population": <float>,
    "hazard": <float>,
    "urgency": <float>,
    "unsearched_area": <float>,
    "distance_cost": <float>,
    "battery_cost": <float>,
    "avoid_overlap": <float>
  }
}

Rules:
- each weight must be a float between 0.0 and 1.0
- round to at most 1 decimal place
- use the coordinates and scenario to infer local risk, density, urgency, coverage gaps, route cost, battery constraints, and overlap avoidance
- prioritise the mission according to the scenario, not just the raw geography
- do not include any text outside the JSON object
