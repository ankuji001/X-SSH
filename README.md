# X-SSH

An SSH client with PuTTY's session setup and Bitvise's way of working: one session window per connection, and each terminal and SFTP browser in its own window.

## Run
    npm install            # first time only
    ./x-ssh.sh        # or: npm start

## Features
- **Session window:** host/port/user, saved sessions (Load/Save/Delete/Import/Export), categories for Auth, Connection, Terminal, SFTP, Tunnels and Host keys, plus a connection log.
- **Auth:** agent, `~/.ssh` keys, a key file (with passphrase prompt), password, and keyboard-interactive/2FA. Stored passwords are encrypted with the system keyring.
- **Host keys:** SHA256 fingerprint check, a warning if a key changes, and a trusted-hosts manager.
- **Terminal windows:** as many as you like over one connection. xterm-256color, 5 colour schemes, copy-on-select and right-click paste, Ctrl+Shift+C/V/F, and typing `exit` closes the window.
- **SFTP windows:** local and remote panes side by side. Drag between panes or from your file manager. Recursive upload/download, a transfer queue with speed, rename/delete/mkdir/chmod, "Edit" (opens the file locally and uploads it again on save), and "Open terminal here".
- **Tunnels:** Local (C2S), Remote (S2C) and Dynamic SOCKS4/5 port forwarding.
- **Tile windows** (Ctrl+Shift+G) arranges every terminal/SFTP window in a grid.

Data is stored in `~/.config/x-ssh/` (profiles.json, known_hosts.json).
