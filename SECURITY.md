# Security Policy

## Supported versions

At the moment, only the latest `main` branch is actively supported for security fixes.

## Reporting a vulnerability

Please do not open public GitHub issues for suspected vulnerabilities.

Instead, report privately via one of these channels:

- Security email (recommended): me@palmiye.dev
- Maintainer contact: open a private maintainer message if email is unavailable

Include:

- Affected component/path
- Reproduction steps or proof of concept
- Expected vs actual behavior
- Impact assessment
- Any suggested mitigation

## Response targets

- Initial acknowledgement: within 72 hours
- Triage decision: within 7 days
- Fix timeline: depends on severity and complexity

## Disclosure policy

- We follow coordinated disclosure.
- Please allow time for patching before public disclosure.
- After a fix, we may publish a postmortem/security advisory.

## Secret handling guidance

If a secret is exposed:

1. Revoke/rotate immediately.
2. Remove from repository history if committed.
3. Verify all environments are updated.
4. Document impact and remediation.

Reference runbook: `docs/secret-rotation.md`.
