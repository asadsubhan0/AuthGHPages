# Secure GitHub Interactive Input Workflow Trigger System

This project provides a **secure, end-to-end system** to trigger GitHub Actions workflows from a GitHub Pages frontend using a Node.js backend. All secrets remain server-side, and user inputs are safely passed to workflows and recorded in a **private Gist** for auditing.

podman build --arch amd64 -t ghes-auth-app:latest . 
podman save ghes-auth-app:latest -o ghes-auth-app.tar

podman run -d \
  --name ghes-auth-app \
  -p 3000:3000 \
  -e PORT=3000 \
  -e USE_HTTPS=true \
  -e HOST_IP=10.195.253.50 \
  \
  -e GH_BASE_URL="https://github.adib.co.ae/api/v3" \
  -e GH_PAGES_URL="https://github.adib.co.ae/pages/DevOps/auth-test" \
  \
  -e GH_CLIENT_ID="Iv1.xxxxx" \
  -e GH_CLIENT_SECRET="xxxxx_your_client_secret_xxxxx" \
  -e GH_APP_ID="12345" \
  -e GH_INSTALL_ID="6789" \
  \
  -e ORG_NAME="DevOps" \
  -e TEAM_SLUG="auth-approvers" \
  \
  -e JWT_SECRET="my_super_secret_key" \
  \
  -e SSL_CERT_PATH="/app/certs/cert.pem" \
  -e SSL_KEY_PATH="/app/certs/key.pem" \
  \
  -v $(pwd)/certs:/app/certs:ro \
  ghes-auth-app

JWT_SECRET
openssl rand -hex 64

mkdir certs
openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -days 365 \
  -subj "/CN=10.0.10.25" \
  -addext "subjectAltName=IP:10.0.10.25"

  
---

## Architecture Overview

```
User (GitHub Pages) 
        │ POST inputs with token
        ▼
Node.js Backend (server.js)
  - Authenticates via GitHub App
  - Validates Bearer token
  - Triggers workflow with payload
  - Saves payload as private Gist
        │
        ▼
GitHub Repo & Gist
  - Workflow runs securely
  - Payload logged for auditing
```

---

## Security Features

- ✅ Frontend never touches GitHub secrets  
- ✅ Backend authenticates with GitHub App (short-lived token)  
- ✅ Bearer token / JWT ensures only authorized users can trigger workflows  
- ✅ Payload saved to **private Gist** for audit  
- ✅ Fine-grained GitHub App permissions: Actions & Workflows only  

---

## Project Structure

```
github-trigger-backend/
├── Dockerfile
├── package.json
├── server.js
├── .dockerignore
├── .env (local testing)
├── private-key.pem (not committed)
└── pages/index.html
```

---

## Setup Guide

### 1️⃣ Create a GitHub App

1. Go to **Settings → Developer settings → GitHub Apps → New GitHub App**
2. Fill out:
   - Name: `secure-actions-trigger`
   - Homepage URL: `https://your-org.github.io/your-repo/`
   - Permissions:
     - Actions: Read & write
     - Workflows: Read & write
     - Contents: Read-only
3. Generate a **private key** (`.pem`)
4. Note **App ID** and **Installation ID** after installing the app in your repo

---

### 2️⃣ Backend Environment

Create `.env`:

```
GH_APP_ID=123456
GH_INSTALLATION_ID=987654
OWNER=your-org
REPO=your-repo
PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
AUTH_TOKEN="super-secret-token"
PORT=3000
```

- `AUTH_TOKEN` is the Bearer token your frontend will use  
- Never commit `.env` or `.pem`

---

### 3️⃣ Run Backend

#### Local Development

```bash
npm install
npm start
```

#### Docker Deployment

```bash
docker build -t gh-trigger-backend .
docker run -p 3000:3000 \
  -e GH_APP_ID=123456 \
  -e GH_INSTALLATION_ID=987654 \
  -e OWNER=your-org \
  -e REPO=your-repo \
  -e PRIVATE_KEY="$(cat private-key.pem)" \
  -e AUTH_TOKEN="super-secret-token" \
  gh-trigger-backend
```

---

### 4️⃣ GitHub Pages Frontend

`pages/index.html`:

```html
<form id="deployForm">
  <label>Environment:</label>
  <input name="environment" value="staging"><br>
  <label>Version:</label>
  <input name="version" placeholder="1.0.0"><br>
  <button type="submit">Trigger Workflow</button>
</form>

<pre id="result"></pre>

<script>
const AUTH_TOKEN = "super-secret-token"; // shared with backend

document.getElementById("deployForm").addEventListener("submit", async e => {
  e.preventDefault();
  const inputs = Object.fromEntries(new FormData(e.target));

  const resp = await fetch("https://your-backend-domain/trigger", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AUTH_TOKEN}`
    },
    body: JSON.stringify({ workflow: "deploy.yml", inputs })
  });

  document.getElementById("result").textContent = JSON.stringify(await resp.json(), null, 2);
});
</script>
```

---

### 5️⃣ Workflow Example (`.github/workflows/deploy.yml`)

```yaml
name: Deploy Workflow

on:
  workflow_dispatch:
    inputs:
      environment:
        description: "Target environment"
        required: true
      version:
        description: "Version number"
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploying ${{ github.event.inputs.environment }} version ${{ github.event.inputs.version }}"
```

---

### 6️⃣ Flow Summary

| Step | Action | Output |
|------|--------|--------|
| 1️⃣ | User fills GitHub Pages form | POST `/trigger` with Bearer token |
| 2️⃣ | Backend validates token | Only authorized requests proceed |
| 3️⃣ | Backend triggers workflow | Workflow runs with user inputs |
| 4️⃣ | Backend creates private Gist | Payload saved for auditing |
| 5️⃣ | Frontend shows response | Success message + Gist URL |

---

### 7️⃣ Security Notes

- Secrets remain **server-side only**  
- Bearer token ensures only authorized users trigger workflows  
- GitHub App token short-lived (~60s)  
- Gist is private and safe for audit purposes  
- Use HTTPS for all connections  

---

### 8️⃣ Deployment Recommendations

- Backend: Cloud Run, Render, Railway, or EC2  
- Frontend: GitHub Pages (`gh-pages`)  
- Secrets: `.env` for local, GitHub Actions secrets for production  
- Private key: base64 encoded secret or env variable  

---

## License

MIT License © 2025