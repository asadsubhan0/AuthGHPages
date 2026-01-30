import https from "https";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

/**
 * Get an https agent for certificate handling
 * Used for making requests to GHES (which may have self-signed certificates)
 * 
 * @param {boolean} allowSelfSigned - If true and no cert is provided, allows self-signed certs (default: false)
 * @returns {https.Agent|undefined} https agent or undefined if no special handling needed
 */
export function getAgent(allowSelfSigned = false) {
  const caPath = process.env.GH_CA_CERT_PATH;
  
  if (caPath && fs.existsSync(caPath)) {
    const ca = fs.readFileSync(caPath, "utf8");
    return new https.Agent({ ca, rejectUnauthorized: true });
  }
  
  // If no cert file provided and self-signed allowed, disable certificate verification
  if (allowSelfSigned) {
    return new https.Agent({ rejectUnauthorized: false });
  }
  
  // Return undefined to use default https agent
  return undefined;
}

