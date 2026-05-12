#!/bin/bash
set -e

# Log everything for debugging: sudo journalctl -u google-startup-scripts
exec > >(tee /var/log/selva-startup.log) 2>&1

echo "=== Selva startup script beginning ==="

echo ""
echo "================================================================"
echo "Point the A record for ${domain} at ${public_ip}"
echo "  (Caddy will retry ACME if it's not ready yet — not fatal.)"
echo "================================================================"
echo ""

# Write setup vars to a file so it can be re-run manually.
# GH_TOKEN is used both to fetch the bootstrap scripts via the GitHub
# contents API and as the credential in the git clone URL. Deploy keys
# are disabled at the VektorNode org level, so PAT-over-HTTPS is the
# only option here.
cat > /opt/selva-setup.sh << SETUP_EOF
#!/bin/bash
set -e
export REPO_URL="https://x-access-token:${github_token}@github.com/VektorNode/selva.git"
export DOMAIN="${domain}"
export ACME_EMAIL="${acme_email}"
export ORIGIN="https://${domain}"
export BRANCH="${branch}"
export INSTALL_DIR="/home/${ssh_user}/selva"
export GH_TOKEN="${github_token}"

# Run the app setup as the ssh_user. setup.sh reads \$DOMAIN / \$ORIGIN /
# \$BRANCH from the environment and clones the matching ref.
sudo -u ${ssh_user} -E bash -c "
  cd ~
  curl -fsSL \\
    -H 'Authorization: Bearer \$GH_TOKEN' \\
    -H 'Accept: application/vnd.github.raw' \\
    'https://api.github.com/repos/VektorNode/selva/contents/scripts/setup.sh?ref=${branch}' \\
    -o /tmp/setup.sh
  bash /tmp/setup.sh --no-interactive
"

# Set up Caddy non-interactively in prod mode. SETUP_MODE + DOMAIN +
# ACME_EMAIL + APP_PORT make setup-caddy.sh skip every prompt.
export SETUP_MODE="prod"
export APP_PORT="3000"
curl -fsSL \\
  -H "Authorization: Bearer \$GH_TOKEN" \\
  -H "Accept: application/vnd.github.raw" \\
  "https://api.github.com/repos/VektorNode/selva/contents/scripts/setup-caddy.sh?ref=${branch}" \\
  -o /tmp/setup-caddy.sh
bash /tmp/setup-caddy.sh
SETUP_EOF

chmod +x /opt/selva-setup.sh

bash /opt/selva-setup.sh

echo "=== Selva startup script complete ==="
