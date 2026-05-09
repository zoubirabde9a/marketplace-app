# Runbook 01 — Provision a VPS

What to do when buying a new server. Output of this runbook: a row in [`servers.md`](../servers.md), an entry in [`CHANGELOG.md`](../CHANGELOG.md), and bootstrap credentials in `deploy/.env`.

## When to use this

Buying a new VPS for any role (production, staging, worker, anything).

## Steps

### 1. Pick a provider & plan

See [`protocols.md`](../protocols.md) for current preferred providers. Default for European production: **netcup** or **Hetzner**, smallest plan that gives ≥ 8 GB RAM.

### 2. Order it

- Use the EU-friendly provider's web UI.
- OS image: **Debian 13** (or Ubuntu 24.04 LTS — both fine; Debian uses fewer resources).
- Region: closest to expected user base.
- Enable provider snapshots/backups if the provider charges separately for them.
- Pay with a card — keep the receipt PDF.

### 3. Wait for the credentials email

Provider emails:
- Hostname (often auto-generated, ugly — that's fine, we never use it directly)
- Public IPv4 / IPv6
- Initial root password (or — better — they ask you for an SSH public key during signup; in that case skip the password steps)

### 4. Record everything in `servers.md`

Add a new row to the table at the top, then a full-detail block below. Required fields: name, role, provider, region, public IPv4, IPv6, OS, host fingerprint (capture in step 6), initial admin user.

**The name is permanent.** Pick something that describes the role + region (`vps-eu`, `vps-us`, `worker-1`), not the provider. Provider can change.

### 5. Add the bootstrap password to `deploy/.env`

Use the key naming convention `<NAME>_ROOT_PASSWORD` (e.g. `VPS_EU_ROOT_PASSWORD=...`). Don't commit. Add a matching line to `deploy/.env.example` so the next operator knows it exists.

### 6. Verify reachability and capture the SSH host key

From your workstation:

```powershell
# PowerShell on Windows
Test-NetConnection -ComputerName <IP> -Port 22 -InformationLevel Quiet
# → True

# Connect once with accept-new so the host key lands in known_hosts
ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10 root@<IP> exit
# Will fail with "Permission denied" — that's fine, we just want the host key.

# Show the recorded fingerprint
ssh-keygen -l -F <IP>
```

```bash
# Linux/macOS — equivalent
nc -zv <IP> 22
ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10 root@<IP> exit
ssh-keygen -l -F <IP>
```

Copy the SHA256 fingerprint into `servers.md`.

> ⚠️ **OpenSSH KEX gotcha (Windows only):** if the server runs OpenSSH 10+ and your Windows client is 9.5, you'll see `choose_kex: unsupported KEX method sntrup761x25519-sha512@openssh.com`. Add `-o KexAlgorithms=curve25519-sha256` to every SSH command above, and pin the same in your `~/.ssh/config` block (see runbook 02). Linux/macOS clients on OpenSSH 9.6+ negotiate the modern KEX automatically.

### 7. Add a CHANGELOG line

Date, server name, what was provisioned. Keep it brief — see existing entries for tone.

### 8. Continue with [runbook 02](./02-ssh-bootstrap.md)

Don't leave a server with password-only SSH for any longer than you have to.

## Output

- [ ] Row in `servers.md` with full detail block
- [ ] `<NAME>_ROOT_PASSWORD` in `deploy/.env`
- [ ] Matching key in `deploy/.env.example`
- [ ] SSH host key fingerprint recorded
- [ ] `CHANGELOG.md` entry
