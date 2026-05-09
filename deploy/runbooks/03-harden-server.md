# Runbook 03 — Harden the server + install Docker (TODO)

**Status:** not yet authored. Will be filled in once we run it on `vps-eu`.

This runbook covers the two steps that always happen together on a fresh box:
hardening the SSH/firewall surface, and installing Docker so the next runbook
(`05-deploy-app.md`) has something to build on. Previously split into 03 + 04;
04 was a 12-line stub and the steps are never run independently.

## Policy decisions for this project

- **Password authentication stays ENABLED** as a recovery path. The bootstrap password (`VPS_EU_ROOT_PASSWORD` in `deploy/.env`) remains valid. Reasoning: if the operator's SSH key is lost or the laptop dies, password auth + the netcup KVM console is our only way back in without provider intervention.
- **Root login stays ENABLED** (via key OR password). Same reasoning — single-operator project, the friction of `sudo` indirection is not worth the marginal security gain at this stage.
- **Brute-force defense is delegated to `fail2ban`**, not to disabling password auth. With fail2ban on the `sshd` jail (5 failures → 1h ban) and a 15-character random password, the threat from internet-wide scanners is negligible.

## Planned scope

- [ ] `apt update && apt upgrade -y && apt install -y ufw fail2ban unattended-upgrades`.
- [ ] `ufw default deny incoming; ufw default allow outgoing; ufw allow 22,80,443/tcp; ufw enable`.
- [ ] Enable `unattended-upgrades` for security patches (`dpkg-reconfigure --priority=low unattended-upgrades`).
- [ ] Configure fail2ban with the `sshd` jail (default policy: ban 1h after 5 failures within 10 min).
  - This is the load-bearing brute-force defense given password auth stays on.
- [ ] Set timezone + NTP: `timedatectl set-timezone Etc/UTC`.
- [ ] **Verify password auth still works** before closing the console — open a second SSH session and try `ssh -o PreferredAuthentications=password root@vps-eu` to confirm the recovery path is intact.
- [ ] Update `servers.md`: tick this runbook's box, note that `VPS_EU_ROOT_PASSWORD` remains valid.
- [ ] Add CHANGELOG entry.

## Things we are deliberately NOT doing

- Not setting `PermitRootLogin no` — see policy above.
- Not setting `PasswordAuthentication no` — see policy above.
- Not creating a separate sudo user — single operator, no benefit.
- Not changing the SSH port — security-by-obscurity, not real defense; just shifts the noise to wherever you moved it.

## Install Docker (formerly runbook 04)

- [ ] Install Docker Engine + Compose plugin from Docker's official apt repo (NOT the distro's older `docker.io` package).
- [ ] Add the admin user to the `docker` group.
- [ ] Verify: `docker run --rm hello-world`.
- [ ] Configure log rotation in `/etc/docker/daemon.json`:
  ```json
  { "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
  ```
- [ ] `systemctl restart docker`.
- [ ] Update `servers.md` and add a CHANGELOG entry.
