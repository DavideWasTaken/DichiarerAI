# Security

## Reporting

Please report a vulnerability privately through GitHub's security advisory interface for this repository. Do not include real tax records, API keys, or other personal data in a report.

## Security model

- Provider credentials remain in the extension service worker and local Chrome storage.
- The side panel requires fresh consent before each transmission.
- Web search is limited to official Italian Revenue Agency domains.
- Proposed field IDs, values, and sources are validated locally.
- The active tab, URL, field session, and current field state are checked before changes are applied.
- Applying values does not save or submit the return.

Load releases only from this repository and verify the published SHA-256 checksum when available.
