# Downgrading Opencode to v1.2.27 on macOS

This guide covers how to downgrade opencode to v1.2.27 via Homebrew and optionally back up the release to a private GitHub repository.

---

## Prerequisites

- [Homebrew](https://brew.sh) installed
- [Git](https://git-scm.com) installed
- [GitHub CLI](https://cli.github.com) installed and authenticated (for the backup step only)

---

## Step 1: Downgrade via Homebrew

Opencode is distributed via the `sst/tap` Homebrew tap, not `homebrew-core`. The standard `brew install opencode@1.2.27` will not work. Instead, use `brew extract` to pull the specific version into a local tap.

```bash
brew tap sst/tap
brew tap-new local/opencode
brew extract --version 1.2.27 sst/tap/opencode local/opencode
brew install local/opencode/opencode@1.2.27
brew pin local/opencode/opencode@1.2.27
```

### What each command does

- `brew tap sst/tap` — adds the SST tap where opencode is distributed
- `brew extract --version 1.2.27 sst/tap/opencode local/opencode` — extracts the formula for v1.2.27 into a local tap
- `brew install local/opencode/opencode@1.2.27` — installs v1.2.27 from the local tap
- `brew pin local/opencode/opencode@1.2.27` — prevents `brew upgrade` from updating it

### Verify the installation

```bash
opencode -v
```

Expected output:

```
1.2.27
```

---

## Step 2: Back up v1.2.27 to a private GitHub repository (optional)

If you want to preserve this release in case it is removed upstream, clone the full repository at the `v1.2.27` tag and push it to a private repo.

First, create a new private repository on GitHub at [github.com/new](https://github.com/new). Name it `opencode-1.2.27`, set it to **Private**, and do not initialize it with any files.

Then run:

```bash
cd /path/to/your/dev/directory

git clone https://github.com/anomalyco/opencode.git opencode-1.2.27
cd opencode-1.2.27
git checkout v1.2.27
git checkout -b main
git remote set-url origin https://github.com/<your-username>/opencode-1.2.27.git
git push -u origin main
```

Replace `<your-username>` with your GitHub username.

---

## Notes

- `brew pin` is important. Without it, running `brew upgrade` will overwrite v1.2.27 with the latest version.
- To unpin and upgrade in the future: `brew unpin local/opencode/opencode@1.2.27`
- A shallow clone (`--depth 1`) will fail to push to GitHub due to missing objects. Always use a full clone for the backup step.
