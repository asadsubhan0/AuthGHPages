import express from "express";
import fetch from "node-fetch";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import cookieParser from "cookie-parser";
import { getUser, getUserTeams, checkUserTeamMembership } from "./utils/github.js";
import { getAgent } from "./utils/agent.js";
import { 
  createSession, 
  getSession, 
  findSessionByWorkflowRunId,
  updateSessionSecret,
  getSessionStats,
  getAllSessions
} from "./features/sessions-gistless.js";
import { 
  fetchVaultPayload, 
  updateSingleVaultKey 
} from "./features/vault-operations-gistless.js";
import { 
  processSecretValue 
} from "./features/encryption-gistless.js";
import { 
  verifyKeyAccess,
  filterAuthorizedKeys
} from "./features/team-access-gistless.js";
import { 
  triggerDownstreamWorkflow 
} from "./features/workflow-trigger-gistless.js";

dotenv.config();

const app = express();

// Enable CORS for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://github.adib.co.ae');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
app.use(cookieParser());

const {
  PORT = "3000",
  HOST_ROUTE_HOST,
  GH_BASE_URL,
  GH_CLIENT_ID,
  GH_CLIENT_SECRET,
  GH_PAGES_URL,
  ORG_NAME,
  TEAM_SLUG,
  JWT_SECRET,
  PIPELINE_AUTH_TOKEN
} = process.env;

if (!GH_BASE_URL || !GH_CLIENT_ID || !GH_CLIENT_SECRET || !JWT_SECRET || !HOST_ROUTE_HOST) {
  console.error("[INIT] ❌ Missing required env vars. Check GH_BASE_URL, GH_CLIENT_ID, GH_CLIENT_SECRET, JWT_SECRET, HOST_ROUTE_HOST");
  process.exit(1);
}

if (!PIPELINE_AUTH_TOKEN) {
  console.warn("[INIT] ⚠️ PIPELINE_AUTH_TOKEN not set - pipeline authentication will fail");
}

console.log("[INIT] ✅ Backend initialized with gistless flow");
console.log(`[INIT] Route host: ${HOST_ROUTE_HOST}`);
console.log(`[INIT] GitHub Pages URL: ${GH_PAGES_URL}`);

/**
 * Helper: make the GHES oauth authorize URL
 */
function oauthAuthorizeUrl(state) {
  const base = GH_BASE_URL.replace(/\/api\/v3\/?$/i, "");
  const redirectUri = `https://${HOST_ROUTE_HOST}/auth/callback`;
  return `${base}/login/oauth/authorize?client_id=${encodeURIComponent(GH_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:org&state=${encodeURIComponent(state)}`;
}

// ============================================
// AUTHENTICATION ENDPOINTS (Unchanged)
// ============================================

// 1) login - redirect to GHES login
app.get("/auth/login", (req, res) => {
  console.log("[AUTH] /auth/login called");
  
  // Capture return URL (original page with query params) to restore after OAuth
  const returnUrl = req.query.returnUrl || req.query.return_url || GH_PAGES_URL || `https://${HOST_ROUTE_HOST}/`;
  res.cookie('oauth_return_url', returnUrl, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    domain: '.adib.co.ae',
    maxAge: 5 * 60 * 1000 // 5 minutes
  });
  const state = Math.random().toString(36).slice(2, 10);
  
  // Store returnUrl in a simple in-memory map (or use JWT in state)
  // For simplicity, encode it in the state parameter
  const stateWithReturn = Buffer.from(JSON.stringify({ state, returnUrl })).toString('base64');
  
  const authorizeUrl = oauthAuthorizeUrl(stateWithReturn);
  console.log("[AUTH] Redirecting to OAuth with returnUrl:", returnUrl);
  console.log("[AUTH] OAuth URL:", authorizeUrl);
  return res.redirect(authorizeUrl);
});

// 2) callback - exchange code and validate team
app.get("/auth/callback", async (req, res) => {
  console.log("[AUTH] /auth/callback called");
  try {
    const { code, state } = req.query;
    console.log("[AUTH] Received OAuth callback with code:", code ? "present" : "missing");
    
    if (!code) return res.status(400).send("missing code");

    // Decode returnUrl from state if present
    let returnUrl = req.cookies.oauth_return_url || GH_PAGES_URL || `https://${HOST_ROUTE_HOST}/`;
    // let returnUrl = GH_PAGES_URL || `https://${HOST_ROUTE_HOST}/`;
    try {
      if (state) {
        const decodedState = JSON.parse(Buffer.from(state, 'base64').toString());
        if (decodedState.returnUrl) {
          returnUrl = decodedState.returnUrl;
          console.log("[AUTH] Restoring returnUrl from state:", returnUrl);
        }
      }
    } catch (e) {
      console.log("[AUTH] Could not decode state, using default redirect");
    }

    // Exchange code for access token
    const base = GH_BASE_URL.replace(/\/api\/v3\/?$/i, "");
    const tokenUrl = `${base}/login/oauth/access_token`;
    console.log("[AUTH] Exchanging code for token");
    
    const agent = getAgent(true);
    const tokenResp = await fetch(tokenUrl, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: GH_CLIENT_ID, client_secret: GH_CLIENT_SECRET, code }),
      agent
    });
    
    const tokenJson = await tokenResp.json();
    const accessToken = tokenJson.access_token;
    if (!accessToken) {
      console.error("[AUTH] ❌ OAuth token exchange failed");
      return res.status(500).send("oauth token exchange failed");
    }

    // Get user info
    console.log("[AUTH] Fetching user info");
    const user = await getUser(accessToken);
    const username = user.login;
    console.log(`[AUTH] ✅ User logged in: ${username}`);

    // Verify team membership - check if user is in ANY authorized team
    console.log("[AUTH] Checking user team memberships");
    const teams = await getUserTeams(accessToken);
    console.log(`[AUTH] User belongs to ${teams.length} teams`);
    
    // Check if user is in at least one of the authorized teams
    // For now, we allow any user who can authenticate (team check happens per-secret)
    // But you can add a global team check here if needed
    
    // Create JWT
    console.log(`[AUTH] Creating JWT session for user: ${username}`);
    const jwtPayload = { login: username, at: accessToken };
    const token = jwt.sign(jwtPayload, JWT_SECRET, { expiresIn: "15m" });

    // Set cookie
    res.cookie('session_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      domain: '.adib.co.ae',
      maxAge: 15 * 60 * 1000
    });

    console.log(`[AUTH] ✅ Session created for user: ${username}`);
    console.log(`[AUTH] Redirecting to: ${returnUrl}`);

    // Redirect to the original URL (with query params preserved)
    res.clearCookie('oauth_return_url', { domain: '.adib.co.ae', sameSite: 'Lax', secure: true });
    return res.redirect(returnUrl);
  } catch (err) {
    console.error("[AUTH] ❌ Auth callback error:", err);
    return res.status(500).send("authentication error");
  }
});

// 3) verify token (frontend calls on load)
app.get("/auth/verify", (req, res) => {
  const token = req.cookies.session_token;
  
  if (!token) {
    console.log("[AUTH] /auth/verify called - no token");
    return res.status(400).json({ valid: false, error: "missing token" });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log(`[AUTH] ✅ Token verified for user: ${decoded.login}`);
    return res.json({ valid: true, user: decoded.login, exp: decoded.exp });
  } catch (e) {
    console.log(`[AUTH] ❌ Token verification failed: ${e.message}`);
    return res.status(401).json({ valid: false, error: "invalid or expired token" });
  }
});

// ============================================
// MIDDLEWARE
// ============================================

/**
 * Middleware to verify pipeline token
 */
function verifyPipelineToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log("[AUTH] ❌ Pipeline request missing or invalid authorization header");
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  
  const token = authHeader.substring(7);
  const expectedToken = PIPELINE_AUTH_TOKEN;
  
  if (token !== expectedToken) {
    console.log("[AUTH] ❌ Pipeline request with invalid token");
    return res.status(403).json({ error: 'Invalid pipeline token' });
  }
  
  console.log("[AUTH] ✅ Pipeline token verified");
  next();
}

/**
 * Middleware to verify user session
 */
function verifyUserSession(req, res, next) {
  const token = req.cookies.session_token;
  if (!token) {
    console.log("[AUTH] ❌ User request missing session token");
    return res.status(401).json({ error: 'Missing session token' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { login: decoded.login, accessToken: decoded.at };
    console.log(`[AUTH] ✅ User session verified: ${decoded.login}`);
    next();
  } catch (e) {
    console.log(`[AUTH] ❌ User session verification failed: ${e.message}`);
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// ============================================
// SESSION ENDPOINTS
// ============================================

/**
 * POST /api/sessions
 * Pipeline registers session with metadata
 */
app.post("/api/sessions", verifyPipelineToken, async (req, res) => {
  try {
    console.log("[SESSIONS] ========================================");
    console.log("[SESSIONS] 📥 Received session registration request");
    console.log("[SESSIONS] ========================================");
    
    const metadata = req.body;
    
    // Log received metadata (sanitized)
    console.log(`[SESSIONS] Workflow run_id: ${metadata.workflow?.run_id}`);
    console.log(`[SESSIONS] Microservice: ${metadata.inputs?.MSName}`);
    console.log(`[SESSIONS] Build environment: ${metadata.inputs?.build_env}`);
    console.log(`[SESSIONS] Secrets needed: ${metadata.secrets_needs_input}`);
    console.log(`[SESSIONS] Pending secrets count: ${(metadata.secrets_needs_input || '').split(',').filter(k => k.trim()).length}`);
    
    // Validate required fields
    if (!metadata.workflow?.run_id || !metadata.secrets_needs_input) {
      console.error("[SESSIONS] ❌ Missing required fields: workflow.run_id or secrets_needs_input");
      return res.status(400).json({ error: 'Missing required fields: workflow.run_id or secrets_needs_input' });
    }
    
    // Create session
    const session = createSession(metadata);
    
    // Build approval URL (pipeline already built it, but we can override if needed)
    const approvalUrl = metadata.approval_url || `${GH_PAGES_URL}?msname=${encodeURIComponent(metadata.inputs?.MSName || '')}&workflow_run_id=${metadata.workflow.run_id}`;
    
    console.log(`[SESSIONS] ✅ Created session ${session.sessionId} for workflow ${metadata.workflow.run_id}`);
    console.log(`[SESSIONS] Approval URL: ${approvalUrl}`);
    console.log(`[SESSIONS] ========================================`);
    
    res.json({
      sessionId: session.sessionId,
      approvalUrl,
      status: 'created',
      pendingSecrets: session.secrets.pending.length
    });
  } catch (err) {
    console.error("[SESSIONS] ❌ Failed to create session:", err);
    res.status(500).json({ error: 'Failed to create session', message: err.message });
  }
});

/**
 * GET /api/sessions/by-run-id/:workflowRunId
 * Frontend uses this to get sessionId from workflow_run_id
 */
app.get("/api/sessions/by-run-id/:workflowRunId", verifyUserSession, async (req, res) => {
  try {
    const { workflowRunId } = req.params;
    const user = req.user;
    
    console.log(`[SESSIONS] User ${user.login} requesting session for workflow_run_id: ${workflowRunId}`);
    
    const session = findSessionByWorkflowRunId(workflowRunId);
    
    if (!session) {
      console.log(`[SESSIONS] ❌ No session found for workflow_run_id: ${workflowRunId}`);
      return res.status(404).json({ error: 'Session not found for this workflow run' });
    }
    
    console.log(`[SESSIONS] ✅ Found session ${session.sessionId} for workflow_run_id ${workflowRunId}`);
    
    res.json({
      sessionId: session.sessionId,
      workflowRunId: workflowRunId
    });
  } catch (err) {
    console.error("[SESSIONS] ❌ Error getting session by run ID:", err);
    res.status(500).json({ error: 'Failed to get session', message: err.message });
  }
});

/**
 * GET /api/sessions/:sessionId
 * Frontend fetches session to display pending secrets
 */
app.get("/api/sessions/:sessionId", verifyUserSession, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const user = req.user;
    
    console.log(`[SESSIONS] User ${user.login} fetching session: ${sessionId}`);
    
    const session = getSession(sessionId);
    
    if (!session) {
      console.log(`[SESSIONS] ❌ Session ${sessionId} not found`);
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Filter pending keys based on user's team access
    console.log(`[SESSIONS] Filtering authorized keys for user ${user.login}`);
    const authorizedKeys = await filterAuthorizedKeys(user, session.secrets.pending, session);
    
    if (authorizedKeys.length === 0 && session.secrets.pending.length > 0) {
      console.log(`[SESSIONS] ❌ User ${user.login} has no access to any pending secrets`);
      return res.status(403).json({ 
        error: 'No authorized secrets',
        message: 'You do not have access to any pending secrets for this workflow',
        pendingCount: session.secrets.pending.length,
        authorizedCount: 0
      });
    }
    
    console.log(`[SESSIONS] ✅ User ${user.login} authorized for ${authorizedKeys.length} of ${session.secrets.pending.length} secrets`);
    
    // Return session info with filtered keys
    res.json({
      sessionId: session.sessionId,
      metadata: {
        MSName: session.metadata.inputs?.MSName,
        buildEnv: session.metadata.inputs?.build_env,
        releaseVersion: session.metadata.inputs?.releaseVersion
      },
      secrets: {
        pending: authorizedKeys, // Only return authorized keys
        completed: session.secrets.completed.map(s => ({ key: s.key, timestamp: s.timestamp, submittedBy: s.submittedBy })),
        status: session.secrets.status
      },
      status: session.metadata.status
    });
  } catch (err) {
    console.error("[SESSIONS] ❌ Failed to get session:", err);
    res.status(500).json({ error: 'Failed to get session', message: err.message });
  }
});

/**
 * POST /api/sessions/:sessionId/secrets
 * Frontend submits a single secret value
 */
app.post("/api/sessions/:sessionId/secrets", verifyUserSession, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { key, value } = req.body;
    const user = req.user;
    
    console.log("[SECRETS] ========================================");
    console.log(`[SECRETS] 📥 Secret submission from user: ${user.login}`);
    console.log(`[SECRETS] Session: ${sessionId}`);
    console.log(`[SECRETS] Key: ${key}`);
    console.log(`[SECRETS] Value length: ${value ? value.length : 0} characters`);
    console.log("[SECRETS] ========================================");
    
    if (!key || !value) {
      console.error("[SECRETS] ❌ Missing key or value in request");
      return res.status(400).json({ error: 'Missing key or value' });
    }
    
    // Get session
    const session = getSession(sessionId);
    if (!session) {
      console.error(`[SECRETS] ❌ Session ${sessionId} not found`);
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Check if key is pending
    if (!session.secrets.pending.includes(key)) {
      console.error(`[SECRETS] ❌ Key "${key}" is not in pending list`);
      return res.status(400).json({ error: 'Key already processed or not in pending list' });
    }
    
    // Verify team access for this key
    console.log(`[SECRETS] Verifying team access for key: ${key}`);
    const hasAccess = await verifyKeyAccess(user, key, session);
    if (!hasAccess) {
      console.error(`[SECRETS] ❌ User ${user.login} not authorized for key "${key}"`);
      return res.status(403).json({ 
        error: 'User not authorized for this secret key',
        key: key
      });
    }
    
    console.log(`[SECRETS] ✅ User ${user.login} authorized for key "${key}"`);
    
    // Process and encrypt the value
    const buildEnv = session.metadata.inputs?.build_env?.toLowerCase() || '';
    const applicationNamespace = session.metadata.inputs?.application_namespace || '';
    const encKey = session.encryption.encKey;
    const keysToEncrypt = session.encryption.keysToEncrypt;
    
    console.log(`[SECRETS] Processing secret value for key: ${key}`);
    const processedValue = processSecretValue(
      key,
      value,
      buildEnv,
      applicationNamespace,
      encKey,
      keysToEncrypt
    );
    
    console.log(`[SECRETS] ✅ Secret processed (encrypted if needed)`);
    
    // Fetch current Vault payload
    const vaultUrl = session.vault.url;
    const vaultToken = session.metadata.github_secrets?.VAULT_TOKEN;
    
    if (!vaultUrl || !vaultToken) {
      console.error(`[SECRETS] ❌ Missing Vault URL or token`);
      return res.status(500).json({ error: 'Vault configuration missing' });
    }
    
    console.log(`[SECRETS] Fetching current Vault payload to update key: ${key}`);
    
    // Fetch current payload and update key
    const { fetchVaultPayload } = await import('./features/vault-operations-gistless.js');
    const currentPayload = await fetchVaultPayload(vaultUrl, vaultToken);
    
    // Update the specific key in payload
    if (!currentPayload.data) {
      currentPayload.data = {};
    }
    if (!currentPayload.data.data) {
      currentPayload.data.data = {};
    }
    
    const oldValue = currentPayload.data.data[key];
    currentPayload.data.data[key] = processedValue;
    
    // Log the updated payload JSON
    console.log(`[SECRETS] ========================================`);
    console.log(`[SECRETS] 📦 Updated Vault Payload JSON:`);
    console.log(`[SECRETS] ========================================`);
    console.log(JSON.stringify(currentPayload, null, 2));
    console.log(`[SECRETS] ========================================`);
    console.log(`[SECRETS] Key "${key}" ${oldValue ? 'updated' : 'added'} in payload`);
    console.log(`[SECRETS] Total keys in payload: ${Object.keys(currentPayload.data.data).length}`);
    
    // COMMENT OUT: Actual Vault push (uncomment when ready)
    // await updateSingleVaultKey(vaultUrl, vaultToken, key, processedValue);
    
    console.log(`[SECRETS] ⚠️ Vault push commented out - payload logged above`);
    // console.log(`[SECRETS] ✅ Vault updated successfully`);
    
    // Update session tracking
    updateSessionSecret(sessionId, key, processedValue, user.login);
    
    // Get updated session
    const updatedSession = getSession(sessionId);
    const allCompleted = updatedSession.metadata.status === 'completed';
    
    // If all secrets completed, trigger downstream workflow
    if (allCompleted) {
      console.log(`[SECRETS] 🎉 All secrets completed! Triggering downstream workflow...`);
      triggerDownstreamWorkflow(updatedSession).catch(err => {
        console.error("[SECRETS] ❌ Failed to trigger downstream workflow:", err);
        // Don't fail the request, just log error
      });
    }
    
    console.log(`[SECRETS] ✅ Secret submission completed`);
    console.log(`[SECRETS] Remaining pending: ${updatedSession.secrets.pending.length}`);
    console.log("[SECRETS] ========================================");
    
    res.json({
      ok: true,
      key,
      status: 'updated',
      pendingKeys: updatedSession.secrets.pending,
      allCompleted: allCompleted
    });
  } catch (err) {
    console.error("[SECRETS] ❌ Failed to submit secret:", err);
    res.status(500).json({ error: 'Failed to submit secret', message: err.message });
  }
});


// ============================================
// ADMIN/DEBUG ENDPOINTS
// ============================================

/**
 * GET /api/sessions/stats
 * Get session statistics (for debugging)
 */
app.get("/api/sessions/stats", verifyUserSession, (req, res) => {
  const stats = getSessionStats();
  console.log("[ADMIN] Session stats requested by:", req.user.login);
  res.json(stats);
});

/**
 * GET /api/sessions
 * Get all sessions (for debugging - should be restricted in production)
 */
app.get("/api/sessions", verifyUserSession, (req, res) => {
  console.log("[ADMIN] All sessions requested by:", req.user.login);
  const sessions = getAllSessions();
  
  // Sanitize sensitive data
  const sanitized = sessions.map(s => ({
    sessionId: s.sessionId,
    workflowRunId: s.workflow.runId,
    status: s.metadata.status,
    pendingCount: s.secrets.pending.length,
    completedCount: s.secrets.completed.length,
    createdAt: s.metadata.createdAt,
    MSName: s.metadata.inputs?.MSName
  }));
  
  res.json(sanitized);
});

// ============================================
// HEALTH & STATIC
// ============================================

app.get("/health", (_, res) => {
  res.json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    stats: getSessionStats()
  });
});

// Serve the HTML page (this route should be last as it's a catch-all)
app.get("/", (req, res) => {
  try {
    const html = readFileSync("./index-gistless.html", "utf8");
    res.send(html);
  } catch (err) {
    console.error("[STATIC] Failed to read index-gistless.html:", err);
    // Fallback to index.html if gistless version doesn't exist
    try {
      const html = readFileSync("./index.html", "utf8");
      res.send(html);
    } catch (err2) {
      res.status(500).send("Internal server error");
    }
  }
});

// Start server
const LISTEN_PORT = parseInt(PORT, 10) || 3000;
app.listen(LISTEN_PORT, () => {
  console.log(`[INIT] ========================================`);
  console.log(`[INIT] 🚀 Gistless Backend Server Started`);
  console.log(`[INIT] ========================================`);
  console.log(`[INIT] Port: ${LISTEN_PORT}`);
  console.log(`[INIT] Route host: ${HOST_ROUTE_HOST}`);
  console.log(`[INIT] GitHub Pages: ${GH_PAGES_URL}`);
  console.log(`[INIT] ========================================`);
});

