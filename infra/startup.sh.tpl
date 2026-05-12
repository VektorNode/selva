#!/bin/bash
set -e

# Log everything for debugging: sudo journalctl -u google-startup-scripts
exec > >(tee /var/log/selva-startup.log) 2>&1

echo "=== Selva startup script beginning ==="

# Generate SSH key for GitHub access (deploy key)
SSH_KEY_PATH="/home/${ssh_user}/.ssh/id_ed25519"
if [ ! -f "$SSH_KEY_PATH" ]; then
  sudo -u ${ssh_user} ssh-keygen -t ed25519 -C "selva-server" -f "$SSH_KEY_PATH" -N ""
fi

echo ""
echo "================================================================"
echo "ACTION REQUIRED: Add this deploy key to your GitHub repository:"
echo "https://github.com/VektorNode/selva/settings/keys"
echo ""
cat "$SSH_KEY_PATH.pub"
echo ""
echo "ALSO REQUIRED: Point the A record for ${domain} at ${public_ip}"
echo "  (Caddy will retry ACME if it's not ready yet — not fatal.)"
echo "================================================================"
echo ""
echo "Waiting 120s for you to add the deploy key + DNS, then continuing..."
echo "(Re-run setup manually if you miss this window: sudo bash /opt/selva-setup.sh)"
echo ""

# Write setup vars to a file so it can be re-run manually
cat > /opt/selva-setup.sh << 'SETUP_EOF'
#!/bin/bash
set -e
export REPO_URL="git@github.com:VektorNode/selva.git"
export DOMAIN="${domain}"
export ACME_EMAIL="${acme_email}"
export ORIGIN="https://${domain}"
export BRANCH="${branch}"
export INSTALL_DIR="/home/${ssh_user}/selva"

# Run the app setup as the ssh_user. setup.sh reads $DOMAIN / $ORIGIN /
# $BRANCH from the environment and clones the matching ref.
sudo -u ${ssh_user} -E bash -c '
  cd ~
  curl -fsSL https://raw.githubusercontent.com/VektorNode/selva/${branch}/scripts/setup.sh -o /tmp/setup.sh
  bash /tmp/setup.sh --no-interactive
'

# Set up Caddy non-interactively in prod mode. SETUP_MODE + DOMAIN +
# ACME_EMAIL + APP_PORT make setup-caddy.sh skip every prompt.
export SETUP_MODE="prod"
export APP_PORT="3000"
curl -fsSL "https://raw.githubusercontent.com/VektorNode/selva/${branch}/scripts/setup-caddy.sh" -o /tmp/setup-caddy.sh
bash /tmp/setup-caddy.sh
SETUP_EOF

chmod +x /opt/selva-setup.sh

# Give time for deploy key + DNS to be added
sleep 120

bash /opt/selva-setup.sh

echo "=== Selva startup script complete ==="
