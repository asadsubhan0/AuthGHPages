import fetch from "node-fetch";
import { getAgent } from "../utils/agent.js";
import { purgeSession } from "./sessions-gistless.js";  // ADD THIS LINE
/**
 * Triggers downstream workflow (ams-pre-sit-dc.yml) when all secrets are completed
 * Replicates logic from mr-bh.groovy stage 'Update the deployment config file' (lines 60-79)
 * 
 * @param {Object} session - Session object with complete metadata
 * @returns {Promise<Object>} GitHub API response
 */
export async function triggerDownstreamWorkflow(session) {
  const buildEnv = session.metadata.inputs?.build_env?.toLowerCase() || '';
  
  console.log(`[WORKFLOW-TRIGGER] Checking if downstream workflow should be triggered`);
  console.log(`[WORKFLOW-TRIGGER] Build environment: ${buildEnv}`);
  
  // Use GIT_TOKEN for workflow dispatch as requested
  const gitToken = session.metadata.github_secrets?.GIT_TOKEN;
  if (!gitToken) {
    console.error(`[WORKFLOW-TRIGGER] ❌ GIT_TOKEN not found in session metadata`);
    throw new Error('GIT_TOKEN not available');
  }
  
  // Prepare updated payload (reflect completion)
  const totalSecrets = (session.secrets?.completed?.length || 0) + (session.secrets?.pending?.length || 0);
  const completedSecrets = session.secrets?.completed?.length || 0;

  const updatedPayload = {
    ...session.metadata,
    status: 'completed',
    completedAt: new Date().toISOString(),
    secrets_stats: {
      total: totalSecrets,
      completed: completedSecrets,
      pending: 0
    },
    audit: session.audit || []
  };

  // Determine workflow file based on build_env
  let workflowFile;
  if (buildEnv === 'dev' || buildEnv === 'sit') {
    workflowFile = 'main.yml';
  } else {
    console.log(
      `[WORKFLOW-TRIGGER] 🚫 No workflow triggered for build_env: ${buildEnv}`
    );
    return {
      ok: true,
      skipped: true,
      reason: `No downstream workflow configured for build_env=${buildEnv}`
    };
  }
  console.log(`[WORKFLOW-TRIGGER] Selected workflow file: ${workflowFile} for build_env: ${buildEnv}`);
  
  // Build API URL
  const baseUrl = session.metadata.environment?.GH_API || process.env.GH_BASE_URL;
  // Target fixed repo and workflow file as per requirement
  const owner = 'Microservices';
  const repo = 'ap-secondhalf';
  
  if (!baseUrl || !owner || !repo) {
    console.error(`[WORKFLOW-TRIGGER] ❌ Missing required workflow info: baseUrl=${baseUrl}, owner=${owner}, repo=${repo}`);
    throw new Error('Missing workflow information');
  }
  
  const workflowUrl = `${baseUrl}/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`;

  // Single string payload input
  const dispatchBody = {
    ref: 'main',
    inputs: {
      payload: JSON.stringify(updatedPayload)
    }
  };

  console.log(`[WORKFLOW-TRIGGER] Triggering workflow: ${workflowUrl}`);
  console.log(`[WORKFLOW-TRIGGER] Ref: ${dispatchBody.ref}`);
  console.log(`[WORKFLOW-TRIGGER] Sending single input 'payload' (stringified metadata)`);
  
  const agent = getAgent(true);
  
  try {
    const response = await fetch(workflowUrl, {
      method: 'POST',
      headers: {
        'Authorization': `token ${gitToken}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(dispatchBody),
      agent
    });
    
    // GitHub usually returns 204 No Content on success
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[WORKFLOW-TRIGGER] ❌ Workflow trigger failed: ${response.status} ${errorText}`);
      throw new Error(`Workflow trigger failed: ${response.status} ${errorText}`);
    }
    
    console.log(`[WORKFLOW-TRIGGER] ✅ Successfully triggered downstream workflow for session ${session.sessionId}`);
    console.log(`[WORKFLOW-TRIGGER] Response status: ${response.status}`);
    
//     // Purge session after successful workflow trigger
//     console.log(`[WORKFLOW-TRIGGER] Purging session ${session.sessionId} after successful workflow trigger`);
//     const purged = purgeSession(session.sessionId);
//     if (purged) {
//       console.log(`[WORKFLOW-TRIGGER] ✅ Session ${session.sessionId} purged successfully`);
//     } else {
//       console.log(`[WORKFLOW-TRIGGER] ⚠️ Session ${session.sessionId} not found for purge (may have been already deleted)`);
//     }
    
//     return { ok: true, status: response.status };
//   } catch (err) {
//     console.error(`[WORKFLOW-TRIGGER] ❌ Failed to trigger workflow:`, err.message);
//     throw err;
//   }
// }


