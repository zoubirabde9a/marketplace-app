# Runbook 02 — SSH bootstrap

Goal: get from "I have a root password" to "`ssh vps-eu` works passwordlessly with a per-server key".

This runbook leaves password auth *enabled* — that's runbook 03's job. The split is deliberate: install the key first, verify it works, *then* lock the door behind us.

## Inputs

- A row in [`servers.md`](../servers.md) for this server (provider, IP, host fingerprint).
- The server's initial root password in `deploy/.env` (key `<NAME>_ROOT_PASSWORD`).

## Steps

### 1. Generate a dedicated keypair for this server

We use **one keypair per server**. If a server is compromised we only have to revoke one key.

```powershell
# PowerShell on Windows
ssh-keygen -t ed25519 -N '""' -C "<name> marketplace-app" -f "$env:USERPROFILE\.ssh\<name>_ed25519"
```

```bash
# Linux/macOS
ssh-keygen -t ed25519 -N "" -C "<name> marketplace-app" -f ~/.ssh/<name>_ed25519
```

Substitute `<name>` with the server's short name (e.g. `vps-eu`).

Record the public-key fingerprint (`ssh-keygen -lf ~/.ssh/<name>_ed25519.pub`) in `servers.md`.

### 2. Add a `Host` block to `~/.ssh/config`

```
Host <name>
    HostName <IP>
    User root
    IdentityFile ~/.ssh/<name>_ed25519
    IdentitiesOnly yes
    # Add the next line ONLY for Windows OpenSSH 9.5 clients talking to OpenSSH 10+ servers:
    KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org
```

`IdentitiesOnly yes` stops SSH from offering every key in `~/.ssh/` — important when you have many keys; otherwise the server may reject the request after too many failed offers.

### 3. Install the public key on the server

This is the only step that needs the bootstrap password. After this, the password is no longer used.

#### Option A — Linux/macOS one-liner (uses `ssh-copy-id`):
```bash
ssh-copy-id -i ~/.ssh/<name>_ed25519.pub root@<IP>
# Type the password from deploy/.env when prompted.
```

#### Option B — Windows (no `ssh-copy-id`):
```powershell
# In PowerShell. You'll be prompted for the root password once.
type $env:USERPROFILE\.ssh\<name>_ed25519.pub | ssh root@<IP> "umask 077; mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

If your client needs the KEX override (Windows + OpenSSH 10 server):
```powershell
type $env:USERPROFILE\.ssh\<name>_ed25519.pub | ssh -o KexAlgorithms=curve25519-sha256 root@<IP> "umask 077; mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

### 4. Verify passwordless login works

```powershell
ssh <name> "hostname && id && uname -a"
```

Expected output: hostname, `uid=0(root) gid=0(root) ...`, kernel info. **No password prompt.** If it asks for a password, the key install didn't take — re-run step 3.

### 5. Update `servers.md` and `CHANGELOG.md`

- In `servers.md`, tick the runbook 02 checkbox under this server's "Runbooks completed" list.
- Add a CHANGELOG entry: `## YYYY-MM-DD — <name>: SSH key bootstrap completed`.

## Output

- [ ] Per-server keypair in `~/.ssh/<name>_ed25519`
- [ ] `Host <name>` block in `~/.ssh/config`
- [ ] Public key in `root@<server>:~/.ssh/authorized_keys`
- [ ] `ssh <name> hostname` succeeds without a password
- [ ] `servers.md` updated, CHANGELOG entry added

## Then: runbook 03

[`03-harden-server.md`](./03-harden-server.md) (TODO) — disable password auth, disable root login, enable ufw, install fail2ban.
