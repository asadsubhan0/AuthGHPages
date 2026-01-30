# GitHub Actions - Convert Variables to JSON with key_status

This workflow converts a comma-separated list of variable names into a JSON object with the `key_status` structure and uploads it to a private GitHub Gist.

## Workflow: `convert-with-key-status.yml`

### Features

- ✅ Converts comma-separated variables to JSON with TBC values
- ✅ Creates `key_status` object with "open" status
- ✅ Generates metadata with creation timestamp
- ✅ Uploads to private GitHub Gist
- ✅ Supports CA certificates for GHES (secure connection)
- ✅ Uses GitHub secrets for sensitive data

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `variables` | Comma-separated list of variable names | ✅ Yes | - |
| `MSName` | Microservice name | ✅ Yes | - |
| `build_env` | Build environment | ✅ Yes | - |
| `gist_description` | Gist description | ❌ No | "Variables configuration" |
| `gist_filename` | Filename in gist | ❌ No | "secretsNeedsInput.json" |
| `gist_token` | GitHub token for gist operations | ❌ No | Uses `GITHUB_TOKEN` |
| `ca_cert_secret` | Secret name containing CA certificate | ❌ No | - |

### Setup: CA Certificate (for GHES)

If you're using GitHub Enterprise Server (GHES) with self-signed certificates:

1. **Store CA Certificate in GitHub Secrets:**
   - Go to repository Settings → Secrets and variables → Actions
   - Create a new secret (e.g., `GH_CA_CERT`)
   - Paste your CA certificate (PEM format)

2. **Use the Secret in Workflow:**
   - When running the workflow, provide the secret name in `ca_cert_secret` input
   - Example: `ca_cert_secret: GH_CA_CERT`

### Example Usage

**Manual Trigger:**
1. Go to **Actions** tab
2. Select **Convert Variables with key_status**
3. Click **Run workflow**
4. Fill in inputs:
   - `variables`: `db_password,api_key,secret_token`
   - `MSName`: `my-service`
   - `build_env`: `production`
   - `ca_cert_secret`: `GH_CA_CERT` (if using GHES)

### Output Structure

**secretsNeedsInput.json:**
```json
{
  "db_password": "TBC",
  "api_key": "TBC",
  "secret_token": "TBC",
  "key_status": {
    "db_password": "open",
    "api_key": "open",
    "secret_token": "open"
  }
}
```

**metadata.json:**
```json
{
  "created_at": "2024-01-15T10:30:00.000Z",
  "variables_count": 3,
  "variables": ["db_password", "api_key", "secret_token"],
  "status": "awaiting_input",
  "submitted_by": "",
  "approved_by": "",
  "submitted_at": "",
  "approved_at": "",
  "notes": ""
}
```

### Gist Description

The gist will be created with the description:
```
Secrets Input for <MSName> (<build_env>)
```

### Security

- ✅ **Private Gists**: All gists created are private (`public: false`)
- ✅ **CA Certificate Support**: Uses provided CA certificate for secure HTTPS connection
- ✅ **Token Security**: Uses GitHub token from secrets or default `GITHUB_TOKEN`
- ✅ **Certificate Validation**: `rejectUnauthorized: true` ensures certificate validation when CA is provided

### Integration with AuthGHPages

This workflow creates gists in the exact format expected by the AuthGHPages application. Users can then:
1. Access the gist via AuthGHPages
2. Fill in secret values (encrypted)
3. Update gist with real values
4. Status automatically updates to "updated"

### Troubleshooting

**Certificate Errors:**
- Ensure CA certificate is stored correctly in secrets (PEM format)
- Verify secret name matches what you provide in `ca_cert_secret`
- Check that certificate is valid and not corrupted

**Gist Creation Errors:**
- Verify GitHub token has `gist` scope/permission
- Check that token is valid and not expired
- Ensure network connectivity to GitHub/GHES
