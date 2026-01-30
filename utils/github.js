import fetch from "node-fetch";
import { getAgent } from "./agent.js";

const agent = getAgent();

export async function getUser(accessToken) {
  const url = `${process.env.GH_BASE_URL.replace(/\/$/, "")}/user`;
  console.log("[DEBUG] getUser - Fetching user info from:", url);
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, agent });
  console.log("[DEBUG] getUser - HTTP status:", resp.status);
  if (!resp.ok) {
    const errorText = await resp.text();
    console.error("[DEBUG] getUser failed:", resp.status, errorText);
    throw new Error(`getUser failed: ${resp.status} ${errorText}`);
  }
  const userData = await resp.json();
  console.log("[DEBUG] getUser - Success:", { login: userData.login, id: userData.id });
  return userData;
}

export async function getUserTeams(accessToken) {
  // Try /user/teams endpoint first
  const url = `${process.env.GH_BASE_URL.replace(/\/$/, "")}/user/teams`;
  console.log("[DEBUG] getUserTeams - Fetching teams from:", url);
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, agent });
  console.log("[DEBUG] getUserTeams - HTTP status:", resp.status);
  if (!resp.ok) {
    // return empty array on failure (caller will handle)
    const txt = await resp.text();
    console.error("[DEBUG] getUserTeams failed:", resp.status, txt);
    throw new Error(`getUserTeams failed: ${resp.status} ${txt}`);
  }
  const teamsData = await resp.json();
  console.log("[DEBUG] getUserTeams - Raw response:", JSON.stringify(teamsData, null, 2));
  
  // Check if response is paginated (contains 'total_count' or is wrapped)
  let teams;
  if (Array.isArray(teamsData)) {
    teams = teamsData;
  } else if (teamsData.teams && Array.isArray(teamsData.teams)) {
    teams = teamsData.teams;
  } else {
    teams = teamsData;
  }
  
  console.log("[DEBUG] getUserTeams - Success:", { 
    count: teams.length,
    teams: teams.map(t => ({ 
      name: t.name, 
      slug: t.slug, 
      org: t.organization?.login,
      orgName: t.organization?.login 
    }))
  });
  return teams;
}

export async function getUserOrgTeams(accessToken, orgName) {
  // Alternative: fetch teams from a specific organization
  const url = `${process.env.GH_BASE_URL.replace(/\/$/, "")}/orgs/${orgName}/teams`;
  console.log("[DEBUG] getUserOrgTeams - Fetching organization teams from:", url);
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, agent });
  console.log("[DEBUG] getUserOrgTeams - HTTP status:", resp.status);
  if (!resp.ok) {
    const txt = await resp.text();
    console.error("[DEBUG] getUserOrgTeams failed:", resp.status, txt);
    return [];
  }
  const teamsData = await resp.json();
  console.log("[DEBUG] getUserOrgTeams - Raw response:", JSON.stringify(teamsData, null, 2));
  console.log("[DEBUG] getUserOrgTeams - Success:", { 
    count: teamsData.length,
    teams: teamsData.map(t => ({ name: t.name, slug: t.slug }))
  });
  return teamsData;
}

export async function checkUserTeamMembership(accessToken, orgName, teamSlug, username) {
  // Check if a user is a member of a specific team
  const url = `${process.env.GH_BASE_URL.replace(/\/$/, "")}/orgs/${orgName}/teams/${teamSlug}/memberships/${username}`;
  console.log("[DEBUG] checkUserTeamMembership - Checking membership:", url);
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, agent });
  console.log("[DEBUG] checkUserTeamMembership - HTTP status:", resp.status);
  if (resp.status === 404) {
    console.log("[DEBUG] User is not a member of the team");
    return false;
  }
  if (!resp.ok) {
    const txt = await resp.text();
    console.error("[DEBUG] checkUserTeamMembership failed:", resp.status, txt);
    return false;
  }
  const membershipData = await resp.json();
  console.log("[DEBUG] checkUserTeamMembership - Raw response:", JSON.stringify(membershipData, null, 2));
  const isMember = membershipData.state === 'active';
  console.log("[DEBUG] checkUserTeamMembership - Is member:", isMember);
  return isMember;
}

export async function dispatchWorkflowUsingUserToken(accessToken, owner, repo, workflowFile, ref, inputs = {}) {
  const url = `${process.env.GH_BASE_URL.replace(/\/$/, "")}/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`;
  console.log("[DEBUG] dispatchWorkflow - Dispatching workflow:", { owner, repo, workflowFile, ref, inputs });
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ref, inputs }),
    agent
  });
  console.log("[DEBUG] dispatchWorkflow - HTTP status:", resp.status);
  return resp;
}
