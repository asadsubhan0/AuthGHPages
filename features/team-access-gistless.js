import secretTeamConfig from "../config/secret-teams-gistless.json" assert { type: "json" };
import { checkUserTeamMembership } from "../utils/github.js";

/**
 * Resolves which team is required for a secret key based on key name patterns
 * 
 * @param {string} key - Secret key name
 * @returns {Object} Team configuration { teamSlug, userIds }
 */
export function resolveTeamForSecret(key) {
  const keyLower = key.toLowerCase();
  
  console.log(`[TEAM-ACCESS] Resolving team for key: "${key}"`);
  
  // Check for pattern matches (in order of specificity)
  for (const [pattern, config] of Object.entries(secretTeamConfig)) {
    if (pattern !== "*" && keyLower.includes(pattern.toLowerCase())) {
      console.log(`[TEAM-ACCESS] Key "${key}" matches pattern "${pattern}", requires team: ${config.teamSlug}`);
      return config;
    }
  }
  
  // Fallback to default
  const defaultConfig = secretTeamConfig["*"];
  console.log(`[TEAM-ACCESS] Key "${key}" using default team: ${defaultConfig.teamSlug}`);
  return defaultConfig;
}

/**
 * Verifies if user has access to submit a specific secret
 * Checks team membership via GitHub API
 * 
 * @param {Object} user - User object { login, accessToken }
 * @param {string} key - Secret key name
 * @param {Object} session - Session object (contains metadata with org name)
 * @returns {Promise<boolean>} True if user has access
 */
export async function verifyKeyAccess(user, key, session) {
  const teamConfig = resolveTeamForSecret(key);
  const orgName = session.metadata?.environment?.ORG_NAME || process.env.ORG_NAME;
  
  if (!orgName) {
    console.error(`[TEAM-ACCESS] ❌ ORG_NAME not found in session or environment`);
    return false;
  }
  
  console.log(`[TEAM-ACCESS] Verifying access for user "${user.login}" to key "${key}"`);
  console.log(`[TEAM-ACCESS] Required team: ${teamConfig.teamSlug} in org: ${orgName}`);
  
  try {
    const hasTeamAccess = await checkUserTeamMembership(
      user.accessToken,
      orgName,
      teamConfig.teamSlug,
      user.login
    );
    
    if (hasTeamAccess) {
      console.log(`[TEAM-ACCESS] ✅ User "${user.login}" is authorized for key "${key}" (team: ${teamConfig.teamSlug})`);
    } else {
      console.log(`[TEAM-ACCESS] ❌ User "${user.login}" is NOT authorized for key "${key}" (not in team: ${teamConfig.teamSlug})`);
    }
    
    return hasTeamAccess;
  } catch (err) {
    console.error(`[TEAM-ACCESS] ❌ Error checking team membership:`, err.message);
    return false;
  }
}

/**
 * Filter pending secrets based on user's team memberships
 * Returns only secrets the user is authorized to access
 * 
 * @param {Object} user - User object { login, accessToken }
 * @param {string[]} pendingKeys - Array of pending secret keys
 * @param {Object} session - Session object
 * @returns {Promise<string[]>} Filtered array of authorized keys
 */
export async function filterAuthorizedKeys(user, pendingKeys, session) {
  console.log(`[TEAM-ACCESS] Filtering ${pendingKeys.length} pending keys for user "${user.login}"`);
  
  const authorizedKeys = [];
  const orgName = session.metadata?.environment?.ORG_NAME || process.env.ORG_NAME;
  
  for (const key of pendingKeys) {
    const teamConfig = resolveTeamForSecret(key);
    
    try {
      const hasAccess = await checkUserTeamMembership(
        user.accessToken,
        orgName,
        teamConfig.teamSlug,
        user.login
      );
      
      if (hasAccess) {
        authorizedKeys.push(key);
        console.log(`[TEAM-ACCESS] ✅ User authorized for key: "${key}"`);
      } else {
        console.log(`[TEAM-ACCESS] ❌ User NOT authorized for key: "${key}" (requires team: ${teamConfig.teamSlug})`);
      }
    } catch (err) {
      console.error(`[TEAM-ACCESS] ❌ Error checking access for key "${key}":`, err.message);
      // Don't include key if check fails
    }
  }
  
  console.log(`[TEAM-ACCESS] User "${user.login}" authorized for ${authorizedKeys.length} of ${pendingKeys.length} keys`);
  return authorizedKeys;
}

