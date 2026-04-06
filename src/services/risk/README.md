# Risk Services

This domain contains scoring and risk synthesis logic that multiple surfaces depend on.

## Responsibilities

- threat/risk scoring
- country instability and convergence style logic
- bridge between raw events and operator risk posture

## Design note

This is where scoring contract drift tends to show up. When a risk panel looks wrong, inspect this domain before changing presentation code.
