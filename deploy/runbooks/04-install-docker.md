# Runbook 04 — Install Docker (TODO)

**Status:** not yet authored.

## Planned scope

- [ ] Install Docker Engine + Compose plugin from Docker's official apt repo (NOT the distro's older `docker.io` package).
- [ ] Add the admin user to the `docker` group.
- [ ] Verify: `docker run --rm hello-world`.
- [ ] Configure log rotation in `/etc/docker/daemon.json`:
  ```json
  { "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
  ```
- [ ] `systemctl restart docker`.

Update `servers.md` when done.
