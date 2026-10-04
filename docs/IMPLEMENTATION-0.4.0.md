# 0.4.0 implementation checkpoint

Development is on main. This checkpoint is not the 0.4.0 release. Existing data and credentials are preserved; upgrades do not repeat raw-note reentry.

Implemented foundation:

- Responses JSON Schema, plain streaming discussion, bundled official offline tokenizers, soft daily thresholds and optional hard limits.
- Durable returned-response caches before parsing; bounded repair, truncation regeneration and provider retry; partial note metadata and individually validated structure recommendations.
- Version guards, cancellation, trash, restore, selective permanent deletion, bookmark, thread pin, batch move/undo and manual cognition versions.
- Cloud format 5 reading formats 1–4. Deletion maintenance creates replacement batches, conditionally publishes and confirms the manifest, then deletes superseded files. Import digests retain cycle/position deduplication after text removal.
- Card menus, local editor drafts, explicit historical search, conversation pagination, tasks panel, human-readable evidence titles, separate local save feedback and Windows dictation instructions.

Latest completed validation before this checkpoint: 121 unit tests, type checking, production build and 8 Electron desktop regression flows. No new paid AI requests or daily-data WebDAV requests have been made.

Remaining before release:

- Complete navigation restoration, draft/exit handshake, approval drafts and inline error/busy coverage; add dedicated UX acceptance flows.
- Complete provider result recovery/usage reconciliation, long-material step scheduling and the required synthetic Flash quality report.
- Implement isolated PDF/DOCX/text extraction, material indexing, summaries/checkpoints, blob sync and restore/open/delete lifecycle.
- Expand deletion interruption/conflict tests and run isolated Nutstore integration.
- Visual/keyboard/reduced-motion verification, packaged install upgrade tests, credentials scan and Windows CI.
- Bump version, publish via existing Actions, verify installer. Only after delivery: research at least 12 tools and produce 10–15 feature cards.
