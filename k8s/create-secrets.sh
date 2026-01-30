#!/bin/bash
# Script to create Kubernetes secrets for GHES Auth Application
# Usage: ./create-secrets.sh

set -e

echo "============================================"
echo "GHES Auth Application - Secret Creation"
echo "============================================"
echo ""

# Check if oc/kubectl is available
if command -v oc &> /dev/null; then
    CLI="oc"
elif command -v kubectl &> /dev/null; then
    CLI="kubectl"
else
    echo "Error: Neither 'oc' nor 'kubectl' command found."
    exit 1
fi

echo "Using CLI: $CLI"
echo ""

# Function to prompt for input
prompt_input() {
    local var_name=$1
    local prompt_text=$2
    local default_value=$3
    local is_secret=$4
    
    if [ -n "$default_value" ]; then
        prompt_text="$prompt_text [$default_value]"
    fi
    
    if [ "$is_secret" = "true" ]; then
        read -sp "$prompt_text: " value
        echo ""
    else
        read -p "$prompt_text: " value
    fi
    
    if [ -z "$value" ] && [ -n "$default_value" ]; then
        value=$default_value
    fi
    
    echo "$value"
}

# Generate random keys
generate_jwt_secret() {
    openssl rand -base64 32 | tr -d '\n'
}

generate_encryption_key() {
    openssl rand -hex 32 | tr -d '\n'
}

echo "=== Required Configuration ==="
echo ""

# Prompt for values
HOST_ROUTE_HOST=$(prompt_input "HOST_ROUTE_HOST" "Enter route host (e.g., auth.mydomain.example)" "" "false")
GH_BASE_URL=$(prompt_input "GH_BASE_URL" "Enter GitHub Enterprise base URL" "https://github.adib.co.ae/api/v3" "false")
GH_CLIENT_ID=$(prompt_input "GH_CLIENT_ID" "Enter GitHub OAuth App Client ID" "" "false")
GH_CLIENT_SECRET=$(prompt_input "GH_CLIENT_SECRET" "Enter GitHub OAuth App Client Secret" "" "true")
GH_PAGES_URL=$(prompt_input "GH_PAGES_URL" "Enter GitHub Pages URL" "https://github.adib.co.ae/pages/myorg/myrepo" "false")
ORG_NAME=$(prompt_input "ORG_NAME" "Enter GitHub Organization name" "your_org" "false")
TEAM_SLUG=$(prompt_input "TEAM_SLUG" "Enter GitHub Team slug" "devops" "false")

echo ""
echo "=== Security Keys ==="
echo ""
read -p "Generate JWT_SECRET automatically? [Y/n]: " gen_jwt
if [[ "$gen_jwt" =~ ^[Nn]$ ]]; then
    JWT_SECRET=$(prompt_input "JWT_SECRET" "Enter JWT Secret" "" "true")
else
    JWT_SECRET=$(generate_jwt_secret)
    echo "Generated JWT_SECRET: ✓"
fi

read -p "Generate ENCRYPTION_KEY automatically? [Y/n]: " gen_enc
if [[ "$gen_enc" =~ ^[Nn]$ ]]; then
    ENCRYPTION_KEY=$(prompt_input "ENCRYPTION_KEY" "Enter Encryption Key (32-byte hex)" "" "true")
else
    ENCRYPTION_KEY=$(generate_encryption_key)
    echo "Generated ENCRYPTION_KEY (32 bytes): ✓"
fi

echo ""
echo "=== Gist Configuration ==="
echo ""
GIST_FILENAME=$(prompt_input "GIST_FILENAME" "Enter Gist filename (optional, leave empty to use first file)" "" "false")

echo ""
echo "=== CA Certificate (Optional) ==="
echo ""
read -p "Do you have a custom CA certificate file for GHES? [y/N]: " has_ca
if [[ "$has_ca" =~ ^[Yy]$ ]]; then
    read -p "Enter path to CA certificate PEM file: " CA_CERT_PATH
    if [ ! -f "$CA_CERT_PATH" ]; then
        echo "Error: Certificate file not found: $CA_CERT_PATH"
        exit 1
    fi
fi

echo ""
echo "=== Creating Secrets ==="
echo ""

# Delete existing secret if it exists
if $CLI get secret ghes-auth-secrets &> /dev/null; then
    echo "Deleting existing ghes-auth-secrets..."
    $CLI delete secret ghes-auth-secrets
fi

# Create the main secret
echo "Creating ghes-auth-secrets..."
SECRET_ARGS=(
    --from-literal=host_route_host="$HOST_ROUTE_HOST"
    --from-literal=gh_base_url="$GH_BASE_URL"
    --from-literal=gh_client_id="$GH_CLIENT_ID"
    --from-literal=gh_client_secret="$GH_CLIENT_SECRET"
    --from-literal=gh_pages_url="$GH_PAGES_URL"
    --from-literal=org_name="$ORG_NAME"
    --from-literal=team_slug="$TEAM_SLUG"
    --from-literal=jwt_secret="$JWT_SECRET"
    --from-literal=encryption_key="$ENCRYPTION_KEY"
)

# Add GIST_FILENAME only if provided
if [ -n "$GIST_FILENAME" ]; then
    SECRET_ARGS+=(--from-literal=gist_filename="$GIST_FILENAME")
fi

$CLI create secret generic ghes-auth-secrets "${SECRET_ARGS[@]}"

echo "✓ Secret ghes-auth-secrets created successfully"

# Create CA certificate secret if provided
if [[ "$has_ca" =~ ^[Yy]$ ]] && [ -n "$CA_CERT_PATH" ]; then
    if $CLI get secret ghes-ca-cert &> /dev/null; then
        echo "Deleting existing ghes-ca-cert..."
        $CLI delete secret ghes-ca-cert
    fi
    
    echo "Creating ghes-ca-cert..."
    $CLI create secret generic ghes-ca-cert \
        --from-file=gh_ca.pem="$CA_CERT_PATH"
    
    echo "✓ Secret ghes-ca-cert created successfully"
fi

echo ""
echo "=== Summary ==="
echo ""
echo "Secrets created successfully!"
echo ""
echo "Next steps:"
echo "1. Review the deployment configuration: k8s/deploy.yml"
echo "2. Deploy the application: $CLI apply -f k8s/deploy.yml"
echo "3. Create service: $CLI apply -f k8s/svc.yml"
echo "4. Create route: $CLI apply -f k8s/route.yml"
echo ""
echo "IMPORTANT: Keep these credentials secure!"
echo "  - JWT_SECRET: ${JWT_SECRET:0:10}..."
echo "  - ENCRYPTION_KEY: ${ENCRYPTION_KEY:0:10}..."
echo ""

