# Kubernetes Deployment Guide

This directory contains Kubernetes/OpenShift manifests for deploying the GHES Auth application.

## Files

- **`secret.yml`** - Secret template (DO NOT use directly with real values)
- **`create-secrets.sh`** - Interactive script to create secrets securely
- **`deploy.yml`** - Deployment configuration
- **`svc.yml`** - Service configuration
- **`route.yml`** - OpenShift Route configuration

## Quick Start

### 1. Create Secrets

**Option A: Using the interactive script (Recommended)**

```bash
cd k8s
chmod +x create-secrets.sh
./create-secrets.sh
```

The script will:
- Prompt for all required configuration values
- Automatically generate secure JWT_SECRET and ENCRYPTION_KEY
- Create the Kubernetes secrets
- Optionally handle CA certificate setup

**Option B: Manual secret creation**

```bash
# Generate secure keys
JWT_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Create the secret
oc create secret generic ghes-auth-secrets \
  --from-literal=host_route_host='auth.mydomain.example' \
  --from-literal=gh_base_url='https://github.adib.co.ae/api/v3' \
  --from-literal=gh_client_id='Iv1.your-client-id' \
  --from-literal=gh_client_secret='your-client-secret' \
  --from-literal=gh_pages_url='https://github.adib.co.ae/pages/org/repo' \
  --from-literal=org_name='your_org' \
  --from-literal=team_slug='devops' \
  --from-literal=jwt_secret="$JWT_SECRET" \
  --from-literal=encryption_key="$ENCRYPTION_KEY"

# Create CA certificate secret (if using self-signed certs)
oc create secret generic ghes-ca-cert \
  --from-file=gh_ca.pem=/path/to/your/ca.pem
```

### 2. Deploy the Application

```bash
# Apply deployment
oc apply -f deploy.yml

# Apply service
oc apply -f svc.yml

# Apply route (OpenShift)
oc apply -f route.yml
```

### 3. Verify Deployment

```bash
# Check deployment status
oc get deployments ghes-auth

# Check pod status
oc get pods -l app=ghes-auth

# View logs
oc logs -l app=ghes-auth -f

# Check service
oc get svc ghes-auth

# Check route
oc get route ghes-auth
```

## Environment Variables

### Required Variables (stored in secrets)

| Variable | Description | Example |
|----------|-------------|---------|
| `HOST_ROUTE_HOST` | Public hostname of the route | `auth.mydomain.example` |
| `GH_BASE_URL` | GitHub Enterprise API base URL | `https://github.adib.co.ae/api/v3` |
| `GH_CLIENT_ID` | GitHub OAuth App Client ID | `Iv1.1234567890abcdef` |
| `GH_CLIENT_SECRET` | GitHub OAuth App Client Secret | `ghp_xxxxxxxxxxxx` |
| `GH_PAGES_URL` | GitHub Pages URL | `https://github.adib.co.ae/pages/org/repo` |
| `ORG_NAME` | GitHub Organization name | `your_org` |
| `TEAM_SLUG` | GitHub Team slug for authorization | `devops` |
| `JWT_SECRET` | Secret key for JWT token signing | `auto-generated` |
| `ENCRYPTION_KEY` | 32-byte key for secret encryption | `auto-generated` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Application port | `3000` |
| `GH_CA_CERT_PATH` | Path to CA certificate | `/etc/gh-ca/gh_ca.pem` |

## Security Features

### Secrets Encryption
All user-submitted secret values are encrypted using **AES-256-GCM** before being stored in GitHub Gists. The `ENCRYPTION_KEY` is used for this encryption.

**Important:**
- Keep `ENCRYPTION_KEY` secure and backed up
- If you lose the encryption key, encrypted values cannot be recovered
- Use different keys for different environments (dev/staging/prod)

### Key Generation
Always use cryptographically secure random values:

```bash
# JWT Secret (base64)
openssl rand -base64 32

# Encryption Key (hex, 32 bytes = 64 hex chars)
openssl rand -hex 32
```

## Troubleshooting

### Pod not starting
```bash
# Check pod events
oc describe pod -l app=ghes-auth

# Check logs
oc logs -l app=ghes-auth --tail=100
```

### Secret errors
```bash
# Verify secrets exist
oc get secrets ghes-auth-secrets
oc get secrets ghes-ca-cert

# Inspect secret (without revealing values)
oc describe secret ghes-auth-secrets
```

### Certificate issues
If you're getting certificate errors:

1. Ensure CA certificate is correctly mounted
2. Check `GH_CA_CERT_PATH` environment variable
3. Verify certificate format (PEM)

```bash
# Check if certificate is mounted
oc exec -it <pod-name> -- cat /etc/gh-ca/gh_ca.pem
```

### Application errors
```bash
# Check application logs
oc logs -l app=ghes-auth -f

# Check environment variables (careful with secrets!)
oc exec -it <pod-name> -- env | grep -E "GH_|JWT|HOST"
```

## Updating Secrets

To update secrets after initial creation:

```bash
# Delete existing secret
oc delete secret ghes-auth-secrets

# Recreate with new values
./create-secrets.sh
# OR
oc create secret generic ghes-auth-secrets ...

# Restart deployment to pick up new values
oc rollout restart deployment/ghes-auth
```

## Cleanup

```bash
# Delete all resources
oc delete -f route.yml
oc delete -f svc.yml
oc delete -f deploy.yml
oc delete secret ghes-auth-secrets
oc delete secret ghes-ca-cert
```

## Production Checklist

- [ ] Generate unique, strong `JWT_SECRET`
- [ ] Generate unique, strong `ENCRYPTION_KEY` (32 bytes)
- [ ] Back up encryption keys securely
- [ ] Use proper CA certificates (not self-signed in production)
- [ ] Configure proper resource limits in `deploy.yml`
- [ ] Set up monitoring and alerting
- [ ] Configure proper ingress/route with TLS
- [ ] Review and adjust replica count
- [ ] Test secret encryption/decryption
- [ ] Verify OAuth callback URLs in GitHub
- [ ] Test team authorization
- [ ] Document key rotation procedures

## Support

For issues or questions:
1. Check application logs: `oc logs -l app=ghes-auth`
2. Verify secret configuration: `oc describe secret ghes-auth-secrets`
3. Review deployment status: `oc describe deployment ghes-auth`
4. Check the main README.md for application documentation

