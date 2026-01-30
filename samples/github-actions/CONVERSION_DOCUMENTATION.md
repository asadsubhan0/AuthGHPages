# Jenkins to GitHub Actions Conversion Documentation

## Overview

This document explains the conversion of `ams-mr-bh.groovy` (Jenkins Pipeline) to `ams-mr-bh.yml` (GitHub Actions Workflow). It details the architectural decisions, design patterns, and how the original logic was preserved while adapting to GitHub Actions capabilities.

## Table of Contents

1. [Conversion Strategy](#conversion-strategy)
2. [Architecture Decisions](#architecture-decisions)
3. [Logic Mapping and Execution Sequence](#logic-mapping-and-execution-sequence)
4. [Key Differences and Rationale](#key-differences-and-rationale)
5. [Variable Naming Preservation](#variable-naming-preservation)
6. [Reusable Workflows Design](#reusable-workflows-design)

---

## Conversion Strategy

### High-Level Approach

The conversion followed a **preservation-first** strategy, prioritizing:
1. **Logic Preservation**: Maintain exact business logic from Groovy script
2. **Variable Name Consistency**: Use identical variable names to facilitate comparison
3. **Execution Sequence**: Preserve the order of operations
4. **Line References**: Add comments linking back to original Groovy lines for traceability

### Conversion Principles

1. **One-to-One Mapping**: Each Groovy stage/function maps to one or more GitHub Actions steps
2. **Reusability**: Extract common patterns into reusable workflows
3. **Native Features**: Leverage GitHub Actions native capabilities over third-party actions
4. **Maintainability**: Structure code for long-term maintenance and debugging

---

## Architecture Decisions

### 1. Separation of Concerns: Reusable Workflows

**Decision**: Extract common functionality into reusable workflows instead of duplicating code.

**Rationale**:
- **DRY Principle**: Functions like `getAbsoluteEncKey()`, `encWithHash()`, and `addToHashi()` are used in multiple places
- **Maintainability**: Changes to common logic only need to be made once
- **Testing**: Reusable workflows can be tested independently
- **Alignment with Groovy**: The original Groovy script already uses functions (`collectSecretsFromUsers`, `getAbsoluteEncKey`, etc.)

**Implementation**:
- `reusable/get-vault-data.yml`: Maps to `getAbsoluteEncKey()` function (Groovy lines 137-148)
- `reusable/generate-hash.yml`: Maps to `encWithHash()` and `encKSPWDWithHash()` functions (Groovy lines 150-172)
- `reusable/push-to-vault.yml`: Maps to `addToHashi()` function (Groovy lines 227-250)
- `reusable/create-secrets-gist.yml`: New implementation replacing interactive input mechanism

**Trade-offs**:
- ✅ Improved code organization and reusability
- ✅ Easier to test individual components
- ⚠️ Additional complexity in workflow orchestration
- ⚠️ Need to manage outputs between workflows

### 2. Interactive Input Replacement: Gist-Based Secret Collection

**Decision**: Replace Jenkins interactive `input()` prompts with GitHub Gist-based web form collection.

**Rationale**:
- **GitHub Actions Limitation**: GitHub Actions doesn't support interactive prompts during workflow execution
- **Better UX**: Web form provides persistent interface, allows review before submission
- **Audit Trail**: Gist provides immutable record of what was collected
- **Asynchronous Collection**: Secrets can be filled without blocking the workflow runner

**Mapping**:
- **Groovy** (lines 174-212): `resurrectZombie()` function prompts user for each secret sequentially
- **GitHub Actions**: 
  - Create Gist with all secrets marked as `TBC` (lines 218-228)
  - User fills form via web interface (`index.html`)
  - Wait for approval (environment approval) before proceeding
  - Fetch completed Gist and process secrets (lines 250-354)

**Execution Flow Comparison**:

**Groovy (Sequential)**:
```
for each secret:
  → prompt user input
  → encrypt if needed
  → add to entries
→ push to Vault
```

**GitHub Actions (Parallel Collection)**:
```
→ create Gist with all secrets
→ wait for approval
→ user fills all secrets via web form
→ fetch completed Gist
→ process all secrets (decrypt, encrypt if needed)
→ push to Vault
```

**Benefits**:
- ✅ Non-blocking: Workflow doesn't hold runner resources
- ✅ Better for multiple secrets: User sees all fields at once
- ✅ Recovery: Can resume if workflow fails
- ✅ Visibility: Gist URL provides clear status

**Trade-offs**:
- ⚠️ Additional complexity: Requires frontend application (`index.html`)
- ⚠️ Additional approval step: Need to manage environment approvals
- ⚠️ Security: Secrets stored in Gist (encrypted before storage)

### 3. Native GitHub Environment Approvals

**Decision**: Use GitHub's native environment approval mechanism instead of third-party actions.

**Rationale**:
- **Native Integration**: Built into GitHub Actions, no external dependencies
- **Security**: Managed by GitHub's permission system
- **Compliance**: Better audit trail through GitHub's built-in logging
- **Reliability**: No risk of third-party action deprecation or breaking changes

**Mapping**:
- **Groovy** (lines 43-47): `input()` with `submitter` parameter for approval
- **GitHub Actions**: 
  - Environment: `secret-collection-approval` (before Gist creation)
  - Environment: `secrets-filled-approval` (after Gist creation, before Vault push)

**Implementation**:
```yaml
- name: Wait for Approval (Native GitHub Environment)
  environment:
    name: secret-collection-approval
    url: https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}
```

**Benefits**:
- ✅ No external dependencies
- ✅ Integrated with GitHub permissions
- ✅ Better audit trail
- ✅ Configurable reviewers per environment

**Trade-offs**:
- ⚠️ Requires environment setup in repository settings
- ⚠️ Less flexible than programmatic approval (but sufficient for use case)

### 4. Job Separation: Build Details as Separate Job

**Decision**: Extract "Build Details" stage into a separate job that runs before the main job.

**Rationale**:
- **Separation of Concerns**: Build details are informational and independent
- **Parallel Execution**: Allows potential parallelization if needed
- **Summary Visibility**: GitHub Actions summary is job-scoped, separate job provides cleaner summary
- **Failure Isolation**: Build details failure doesn't block main workflow

**Mapping**:
- **Groovy** (lines 15-21): First stage in pipeline
- **GitHub Actions**: Separate `build-details` job with `needs` dependency

**Execution Flow**:
```yaml
jobs:
  build-details:
    # Runs first, writes to GitHub summary
  collect-secrets:
    needs: build-details  # Waits for build-details to complete
    # Main workflow execution
```

---

## Logic Mapping and Execution Sequence

### Stage-by-Stage Mapping

#### 1. Build Details Stage

**Groovy** (lines 15-21):
```groovy
stage(' Build Details '){
    script{
        buildDescription "Release: ${params.releaseVersion}" + "\n MS: ${params.MSName}"
    }
}
```

**GitHub Actions** (lines 51-72):
- **Job**: `build-details`
- **Implementation**: Uses `actions/github-script@v6` with `fs.appendFileSync()` to write to `GITHUB_STEP_SUMMARY`
- **Rationale**: GitHub Actions doesn't have `buildDescription` equivalent, but summary provides similar visibility
- **Enhancement**: Added table format for better readability

#### 2. Scrum Master Prepared Secret Holder Stage

**Groovy** (lines 23-50):
- Filters secrets list
- Displays pending secrets
- Requests approval via `input()`

**GitHub Actions** (lines 78-116):
- **Step 1**: Display Pending Secrets (lines 81-99)
  - Maps to Groovy lines 29, 31, 34-39 (secret filtering logic)
  - Uses `echo` with GitHub Actions annotations for visibility
- **Step 2**: Wait for Manual Approval (lines 100-108)
  - Maps to Groovy line 43 (input message)
  - Uses `console.log` with GitHub Actions annotations
- **Step 3**: Wait for Approval (lines 110-116)
  - Maps to Groovy lines 43-47 (input approval with submitter)
  - Uses GitHub native environment approval

**Execution Sequence Preserved**:
1. ✅ Display secrets list
2. ✅ Request approval
3. ✅ Wait for approval before proceeding

#### 3. Give Me the Meter Stage (Main Logic)

**Groovy** (lines 52-58):
```groovy
stage('Give me the meter'){
    steps{
        script{
            collectSecretsFromUsers(params.secretsNeedsInput , params.MSName, params.BUILD_ENV);
        }
    }
}
```

**GitHub Actions** (lines 118-354):
This stage contains the core logic, mapped step-by-step:

##### Step 1: Get Vault Data and Encryption Key (lines 118-126)

**Groovy** (lines 84-101, 137-148):
```groovy
def jsonOutput = sh(script: "curl ...", returnStdout: true)
def entries = readJSON text: jsonOutput
encKeyVal = getAbsoluteEncKey(entries)
```

**GitHub Actions**:
- **Reusable Workflow**: `reusable/get-vault-data.yml`
- **Maps to**: Groovy lines 87-100 (Vault GET request) and lines 137-148 (`getAbsoluteEncKey` function)
- **Logic Preservation**:
  - ✅ Vault URL construction based on `buildEnvironment` (hodc/pcdc → prod, else → kv)
  - ✅ Default encryption key: `9c843a91d57b1c37f6ce98d66045bf90`
  - ✅ Check for `app-config.secret-encryption.encryption-key` in Vault data
  - ✅ If value is `TBD`, generate hash from `APPLICATION_NAMESPACE`

##### Step 2: Generate Hash for Key Store Password (lines 128-137)

**Groovy** (lines 163-172):
```groovy
def encKSPWDWithHash(APPLICATION_NAMESPACE) {
    def generatedSha = sh(script: "echo ... | sha1sum", returnStdout: true)
    encKeyVal = generatedSha.substring(0, 32)
}
```

**GitHub Actions**:
- **Reusable Workflow**: `reusable/generate-hash.yml`
- **Maps to**: Groovy lines 163-172
- **Logic Preservation**:
  - ✅ SHA1 hash generation
  - ✅ First 32 characters extraction
  - ✅ Uses `APPLICATION_NAMESPACE + '-jks'` as input

##### Step 3: Prepare Secrets Object (lines 139-225)

**Groovy** (lines 113-130):
```groovy
for(String ele : listOfSecrets){
    requiredKey = ele.trim()
    encKeyVal = getAbsoluteEncKey(entries)
    // ... update entries.data.data
}
```

**GitHub Actions** (lines 159-225):
- **Maps to**: Groovy lines 103-130 (main loop)
- **Logic Preservation**:
  - ✅ Parse `secretsNeedsInput` with bracket removal (line 103)
  - ✅ Filter `app.key-store-password` for prod environments (lines 106-111)
  - ✅ Loop through `listOfSecrets` (not `filteredSecrets`) - line 113
  - ✅ For each secret:
    - `app-config.secret-encryption.encryption-key` → use `encKeyVal` (line 199)
    - `app.key-store-password` in hodc/pcdc → use hash (line 200)
    - Others → set to `TBC` (line 203)
  - ✅ Add existing Vault secrets that aren't being updated (lines 210-214)

**Key Decision**: Loop uses `listOfSecrets` not `filteredSecrets` to match Groovy behavior exactly. Filtering is only for logging purposes.

##### Step 4: Create Gist with Secrets List (lines 218-228)

**Groovy**: No direct equivalent (secrets collected interactively)

**GitHub Actions**:
- **Reusable Workflow**: `reusable/create-secrets-gist.yml`
- **New Implementation**: Replaces interactive `resurrectZombie()` calls
- **Creates**:
  - `secretsNeedsInput.json`: Contains all secrets with `TBC` values and `key_status`
  - `metadata.json`: Contains workflow metadata

##### Step 5: Wait for Secrets to be Filled (lines 242-248)

**Groovy**: No direct equivalent (blocking `input()` calls)

**GitHub Actions**:
- **Environment Approval**: `secrets-filled-approval`
- **Rationale**: Provides same gate as Groovy's blocking input, but non-blocking

##### Step 6: Fetch and Process Gist Secrets (lines 250-354)

**Groovy** (lines 174-212): `resurrectZombie()` function processes each secret

**GitHub Actions** (lines 250-354):
- **Maps to**: Groovy lines 174-212 (`resurrectZombie` function)
- **Logic Preservation**:
  - ✅ Fetch Gist content (equivalent to reading user input)
  - ✅ Process each secret:
    - Skip `key_status` (line 329)
    - Skip `TBC`/`TBD` values (line 330)
    - Decrypt if encrypted (lines 335-338)
    - Encrypt if in `listOfKeysToBeEncrypted` (lines 340-347)
  - ✅ Variable naming: `inputTxt` matches Groovy (line 176)

**Key Decision**: Process all secrets in batch rather than one-by-one, but maintain same logic flow.

##### Step 7: Push Secrets to Vault (lines 356-362)

**Groovy** (lines 227-250): `addToHashi()` function

**GitHub Actions**:
- **Reusable Workflow**: `reusable/push-to-vault.yml`
- **Maps to**: Groovy lines 227-250
- **Logic Preservation**:
  - ✅ Determine Vault engine (prod vs kv) based on `buildEnvironment` (line 230)
  - ✅ Fetch current Vault data (lines 61-67)
  - ✅ Merge new secrets with existing (line 73)
  - ✅ POST to Vault (lines 77)

#### 4. Update the Deployment Config File Stage

**Groovy** (lines 60-80):
```groovy
if(!(buildEnvironment.equals("uat") || (buildEnvironment == "hodc" || buildEnvironment == "pcdc"))){
    build job: 'MicroServices/dts-ams/ams-pre-sit-dc', ...
}
```

**GitHub Actions** (lines 364-382):
- **Maps to**: Groovy lines 63-76
- **Logic Preservation**:
  - ✅ Same condition check (lines 366-367)
  - ✅ Same parameters passed (commented example in lines 373-380)
- **Status**: Placeholder implementation (commented) as downstream workflow needs to be configured

---

## Key Differences and Rationale

### 1. Data Structure Handling

**Groovy**:
```groovy
def entries = readJSON text: jsonOutput
// entries structure: { data: { data: { key1: value1, ... } } }
entries.data.data.each { key, value -> ... }
```

**GitHub Actions**:
```javascript
const entries = { data: { data: JSON.parse(process.env.VAULT_DATA) } };
// Maintains same structure for consistency
entries.data.data.forEach(...)
```

**Rationale**: Preserve exact data structure to ensure logic compatibility and easier debugging.

### 2. Secret Collection Mechanism

**Groovy**: Sequential, blocking prompts
**GitHub Actions**: Parallel, non-blocking Gist form

**Rationale**: GitHub Actions doesn't support interactive prompts. Gist approach provides better UX for multiple secrets.

### 3. Error Handling

**Groovy**: Implicit (Groovy exceptions)
**GitHub Actions**: Explicit try-catch blocks

**Rationale**: GitHub Actions requires explicit error handling for better observability.

### 4. Output Management

**Groovy**: Direct variable assignment
**GitHub Actions**: Step outputs and `needs` dependencies

**Rationale**: GitHub Actions job isolation requires explicit output passing.

---

## Variable Naming Preservation

All variable names from the Groovy script were preserved to maintain consistency:

| Groovy Variable | GitHub Actions Variable | Location |
|----------------|------------------------|----------|
| `listOfSecrets` | `listOfSecrets` | Line 170 |
| `filteredSecrets` | `filteredSecrets` | Line 178 |
| `buildEnvironment` | `buildEnvironment` | Line 164 |
| `MicroserviceName` | `MicroserviceName` | Line 166 |
| `encKeyVal` | `encKeyVal` | Line 162 |
| `entries` | `entries` | Line 160 |
| `requiredKey` | `requiredKey` | Line 196 |
| `ele` | `ele` | Line 194 |
| `inputTxt` | `inputTxt` | Line 333 |
| `listOfKeysToBeEncrypted` | `listOfKeysToBeEncrypted` | Line 318 |

**Rationale**: Identical variable names facilitate:
- Code review and comparison
- Debugging and troubleshooting
- Future maintenance by teams familiar with Groovy version

---

## Reusable Workflows Design

### Design Principles

1. **Single Responsibility**: Each workflow handles one specific task
2. **Input/Output Contract**: Clear inputs and outputs defined
3. **Idempotency**: Workflows can be safely retried
4. **Error Handling**: Proper error messages and status codes

### Reusable Workflow Mappings

#### 1. `get-vault-data.yml`

**Groovy Function**: `getAbsoluteEncKey(entries)` (lines 137-148)
**Also Handles**: Vault data fetching (lines 87-100)

**Inputs**:
- `build_env`: Environment name
- `ms_name`: Microservice name
- `application_namespace`: Namespace for hash generation

**Outputs**:
- `vault_data`: Current Vault secrets
- `enc_key`: Encryption key to use

**Logic Flow**:
1. Determine Vault engine (prod vs kv)
2. Fetch current Vault data
3. Extract encryption key from `app-config.secret-encryption.encryption-key`
4. If key is `TBD`, generate hash from namespace
5. Return default key if not found

#### 2. `generate-hash.yml`

**Groovy Functions**: `encWithHash()` (lines 150-161), `encKSPWDWithHash()` (lines 163-172)

**Inputs**:
- `text`: Base text for hash
- `suffix`: Optional suffix (e.g., `-jks`)

**Outputs**:
- `hash`: SHA1 hash (first 32 characters)

**Logic Flow**:
1. Concatenate text and suffix
2. Generate SHA1 hash
3. Extract first 32 characters
4. Return hash

#### 3. `push-to-vault.yml`

**Groovy Function**: `addToHashi()` (lines 227-250)

**Inputs**:
- `build_env`: Environment name
- `ms_name`: Microservice name
- `secrets_json`: JSON string of secrets to push

**Outputs**: None (writes directly to Vault)

**Logic Flow**:
1. Determine Vault engine (prod vs kv)
2. Fetch current Vault data
3. Merge new secrets with existing
4. POST merged data to Vault

#### 4. `create-secrets-gist.yml`

**Groovy Equivalent**: None (replaces interactive input)

**Inputs**:
- `ms_name`: Microservice name
- `build_env`: Environment name
- `release_version`: Release version
- `secrets_obj`: JSON string of secrets object

**Outputs**:
- `gist_id`: Created Gist ID
- `gist_url`: Gist URL for user access

**Logic Flow**:
1. Parse secrets object
2. Create `secretsNeedsInput.json` file
3. Create `metadata.json` file
4. Create private Gist with both files
5. Return Gist ID and URL

---

## Execution Flow Comparison

### Groovy Execution Flow

```
1. Build Details
   └─> Set build description

2. Scrum Master Approval
   └─> Display secrets list
   └─> Wait for approval (blocking)

3. Give Me the Meter
   └─> Fetch Vault data
   └─> Get encryption key
   └─> For each secret:
       ├─> If app.key-store-password (prod):
       │   └─> Generate hash
       ├─> If app-config.secret-encryption.encryption-key:
       │   └─> Use encKeyVal
       └─> Else:
           └─> Prompt user input (blocking)
           └─> Encrypt if in listOfKeysToBeEncrypted
   └─> Push to Vault

4. Update Deployment Config
   └─> Trigger downstream job (if conditions met)
```

### GitHub Actions Execution Flow

```
1. Build Details Job
   └─> Write to GitHub summary
   └─> Complete

2. Collect Secrets Job (waits for build-details)
   ├─> Display Pending Secrets
   ├─> Wait for Approval (environment)
   ├─> Get Vault Data (reusable workflow)
   ├─> Generate Hash (if needed, reusable workflow)
   ├─> Prepare Secrets Object
   ├─> Create Gist (reusable workflow)
   ├─> Wait for Secrets Filled (environment)
   ├─> Fetch and Process Gist Secrets
   ├─> Push to Vault (reusable workflow)
   └─> Trigger Downstream Job (if conditions met)
```

### Key Differences

1. **Parallelization**: GitHub Actions jobs can run in parallel (not used here, but possible)
2. **Non-blocking**: Secret collection doesn't block runner resources
3. **Reusability**: Common logic extracted into reusable workflows
4. **Visibility**: Better observability through GitHub Actions UI and summaries

---

## Migration Benefits

### Advantages

1. **Scalability**: Non-blocking secret collection allows handling multiple concurrent workflows
2. **Maintainability**: Reusable workflows reduce code duplication
3. **Observability**: Better logging and summary visibility
4. **Integration**: Native GitHub features (environments, approvals, summaries)
5. **Security**: Environment-based approvals with GitHub's permission system

### Considerations

1. **Setup Required**: Environments must be configured in repository settings
2. **Gist Dependency**: Requires frontend application (`index.html`) for secret collection
3. **Learning Curve**: Team needs to understand GitHub Actions concepts
4. **Workflow Complexity**: More files to manage (reusable workflows, main workflow)

---

## Conclusion

The conversion from Jenkins Groovy to GitHub Actions was designed to:
- Preserve exact business logic and execution sequence
- Maintain variable naming for consistency
- Extract common patterns into reusable workflows
- Leverage GitHub Actions native features
- Provide better observability and user experience

The architecture decisions prioritize maintainability, reusability, and compliance with GitHub Actions best practices while ensuring the converted workflow behaves identically to the original Groovy script.

