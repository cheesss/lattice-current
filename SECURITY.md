# Security Policy

## Supported versions

Only the latest version on `main` is actively maintained.

## Reporting a vulnerability

Do not report security issues through public issues.

Report vulnerabilities through:

- GitHub private vulnerability reporting on the current repository
- direct contact with the repository owner through GitHub

## Security scope

In scope:

- vulnerabilities in this repository
- secret leakage
- XSS or content injection through external content
- SSRF, auth bypass, or unsafe proxy behavior
- desktop sidecar auth or capability bypass

Out of scope:

- third-party provider vulnerabilities
- social engineering
- denial-of-service testing
- fork-specific deployment mistakes outside this repository

## Repository-specific notes

- no secrets should be committed
- environment variables should be required for sensitive services
- NAS and local historical pipelines must not silently fall back to hardcoded credentials
- if a security hardening change alters behavior, update the docs that describe that behavior
