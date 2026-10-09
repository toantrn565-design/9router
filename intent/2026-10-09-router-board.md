---
status: building
---
# Router Board: windows and models

**Problem** — The owner wants 9Router preconfigured for multiple local connections, like Terminal Board, and explicitly requests code to add/remove windows and select each window's model.

**Outcome** — A Windows launcher opens a local board. The user adds/removes up to 12 window configurations, chooses a live router model and working directory, opens/closes each owned Codex terminal window, and can reopen saved configurations. Each window has a separate local API port, sharing one upstream 9Router and its account rotation.

**Constraints** — Loopback only; no extra Node dependencies; preserve the existing Terminal Board installation and global Codex configuration. Never store plaintext keys in board state or send them to the browser. Credentials entered once on Windows use current-user DPAPI. The current user request authorizes implementing and installing this mode in the GitHub repository; installation on the user's PC still requires running the supplied setup.

**Out of scope** — Account login automation, changing provider rotation policy, account-specific port pinning, remote access, and in-place model changes in running Codex sessions. Stopping an owned window is an explicit UI action, with a warning about interrupted work.

**Open questions** — None. A window is an independent Codex terminal; ports do not represent separate ChatGPT accounts.
