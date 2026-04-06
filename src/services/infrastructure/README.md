# Infrastructure Client Services

This domain handles internet outages, service health, and anomaly-related client logic.

## Responsibilities

- shape outage and status feeds for panels and map overlays
- compute anomaly/baseline-related client summaries
- feed service-status driven operator views

## Common risks

- stale service data still looking “ready”
- anomaly state being confused with simple service outages
