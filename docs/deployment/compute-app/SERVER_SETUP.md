# Server Setup for Selva Compute App

Common setup steps for both Node.js and Docker deployments.

---

## 1. Install Node.js and pnpm

These are required for both deployment methods to build the application.

### On Linux (Ubuntu/Debian)

```bash
# Update system packages
sudo apt-get update && sudo apt-get upgrade -y

# Install Node.js 22 (LTS)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm globally
sudo npm install -g pnpm

# Verify installations
node --version  # Should show v22.x.x
pnpm --version  # Should show 9.x.x
```

### On Windows Server

1. Download Node.js installer from [nodejs.org](https://nodejs.org/)
2. Run installer and ensure "Add to PATH" is checked
3. Open PowerShell as Administrator:
   ```powershell
   npm install -g pnpm
   node --version
   pnpm --version
   ```

### On macOS

```bash
# Using Homebrew
brew install node@22
brew install pnpm

# Or download from nodejs.org
node --version
pnpm --version
```

---

## 2. Set Up SSH Key Authentication (Currently needed since repository is still private)

If your at this point let @TheVessen know to setup the SSH key so you get acces to it.

```bash
# Generate SSH key
ssh-keygen -t ed25519 -C "your-email@example.com"
# Press Enter for all prompts (no passphrase needed)

# Display public key
cat ~/.ssh/id_ed25519.pub

# Add this key to your GitHub account:
# https://github.com/settings/keys
```

---

## 3. Clone Repository

```bash
# Clone via SSH (requires SSH key setup)
git clone git@github.com:your-username/selva.git
cd selva

# Or via HTTPS (requires credentials)
git clone https://github.com/VektorNode/selva.git
cd selva
```

---

## 4. Install Dependencies

```bash
# Install all workspace dependencies
pnpm install

# This installs dependencies for all packages in the monorepo
```

---

## 5. Build All Packages

The compute-app depends on other workspace packages, so build everything in order:

```bash
# Build all packages (core, shared, schemas, etc.)
pnpm run build:all

# This ensures all dependencies are compiled before the compute-app
```

---

## Next Steps

After completing these server setup steps:

- **[Node.js Deployment](./NODE_DEPLOYMENT.md)** - Continue with configuring environment and running with PM2
- **[Docker Deployment](./DOCKER_DEPLOYMENT.md)** - Continue with building and running Docker image
