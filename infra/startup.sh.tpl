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
echo "================================================================"
echo ""
echo "Waiting 120s for you to add the deploy key, then continuing..."
echo "(Re-run setup manually if you miss this window: sudo bash /opt/selva-setup.sh)"
echo ""

# Write setup vars to a file so it can be re-run manually
cat > /opt/selva-setup.sh << 'SETUP_EOF'
#!/bin/bash
set -e
export REPO_URL="git@github.com:VektorNode/selva.git"
export COMPUTE_SERVER_URL="${compute_server_url}"
export COMPUTE_API_KEY="${compute_api_key}"
export ADMIN_PASSWORD="${admin_password}"
export ADMIN_SECRET="${admin_secret}"
export ORIGIN="http://${public_ip}"
export INSTALL_DIR="/home/${ssh_user}/selva"

# Run as the ssh_user
sudo -u ${ssh_user} -E bash -c '
  cd ~
  curl -fsSL https://raw.githubusercontent.com/VektorNode/selva/main/scripts/setup.sh -o /tmp/setup.sh
  bash /tmp/setup.sh --no-interactive
'

# Set up Caddy after app is running
curl -fsSL https://raw.githubusercontent.com/VektorNode/selva/main/scripts/setup-caddy.sh -o /tmp/setup-caddy.sh
bash /tmp/setup-caddy.sh
SETUP_EOF

chmod +x /opt/selva-setup.sh

# Give time for deploy key to be added
sleep 120

bash /opt/selva-setup.sh

echo "=== Selva startup script complete ==="
