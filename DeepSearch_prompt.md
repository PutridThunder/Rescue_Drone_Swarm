# DeepSearch Prompt

DeepSearch should take an input of coordinates and output a JSON object. The purpose of the parameters is to assign float weights (up to 1 decimal place) to a drone search algorithm that prioritizes areas to search.

The output should be a JSON object with priority weights for the following factors:
- Population
- Hazard
- Urgency
- Unsearched area
- Distance cost
- Battery cost
- Avoid overlap

## Goal

Use the given coordinates to estimate which search priorities matter most for that area and assign a float weight to each factor. The weights should reflect relative importance in a drone-based area search decision model.

## Input format

The input is a coordinate pair such as:

```text
lat, lon
```

Example:
```text
49.2827, -123.1207
```

## Output format

Return only valid JSON with the following shape:

```json
{
  "coordinates": [49.2827, -123.1207],
  "weights": {
    "population": 0.8,
    "hazard": 0.6,
    "urgency": 0.9,
    "unsearched_area": 0.7,
    "distance_cost": 0.4,
    "battery_cost": 0.5,
    "avoid_overlap": 0.6
  }
}
```

## Rules

- Use a float value for each weight.
- Keep each weight between 0.0 and 1.0.
- Round each value to 1 decimal place maximum.
- The weights should be relative to each other, not absolute probabilities.
- Consider the area's population density, danger, urgency, coverage gaps, travel constraints, energy constraints, and need to spread searches rather than duplicate effort.
- The output must be valid JSON only, with no markdown fences, commentary, or explanations.

## Example

Input:
```text
49.2827, -123.1207
```

Output:
```json
{
  "coordinates": [49.2827, -123.1207],
  "weights": {
    "population": 0.8,
    "hazard": 0.7,
    "urgency": 0.9,
    "unsearched_area": 0.8,
    "distance_cost": 0.4,
    "battery_cost": 0.5,
    "avoid_overlap": 0.6
  }
}
```

## Prompt to use directly

DeepSearch should take an input of coordinates in the form "lat, lon" and output JSON. The intention of the parameters is to give float weights (up to 1 decimal place) to a search algorithm for drones that will be searching an area. Priority weights: Population, Hazard, Urgency, Unsearched area, Distance cost, Battery cost, Avoid overlap. Return only valid JSON in this exact structure:

{
  "coordinates": [<latitude>, <longitude>],
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
- make the values relative to the specific area being searched
- use the coordinates to infer local risk, density, access, coverage gaps, and travel constraints
- prioritize based on population density, danger, urgency, coverage gaps, travel cost, battery efficiency, and overlap reduction
- do not include any text outside the JSON object
