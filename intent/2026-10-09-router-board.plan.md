# Router Board implementation plan

Approved by the owner's direct requests to preconfigure multiport mode and code add/remove windows with model selection.

## Files

1. `scripts/router-board/server.cjs`: dependency-free loopback management server, atomic saved window state, live `/v1/models`, one authenticated streaming proxy port per window, and owned Windows Codex process lifecycle. Default router 20128, board 20129, window ports 20130–20141.
2. `scripts/router-board/public/{index.html,app.js,style.css}`: Vietnamese board, add/remove configurations, model/folder controls, open/close windows, polling statuses and errors. Disable edits while sessions or requests are active.
3. `scripts/windows/{Invoke-CodexWindow.ps1,Start-CodexPane.ps1,Start-RouterBoard.ps1,Start-RouterServer.ps1,Install-RouterBoard.ps1}` and root `.cmd` entrypoints: install dependencies/build, optional Codex installation, separate data directory, first-run key and password capture with DPAPI, desktop shortcut and router/board startup. Invocation-local Codex overrides only. Use native Start-Process to create interactive windows and track PID plus creation time; remember whether upstream router is owned or externally installed.
4. `tests/unit/router-board.test.cjs`: Node test-runner tests with mock router and injected process launcher. Cover persistence, distinct ports, model pinning, authentication, SSE, busy-window protections, process lifecycle, origin/host protection, failed port startup and cleanup.
5. `ROUTER-BOARD.vi.md`, `package.json`, `README.md`: concrete Windows installation/use instructions and npm entrypoints.

## Risks and controls

- OAuth token races: all ports proxy to the same router process; never start one router per account/window.
- Command injection/global settings: spawn argument arrays and use a PowerShell file with validated parameters, no `Invoke-Expression` or `config.toml` writes.
- Local web attacks: exact loopback Host, same-origin mutation check and per-process anti-CSRF token; no CORS access to management or stored key exposure. Gateway ports require the router key, forward only API endpoints and redact all error details.
- Streaming/cancellation: pipe SSE with backpressure and destroy upstream on disconnect. Exclude hop-by-hop headers and cookies. Bounded JSON inputs; preserve upstream failure status.
- Concurrent actions: serialize changes; never remove/update an active configuration. Shutdown closes listeners and aborts requests, but leaves already opened user terminals intact.
- Port conflicts/bad save file: fail visibly and roll back listeners; reject corrupt configurations rather than overwriting them.
- Windows-only behavior: Linux tests exercise injectable launch/close adapters. Document that interactive Windows shell/DPAPI behavior still needs a Windows smoke test.

## Proof

- `node --check scripts/router-board/server.cjs` and browser JavaScript syntax check.
- `node --test tests/unit/router-board.test.cjs`: mock-router integration suite without real accounts.
- Existing provider regression subset for account fallback, combo routing, Codex normalization/base URL/profiles/model routing. Exclude two previously identified baseline expectation failures from pass claims.
- Independent reviewer receives intent + plan and final diff; resolve findings before shipping.
- Git diff whitespace check; GitHub feature branch → PR → merge with checked head SHA. Final instructions explain running setup locally and connecting accounts through the dashboard.

## Verification results

- `npm run test:board`: 10/10 passed, including two simultaneous pinned-model ports, SSE cancellation, Windows process-adapter lifecycle, 12-window limit, CSRF/Host protection, persistence and startup rollback.
- Relevant existing Vitest subset: 6 files / 42 tests passed (account-fallback-4xx, combo-routing, codex-tool-normalization, codex-current-provider-base-url, codex-profiles, codex-registry-model-routing).
- `npm run build`: passed; production pages and standalone assets generated.
- JavaScript syntax and `git diff --check`: passed.
- Independent reviewer: no remaining blockers after correcting initial password persistence, external-router data ownership, saved model type validation and native interactive console launch. Reviewer also exercised a truncated-upstream SSE probe; active counters were released.
- Windows startup uses the documented PowerShell 5.1 Start-Process behavior: new window, inherited environment, PassThru process object. No Windows runtime is available here, so interactive Codex TUI, shortcut and DPAPI still require the documented desktop smoke test. No real ChatGPT accounts or credentials were used in tests.
- The earlier full Codex-focused review found two baseline expectation failures (refresh lead and model context size) outside this change; this is not a claim that the entire upstream suite passes.
