# Router Board implementation plan

Approved by the owner's direct requests to preconfigure multiport mode and code add/remove windows with model selection.

## Files

1. `scripts/router-board/server.cjs`: dependency-free loopback management server, atomic saved window state, live `/v1/models`, one authenticated streaming proxy port per window, and owned Windows Codex process lifecycle. Default router 20128, board 20129, window ports 20130–20141.
2. `scripts/router-board/public/{index.html,app.js,style.css}`: Vietnamese board, add/remove configurations, model/folder controls, open/close windows, polling statuses and errors. Disable edits while sessions or requests are active.
3. `scripts/windows/{Start-CodexPane.ps1,Start-RouterBoard.ps1,Start-RouterServer.ps1,Install-RouterBoard.ps1}` and root `.cmd` entrypoints: install dependencies/build, optional Codex installation, separate data directory, first-run key capture with DPAPI, desktop shortcut and router/board startup. Invocation-local Codex overrides only.
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
