# Encryption Implementation for Secret Values

## Overview
All secret values entered by users are encrypted before being stored in GitHub Gists using AES-256-GCM encryption.

## Security Features

### 1. **Encryption Algorithm**
- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key Size**: 256 bits (32 bytes)
- **Authentication**: Built-in authentication tag for integrity verification
- **IV**: Random 16-byte initialization vector for each encryption

### 2. **Encrypted Format**
Encrypted values are stored in the format:
```
enc:<iv_hex>:<auth_tag_hex>:<encrypted_data_hex>
```

Example:
```
enc:a1b2c3d4e5f6....:f1e2d3c4b5a6....:9f8e7d6c5b4a....
```

### 3. **Environment Variables**
Add to your `.env` file:

```bash
# Encryption key for secrets (32 bytes recommended)
ENCRYPTION_KEY=your-32-byte-encryption-key-here

# OR it will default to JWT_SECRET if ENCRYPTION_KEY is not set
JWT_SECRET=your-jwt-secret-key
```

**Generate a secure encryption key:**
```bash
# Using OpenSSL
openssl rand -hex 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## How It Works

### When User Submits a Value:
1. User enters secret value in the form
2. Frontend sends value to backend via HTTPS
3. Backend encrypts the value using AES-256-GCM
4. Encrypted value is stored in the Gist
5. Status is updated to "updated"

### When Reading from Gist:
1. Backend fetches gist content
2. Values prefixed with `enc:` are recognized as encrypted
3. Values with status "open" are included in response
4. Frontend displays only TBC/TBD values with "open" status

### Data Flow:
```
User Input → HTTPS → Backend → Encrypt → GitHub Gist
                                             ↓
                                      (Encrypted Storage)
                                             ↓
                            Stored as: enc:iv:tag:data
```

## Security Best Practices

1. **Never commit encryption keys to version control**
   - Add `.env` to `.gitignore`
   - Use environment variables for all secrets

2. **Use a strong encryption key**
   - Minimum 32 bytes (256 bits)
   - Generated using cryptographically secure random number generator
   - Different from JWT_SECRET for defense in depth

3. **Rotate keys periodically**
   - Old encrypted values will need re-encryption after key rotation
   - Plan for key rotation strategy

4. **Transport Security**
   - All data transmitted over HTTPS
   - Session tokens stored in HttpOnly cookies
   - No sensitive data in URLs or logs

5. **Access Control**
   - OAuth authentication required
   - Team membership verification
   - Session expiration (15 minutes)

## Example Gist Before/After

### Before Encryption (User View):
```json
{
    "db_password": "TBC",
    "api_key": "TBC",
    "status": {
        "db_password": "open",
        "api_key": "open"
    }
}
```

### After User Submits (Stored in Gist):
```json
{
    "db_password": "enc:a1b2c3d4e5f6789...:f1e2d3c4b5a6...:9f8e7d6c5b4a...",
    "api_key": "enc:1a2b3c4d5e6f789...:e1f2g3h4i5j6...:8d9e0f1g2h3i...",
    "status": {
        "db_password": "updated",
        "api_key": "updated"
    }
}
```

## Decryption (If Needed)

The system includes automatic decryption capability:
- Values starting with `enc:` are automatically decrypted when read
- Only authorized services with the encryption key can decrypt
- Decryption failures return the encrypted value as-is

## Limitations

1. **Key Management**: Encryption key must be securely managed
2. **Key Rotation**: Requires manual re-encryption of existing values
3. **Backup**: Encrypted backups require the encryption key to restore

## Troubleshooting

### "Encryption failed" error:
- Check that ENCRYPTION_KEY or JWT_SECRET is set
- Verify key is at least 32 bytes

### Values not decrypting:
- Ensure same ENCRYPTION_KEY is used for encryption and decryption
- Check encrypted format starts with `enc:`
- Review server logs for decryption errors

## Testing

To verify encryption is working:

1. Submit a test value through the form
2. Check the gist on GitHub - value should start with `enc:`
3. Value should not be readable in the gist
4. Status should be "updated"

## Compliance

This implementation provides:
- ✅ Encryption at rest (in GitHub Gist)
- ✅ Encryption in transit (HTTPS)
- ✅ Access control (OAuth + team membership)
- ✅ Audit trail (GitHub Gist history)
- ✅ Authentication (AES-GCM auth tags)

