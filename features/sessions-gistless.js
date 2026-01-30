// In-memory session store for gistless flow
const sessions = new Map(); // sessionId -> sessionData
const workflowRunIdMap = new Map(); // workflow_run_id -> sessionId

/**
 * Generate a unique session ID
 */
function generateSessionId() {
  return `sess-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Create a new session from workflow metadata
 * @param {Object} metadata - Complete workflow metadata from pipeline
 * @returns {Object} Created session object
 */
export function createSession(metadata) {
  console.log(`[SESSIONS] Creating new session for workflow run_id: ${metadata.workflow?.run_id}`);
  
  const sessionId = generateSessionId();
  const workflowRunId = metadata.workflow?.run_id;
  
  // Parse secrets_needs_input into array
  const secretsNeedsInput = metadata.secrets_needs_input || '';
  const pendingKeys = secretsNeedsInput.split(',').map(k => k.trim()).filter(Boolean);
  
  const session = {
    sessionId,
    metadata: {
      ...metadata,
      createdAt: new Date().toISOString(),
      status: 'awaiting_input'
    },
    secrets: {
      pending: pendingKeys,
      completed: [], // Array of { key, encryptedValue, submittedBy, timestamp }
      status: {} // key -> 'pending' | 'completed'
    },
    vault: {
      url: metadata.computed_config?.vault_url,
      engine: metadata.computed_config?.vault_engine,
      lastFetched: null,
      lastUpdated: null
    },
    encryption: {
      encKey: metadata.encryption_key, // Full encryption key
      keysToEncrypt: metadata.inputs?.listOfKeysToBeEncrypted?.split(',').map(k => k.trim()).filter(Boolean) || []
    },
    workflow: {
      runId: workflowRunId,
      owner: metadata.workflow?.owner,
      repo: metadata.workflow?.repository,
      ref: metadata.workflow?.ref
    },
    audit: [] // Log all actions
  };
  
  // Initialize status for all pending keys
  pendingKeys.forEach(key => {
    session.secrets.status[key] = 'pending';
  });
  
  sessions.set(sessionId, session);
  
  // Map workflow_run_id to sessionId for lookup
  if (workflowRunId) {
    workflowRunIdMap.set(workflowRunId, sessionId);
    console.log(`[SESSIONS] Mapped workflow_run_id ${workflowRunId} to sessionId ${sessionId}`);
  }
  
  console.log(`[SESSIONS] Created session ${sessionId} with ${pendingKeys.length} pending secrets`);
  console.log(`[SESSIONS] Pending keys: ${pendingKeys.join(', ')}`);
  
  return session;
}

/**
 * Get session by sessionId
 * @param {string} sessionId - Session ID
 * @returns {Object|null} Session object or null if not found
 */
export function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    console.log(`[SESSIONS] Retrieved session ${sessionId}, status: ${session.metadata.status}, pending: ${session.secrets.pending.length}`);
  } else {
    console.log(`[SESSIONS] Session ${sessionId} not found`);
  }
  return session || null;
}

/**
 * Find session by workflow_run_id
 * @param {string} workflowRunId - Workflow run ID
 * @returns {Object|null} Session object or null if not found
 */
export function findSessionByWorkflowRunId(workflowRunId) {
  const sessionId = workflowRunIdMap.get(workflowRunId);
  if (!sessionId) {
    console.log(`[SESSIONS] No session found for workflow_run_id: ${workflowRunId}`);
    return null;
  }
  
  const session = sessions.get(sessionId);
  if (session) {
    console.log(`[SESSIONS] Found session ${sessionId} for workflow_run_id ${workflowRunId}`);
  }
  return session || null;
}

/**
 * Update session when a secret is submitted
 * @param {string} sessionId - Session ID
 * @param {string} key - Secret key
 * @param {string} encryptedValue - Encrypted secret value
 * @param {string} submittedBy - Username who submitted
 * @returns {Object} Updated session
 */
export function updateSessionSecret(sessionId, key, encryptedValue, submittedBy) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  
  console.log(`[SESSIONS] Updating secret ${key} in session ${sessionId} by user ${submittedBy}`);
  
  // Add to completed
  session.secrets.completed.push({
    key,
    encryptedValue: '*****', // Don't log actual encrypted value
    submittedBy,
    timestamp: new Date().toISOString()
  });
  
  // Remove from pending
  session.secrets.pending = session.secrets.pending.filter(k => k !== key);
  session.secrets.status[key] = 'completed';
  
  // Update status
  const wasCompleted = session.metadata.status === 'completed';
  session.metadata.status = session.secrets.pending.length === 0 ? 'completed' : 'awaiting_input';
  
  // Add audit log
  session.audit.push({
    action: 'secret_submitted',
    key,
    submittedBy,
    timestamp: new Date().toISOString(),
    remainingPending: session.secrets.pending.length
  });
  
  if (session.metadata.status === 'completed' && !wasCompleted) {
    console.log(`[SESSIONS] ✅ All secrets completed for session ${sessionId}`);
    session.audit.push({
      action: 'all_secrets_completed',
      timestamp: new Date().toISOString(),
      completedBy: submittedBy
    });
  }
  
  console.log(`[SESSIONS] Session ${sessionId} updated. Remaining pending: ${session.secrets.pending.length}`);
  
  return session;
}

/**
 * Get all sessions (for debugging/admin)
 * @returns {Array} Array of all sessions
 */
export function getAllSessions() {
  const allSessions = Array.from(sessions.values());
  console.log(`[SESSIONS] Retrieved ${allSessions.length} total sessions`);
  return allSessions;
}

/**
 * Get session statistics
 * @returns {Object} Statistics about sessions
 */
export function getSessionStats() {
  const allSessions = Array.from(sessions.values());
  return {
    total: allSessions.length,
    awaitingInput: allSessions.filter(s => s.metadata.status === 'awaiting_input').length,
    completed: allSessions.filter(s => s.metadata.status === 'completed').length,
    totalPendingSecrets: allSessions.reduce((sum, s) => sum + s.secrets.pending.length, 0),
    totalCompletedSecrets: allSessions.reduce((sum, s) => sum + s.secrets.completed.length, 0)
  };
}


/**
 * Delete a specific session by sessionId
 * Removes from both sessions Map and workflowRunIdMap
 * 
 * @param {string} sessionId - Session ID to delete
 * @returns {boolean} True if session was found and deleted
 */
export function purgeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    console.log(`[SESSIONS] Session ${sessionId} not found for purge`);
    return false;
  }
  
  const workflowRunId = session.workflow?.runId;
  
  // Remove from sessions Map
  sessions.delete(sessionId);
  console.log(`[SESSIONS] ✅ Deleted session ${sessionId} from sessions Map`);
  
  // Remove from workflowRunIdMap if exists
  if (workflowRunId) {
    const mappedSessionId = workflowRunIdMap.get(workflowRunId);
    if (mappedSessionId === sessionId) {
      workflowRunIdMap.delete(workflowRunId);
      console.log(`[SESSIONS] ✅ Removed workflow_run_id ${workflowRunId} mapping`);
    }
  }
  
  console.log(`[SESSIONS] ✅ Successfully purged session ${sessionId}`);
  return true;
}

/**
 * Purge all completed sessions (status === 'completed')
 * Useful for cleanup after downstream workflow is triggered
 * 
 * @returns {Object} Purge statistics
 */
export function purgeCompletedSessions() {
  const allSessions = Array.from(sessions.values());
  const completedSessions = allSessions.filter(s => s.metadata.status === 'completed');
  
  console.log(`[SESSIONS] Purging ${completedSessions.length} completed sessions out of ${allSessions.length} total`);
  
  let purgedCount = 0;
  const purgedSessionIds = [];
  
  for (const session of completedSessions) {
    const sessionId = session.sessionId;
    const workflowRunId = session.workflow?.runId;
    
    // Remove from sessions Map
    sessions.delete(sessionId);
    purgedSessionIds.push(sessionId);
    purgedCount++;
    
    // Remove from workflowRunIdMap if exists
    if (workflowRunId) {
      const mappedSessionId = workflowRunIdMap.get(workflowRunId);
      if (mappedSessionId === sessionId) {
        workflowRunIdMap.delete(workflowRunId);
      }
    }
  }
  
  console.log(`[SESSIONS] ✅ Purged ${purgedCount} completed sessions`);
  console.log(`[SESSIONS] Remaining sessions: ${sessions.size}`);
  
  return {
    purged: purgedCount,
    remaining: sessions.size,
    purgedSessionIds
  };
}