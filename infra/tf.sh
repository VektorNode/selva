#!/usr/bin/env bash
# terraform wrapper that takes its variables from the repo-root .env, so the
# app, Compute and Terraform share one file: ./tf.sh plan | apply | ...
#
# A TF_VAR_<name> line passes through as variable <name> (TF_VAR_project_id).
# These app variables fill a variable that has no TF_VAR_ line:
#   SELVA_TENANCY, SELVA_AUTH_PROVIDER, SELVA_DATA_PROVIDER, SELVA_STORAGE_PROVIDER,
#   BOOTSTRAP_INSTANCE_ADMIN_EMAIL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
# A terraform.tfvars, if present, still wins over both.
set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE="${ENV_FILE:-../.env}"
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE not found" >&2; exit 1; }

env_value() { # last NAME= value, quotes and unquoted trailing comment stripped
    tr -d '\r' < "$ENV_FILE" | sed -n "s/^[[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}$1=//p" | tail -1 \
        | sed -e '/^"/{s/^"\([^"]*\)".*$/\1/;b' -e '}' \
              -e "/^'/{s/^'\([^']*\)'.*\$/\1/;b" -e '}' \
              -e 's/[[:space:]]*#.*$//' -e 's/[[:space:]]*$//'
}

while IFS= read -r name; do
    [ -n "$name" ] && export "$name=$(env_value "$name")"
done < <(tr -d '\r' < "$ENV_FILE" | sed -n 's/^[[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}\(TF_VAR_[A-Za-z0-9_]*\)=.*/\2/p' | sort -u)

map_tf() { # map_tf APP_NAME tf_name — fill TF_VAR_<tf_name> from APP_NAME unless set
    local tf="TF_VAR_$2"; [ -n "${!tf-}" ] || { local v; v="$(env_value "$1")"; [ -z "$v" ] || export "$tf=$v"; }; }
for pair in SELVA_TENANCY:tenancy SELVA_AUTH_PROVIDER:auth_provider SELVA_DATA_PROVIDER:data_provider \
            SELVA_STORAGE_PROVIDER:storage_provider BOOTSTRAP_INSTANCE_ADMIN_EMAIL:bootstrap_admin_email \
            SUPABASE_URL:supabase_url SUPABASE_ANON_KEY:supabase_anon_key \
            SUPABASE_SERVICE_ROLE_KEY:supabase_service_role_key; do
    map_tf "${pair%%:*}" "${pair##*:}"
done

exec terraform "$@"
