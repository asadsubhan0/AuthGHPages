import fetch from "node-fetch";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { getAgent } from "../utils/agent.js";

/**
 * Encryption/Decryption utilities for secret values
 */
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET; // 32 bytes key
const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey() {
  // Ensure key is exactly 32 bytes for AES-256
  const key = Buffer.from(ENCRYPTION_KEY);
  if (key.length < 32) {
    // Pad with zeros if too short
    return Buffer.concat([key, Buffer.alloc(32 - key.length)], 32);
  }
  return key.slice(0, 32);
}

function encryptValue(text) {
  try {
    const iv = crypto.randomBytes(16); // Initialization vector
    const key = getEncryptionKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Return iv + authTag + encrypted data as a single string
    return `enc:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (err) {
    console.error('[ERROR] Encryption failed:', err);
    throw new Error('Encryption failed');
  }
}

function decryptValue(encryptedText) {
  try {
    // Check if value is encrypted
    if (!encryptedText.startsWith('enc:')) {
      return encryptedText; // Not encrypted, return as is
    }
    
    const parts = encryptedText.split(':');
    if (parts.length !== 4) {
      console.error('[ERROR] Invalid encrypted format');
      return encryptedText;
    }
    
    const iv = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const encrypted = parts[3];
    
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (err) {
    console.error('[ERROR] Decryption failed:', err);
    return encryptedText; // Return as is if decryption fails
  }
}

/**
 * Parse gist content to extract variables
 * Supports JSON or key-value pairs (key=value, one per line)
 */
function parseGistContent(content) {
  let variables = {};
  try {
    // Try parsing as JSON first
    variables = JSON.parse(content);
  } catch {
    // Try parsing as simple key-value pairs (one per line)
    content.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length) {
        variables[key.trim()] = valueParts.join('=').trim();
      }
    });
  }
  return variables;
}

/**
 * Fetch a gist and return its variables
 * Only returns variables with values "TBC" or "TBD"
 */
export async function fetchGist(req, res) {
  try {
    console.log(`[DEBUG] Fetching gist: ${req.params.gistId}`);
    const token = req.cookies.session_token;
    
    if (!token) {
      return res.status(401).json({ error: "missing token" });
    }
    
    // Verify token
    let decoded;
    try { 
      decoded = jwt.verify(token, process.env.JWT_SECRET); 
    } catch (e) { 
      return res.status(401).json({ error: "invalid/expired token" }); 
    }
    
    const oauthToken = decoded.at;
    const gistUrl = `${process.env.GH_BASE_URL.replace(/\/$/, "")}/gists/${req.params.gistId}`;
    
    console.log(`[DEBUG] Fetching gist from GitHub: ${gistUrl}`);
    const agent = getAgent(true);
    const gitResp = await fetch(gistUrl, {
      headers: { Authorization: `Bearer ${oauthToken}` },
      agent
    });
    
    if (!gitResp.ok) {
      console.error(`[DEBUG] GitHub gist fetch failed: ${gitResp.status}`);
      return res.status(gitResp.status).json({ error: await gitResp.text() });
    }
    
    const gistData = await gitResp.json();
    console.log(`[DEBUG] Gist fetched successfully`);
    
    // Parse the gist file content to extract variables
    // Use configured filename or default to first file
    const configuredFilename = process.env.GIST_FILENAME;
    let fileName;
    
    if (configuredFilename && gistData.files[configuredFilename]) {
      fileName = configuredFilename;
      console.log(`[DEBUG] Using configured filename: ${fileName}`);
    } else {
      fileName = Object.keys(gistData.files)[0];
      if (configuredFilename) {
        console.warn(`[WARN] Configured GIST_FILENAME "${configuredFilename}" not found in gist, using first file: ${fileName}`);
      } else {
        console.log(`[DEBUG] No GIST_FILENAME configured, using first file: ${fileName}`);
      }
    }
    
    console.log(`[DEBUG] Processing gist file: ${fileName}`);
    const content = gistData.files[fileName].content;
    
    const allVariables = parseGistContent(content);
    
    // Extract status object if it exists (look for "key_status")
    const statusObj = allVariables.key_status || {};
    console.log(`[DEBUG] Status object:`, JSON.stringify(statusObj, null, 2));
    
    // Filter only variables with TBC or TBD values, and check their status
    const editableVariables = {};
    for (const [key, value] of Object.entries(allVariables)) {
      // Skip the "key_status" variable itself
      if (key.toLowerCase() === 'key_status') {
        continue;
      }
      
      const normalizedValue = String(value).trim().toUpperCase();
      if (normalizedValue === 'TBC' || normalizedValue === 'TBD') {
        // Check if this key's status is "open"
        const keyStatus = statusObj[key];
        
        if (keyStatus && keyStatus.toLowerCase() !== 'open') {
          console.log(`[DEBUG] Skipping ${key} - status is "${keyStatus}" (not "open")`);
          continue;
        }
        
        console.log(`[DEBUG] Including ${key} - status is "${keyStatus || 'not set'}" (open or missing)`);
        editableVariables[key] = value;
      }
    }
    
    console.log(`[DEBUG] Found ${Object.keys(editableVariables).length} editable variables (TBC/TBD with "open" status) out of ${Object.keys(allVariables).length} total`);
    
    return res.json(editableVariables);
  } catch (err) {
    console.error("/gist/:gistId error", err);
    return res.status(500).json({ error: "server error" });
  }
}

/**
 * Update a gist with new values
 * Merges the provided updates with existing gist content
 */
export async function updateGist(req, res) {
  try {
    console.log(`[DEBUG] Updating gist: ${req.params.gistId}`, req.body);
    const token = req.cookies.session_token;
    
    if (!token) {
      return res.status(401).json({ error: "missing token" });
    }
    
    // Verify token
    let decoded;
    try { 
      decoded = jwt.verify(token, process.env.JWT_SECRET); 
    } catch (e) { 
      return res.status(401).json({ error: "invalid/expired token" }); 
    }
    
    const oauthToken = decoded.at;
    const gistUrl = `${process.env.GH_BASE_URL.replace(/\/$/, "")}/gists/${req.params.gistId}`;
    
    // Get current gist content
    console.log(`[DEBUG] Fetching current gist content`);
    const agent = getAgent(true);
    let gitResp = await fetch(gistUrl, {
      headers: { Authorization: `Bearer ${oauthToken}` },
      agent
    });
    
    if (!gitResp.ok) {
      console.error(`[DEBUG] Failed to fetch gist: ${gitResp.status}`);
      return res.status(gitResp.status).json({ error: await gitResp.text() });
    }
    
    const gistData = await gitResp.json();
    
    // Use configured filename or default to first file
    const configuredFilename = process.env.GIST_FILENAME;
    let fileName;
    
    if (configuredFilename && gistData.files[configuredFilename]) {
      fileName = configuredFilename;
      console.log(`[DEBUG] Using configured filename: ${fileName}`);
    } else {
      fileName = Object.keys(gistData.files)[0];
      if (configuredFilename) {
        console.warn(`[WARN] Configured GIST_FILENAME "${configuredFilename}" not found in gist, using first file: ${fileName}`);
      } else {
        console.log(`[DEBUG] No GIST_FILENAME configured, using first file: ${fileName}`);
      }
    }
    
    console.log(`[DEBUG] Updating gist file: ${fileName}`);
    const currentContent = gistData.files[fileName].content;
    
    // Parse current content
    const currentVariables = parseGistContent(currentContent);
    console.log(`[DEBUG] Current gist has ${Object.keys(currentVariables).length} variables`);
    
    // Encrypt the incoming values before merging
    const encryptedBody = {};
    for (const [key, value] of Object.entries(req.body)) {
      console.log(`[DEBUG] Encrypting value for ${key}`);
      encryptedBody[key] = encryptValue(String(value));
    }
    
    // Merge updates with existing content (only update provided keys)
    const updatedVariables = { ...currentVariables, ...encryptedBody };
    console.log(`[DEBUG] Updating ${Object.keys(req.body).length} variables`);
    
    // Update status for each variable that was changed
    if (!updatedVariables.key_status) {
      updatedVariables.key_status = {};
    }
    
    for (const key of Object.keys(req.body)) {
      console.log(`[DEBUG] Setting key_status.${key} to "updated"`);
      updatedVariables.key_status[key] = "updated";
    }
    
    // Convert back to JSON string
    const updatedContent = JSON.stringify(updatedVariables, null, 2);
    
    console.log(`[DEBUG] Updating gist content`);
    gitResp = await fetch(gistUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${oauthToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json"
      },
      body: JSON.stringify({
        files: {
          [fileName]: {
            content: updatedContent
          }
        }
      }),
      agent
    });
    
    if (!gitResp.ok) {
      const errorText = await gitResp.text();
      console.error(`[DEBUG] Failed to update gist: ${gitResp.status}`, errorText);
      return res.status(gitResp.status).json({ error: errorText });
    }
    
    console.log(`[DEBUG] Gist updated successfully`);
    return res.json({ ok: true, updated: Object.keys(req.body) });
  } catch (err) {
    console.error("/gist/:gistId POST error", err);
    return res.status(500).json({ error: "server error" });
  }
}

