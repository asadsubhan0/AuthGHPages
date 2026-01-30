import crypto from "crypto";

/**
 * Generate SHA1 hash and return first 32 characters
 * Replicates logic from mr-bh.groovy encWithHash (lines 150-159)
 * 
 * @param {string} input - Input string to hash
 * @returns {string} First 32 characters of SHA1 hash
 */
export function generateHash(input) {
  const hash = crypto.createHash('sha1').update(input).digest('hex');
  const result = hash.substring(0, 32);
  console.log(`[ENCRYPTION] Generated hash for "${input}": ${result.substring(0, 8)}...`);
  return result;
}

/**
 * Encrypts a secret value using Node.js crypto (AES-256-CBC)
 * Replicates logic from mr-bh.groovy resurrectZombie (lines 194-208)
 * This replaces the Java encrypt.Encrypt tool
 * 
 * @param {string} plainValue - Plain text secret value
 * @param {string} encKey - Encryption key (32 bytes)
 * @param {string} secretKey - The secret key name (for logging)
 * @returns {string} Encrypted value
 */
export function encryptSecret(plainValue, encKey, secretKey) {
  console.log(`[ENCRYPTION] Encrypting secret "${secretKey}" using Node.js crypto`);
  
  try {
    // Ensure key is exactly 32 bytes (256 bits)
    let keyBuf = Buffer.from(encKey);
    if (keyBuf.length < 32) {
      // Pad with zeros if too short
      keyBuf = Buffer.concat([keyBuf, Buffer.alloc(32 - keyBuf.length)], 32);
    } else {
      keyBuf = keyBuf.slice(0, 32);
    }
    
    // Generate random IV (16 bytes for AES)
    const iv = crypto.randomBytes(16);
    
    // Use AES-256-CBC (common for Java compatibility)
    const cipher = crypto.createCipheriv('aes-256-cbc', keyBuf, iv);
    
    // Encrypt
    let encrypted = cipher.update(plainValue, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Return IV + encrypted data (format: iv:encrypted)
    // This format should match what your Java tool produces
    const result = `${iv.toString('hex')}:${encrypted}`;
    
    console.log(`[ENCRYPTION] ✅ Successfully encrypted "${secretKey}"`);
    return result;
  } catch (err) {
    console.error(`[ENCRYPTION] ❌ Encryption failed for "${secretKey}":`, err.message);
    throw new Error(`Encryption failed: ${err.message}`);
  }
}

/**
 * Process secret value based on key type and encryption requirements
 * Replicates logic from mr-bh.groovy resurrectZombie (lines 174-212)
 * 
 * @param {string} secretKey - Secret key name
 * @param {string} plainValue - Plain text value from user
 * @param {string} buildEnvironment - Build environment (hodc/pcdc/etc)
 * @param {string} applicationNamespace - Application namespace
 * @param {string} encKey - Encryption key
 * @param {string[]} keysToEncrypt - List of keys that need encryption
 * @returns {string} Processed value (encrypted if needed, or special handling)
 */
export function processSecretValue(secretKey, plainValue, buildEnvironment, applicationNamespace, encKey, keysToEncrypt) {
  console.log(`[ENCRYPTION] Processing secret "${secretKey}"`);
  
  // Special handling for app.key-store-password in hodc/pcdc (line 178-179)
  if (secretKey === 'app.key-store-password' && (buildEnvironment === 'hodc' || buildEnvironment === 'pcdc')) {
    console.log(`[ENCRYPTION] Special handling: app.key-store-password in ${buildEnvironment}`);
    const hashValue = generateHash(`${applicationNamespace}-jks`);
    console.log(`[ENCRYPTION] Generated hash for key-store-password: ${hashValue.substring(0, 8)}...`);
    return hashValue;
  }
  
  // Special handling for app-config.secret-encryption.encryption-key (line 180-181)
  if (secretKey === 'app-config.secret-encryption.encryption-key') {
    console.log(`[ENCRYPTION] Special handling: returning encryption key itself`);
    return encKey;
  }
  
  // Check if key is in encryption list (line 195)
  if (keysToEncrypt.includes(secretKey)) {
    console.log(`[ENCRYPTION] Key "${secretKey}" is in encryption list, encrypting...`);
    return encryptSecret(plainValue, encKey, secretKey);
  }
  
  // No encryption needed
  console.log(`[ENCRYPTION] Key "${secretKey}" not in encryption list, returning plain value`);
  return plainValue;
}

/**
 * Get absolute encryption key from Vault or generate from namespace
 * Replicates logic from mr-bh.groovy getAbsoluteEncKey (lines 137-148)
 * 
 * @param {string} vaultUrl - Vault URL
 * @param {string} vaultToken - Vault token
 * @param {string} defaultKey - Default encryption key
 * @param {string} applicationNamespace - Application namespace for hash generation
 * @returns {Promise<string>} Resolved encryption key
 */
export async function getAbsoluteEncKey(vaultUrl, vaultToken, defaultKey, applicationNamespace) {
  console.log(`[ENCRYPTION] Getting absolute encryption key from Vault: ${vaultUrl}`);
  
  try {
    const { fetchVaultPayload } = await import('./vault-operations-gistless.js');
    const vaultData = await fetchVaultPayload(vaultUrl, vaultToken);
    const encKeyFromVault = vaultData.data?.data?.['app-config.secret-encryption.encryption-key'];
    
    if (encKeyFromVault && encKeyFromVault !== 'TBD' && encKeyFromVault.trim() !== '') {
      const key = encKeyFromVault.trim();
      console.log(`[ENCRYPTION] ✅ Using encryption key from Vault: ${key.substring(0, 8)}...`);
      return key;
    }
    
    // If TBD, generate from namespace hash (lines 150-159)
    if (encKeyFromVault === 'TBD') {
      console.log(`[ENCRYPTION] Key is TBD, generating from namespace hash`);
      const generatedKey = generateHash(applicationNamespace);
      console.log(`[ENCRYPTION] ✅ Generated key from namespace: ${generatedKey.substring(0, 8)}...`);
      return generatedKey;
    }
    
    // Fallback to default
    console.log(`[ENCRYPTION] Using default encryption key: ${defaultKey.substring(0, 8)}...`);
    return defaultKey;
  } catch (err) {
    console.error(`[ENCRYPTION] ❌ Failed to get encryption key:`, err.message);
    console.log(`[ENCRYPTION] Using default encryption key as fallback`);
    return defaultKey;
  }
}

