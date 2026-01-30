import fetch from "node-fetch";
import { getAgent } from "../utils/agent.js";

/**
 * Fetches current Vault payload
 * Replicates logic from mr-bh.groovy collectSecretsFromUsers (lines 88-100)
 * 
 * @param {string} vaultUrl - Vault API URL
 * @param {string} vaultToken - Vault authentication token
 * @returns {Promise<Object>} Vault data in format { data: { data: {...} } }
 */
export async function fetchVaultPayload(vaultUrl, vaultToken) {
  console.log(`[VAULT] Fetching payload from: ${vaultUrl}`);
  
  const agent = getAgent(true); // Allow self-signed certs
  
  try {
    const response = await fetch(vaultUrl, {
      method: 'GET',
      headers: {
        'X-Vault-Token': vaultToken
      },
      agent
    });
    
    if (!response.ok) {
      // If 404, return empty structure (new microservice)
      if (response.status === 404) {
        console.log(`[VAULT] Path not found (404), returning empty structure for new microservice`);
        return { data: { data: {} } };
      }
      const errorText = await response.text();
      console.error(`[VAULT] Fetch failed with status ${response.status}: ${errorText}`);
      throw new Error(`Vault fetch failed: ${response.status} ${errorText}`);
    }
    
    const json = await response.json();
    const dataCount = Object.keys(json.data?.data || {}).length;
    console.log(`[VAULT] ✅ Fetched ${dataCount} existing secrets from Vault`);
    
    // Vault returns: { data: { data: { key1: value1, key2: value2 } } }
    return json;
  } catch (err) {
    console.error(`[VAULT] ❌ Error fetching from Vault:`, err.message);
    throw err;
  }
}

/**
 * Updates Vault with new payload
 * Replicates logic from mr-bh.groovy addToHashi (lines 227-250)
 * 
 * @param {string} vaultUrl - Vault API URL
 * @param {string} vaultToken - Vault authentication token
 * @param {Object} payload - Payload object (should be { data: { data: {...} } })
 * @returns {Promise<Object>} Vault response
 */
export async function updateVaultPayload(vaultUrl, vaultToken, payload) {
  console.log(`[VAULT] Updating payload at: ${vaultUrl}`);
  
  const agent = getAgent(true);
  
  // Format payload as Vault expects: { data: { data: {...} } }
  const vaultPayload = {
    data: payload.data || payload
  };
  
  const keysCount = Object.keys(vaultPayload.data?.data || {}).length;
  console.log(`[VAULT] Updating ${keysCount} keys in Vault`);
  
  try {
    const response = await fetch(vaultUrl, {
      method: 'POST',
      headers: {
        'X-Vault-Token': vaultToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(vaultPayload),
      agent
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[VAULT] ❌ Update failed with status ${response.status}: ${errorText}`);
      throw new Error(`Vault update failed: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    console.log(`[VAULT] ✅ Successfully updated Vault with ${keysCount} keys`);
    return result;
  } catch (err) {
    console.error(`[VAULT] ❌ Error updating Vault:`, err.message);
    throw err;
  }
}

/**
 * Updates a single key in Vault
 * Fetches current payload, updates the key, and pushes back
 * 
 * @param {string} vaultUrl - Vault API URL
 * @param {string} vaultToken - Vault authentication token
 * @param {string} key - Secret key to update
 * @param {string} value - New value (already encrypted if needed)
 * @returns {Promise<Object>} Vault response
 */
export async function updateSingleVaultKey(vaultUrl, vaultToken, key, value) {
  console.log(`[VAULT] Updating single key "${key}" in Vault`);
  
  try {
    // Step 1: Fetch current payload
    const currentPayload = await fetchVaultPayload(vaultUrl, vaultToken);
    
    // Step 2: Update the specific key
    if (!currentPayload.data) {
      currentPayload.data = {};
    }
    if (!currentPayload.data.data) {
      currentPayload.data.data = {};
    }
    
    const oldValue = currentPayload.data.data[key];
    currentPayload.data.data[key] = value;
    
    console.log(`[VAULT] Key "${key}" ${oldValue ? 'updated' : 'added'} in payload`);
    
    // Step 3: Push updated payload back
    const result = await updateVaultPayload(vaultUrl, vaultToken, currentPayload);
    
    console.log(`[VAULT] ✅ Successfully updated key "${key}" in Vault`);
    return result;
  } catch (err) {
    console.error(`[VAULT] ❌ Failed to update key "${key}":`, err.message);
    throw err;
  }
}

