# Zero-IO Cloud Workspace & Dual-Agent (`Main + Coder`) Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate local `read_file` / shell-probing turn waste and 30-turn exhaustion in `CPH-PI` by fixing 4 physical SharePoint Cloud Workspace fractures (`cwc_flux_v3` + `isStartOfSession`, `Library/` sync & real `UniqueId` extraction, URL-encoded `[SHAREPOINT REMOTE WORKSPACE]` full-chain prompt injection, and `T+0.00s` synchronous single-file hot-overwrite barrier) and completely rewriting the 2 core system prompts (`cph-main-agent-prompt.txt`, `cph-coder-agent-prompt.txt`) and 2 core skills (`skills/subagent/SKILL.md`, `skills/handoff/SKILL.md`) into a unified Zero-IO Cloud-First Dual-Agent (`Main + Coder`, retiring `Researcher`) paradigm.

**Architecture:**
1. **Transport & Sync Layer**: `ChatHubClient` includes `"cwc_flux_v3"` in `optionsSets` and sets `isStartOfSession: true` on Turn 1 (`turn === 1`). `sp-sync-engine.ps1` syncs `Library/` alongside tracked files and extracts real SharePoint `UniqueId`, `ServerRelativeUrl`, and `firstCreatedAt`. `PnPWorkspaceSyncEngine.generateVirtualRepoMap()` URL-encodes every path segment (`encodeURIComponent`), tags files with `[CLOUD-READY]` or `[LOCAL-NEW: use read_file]`, and injects `.cph/state/virtual-repo-map.md` across `PromptBuilder` (`buildDirectAgentPrompt`, `buildTurn1Prompt`, `buildTurn2TaskPrompt`, `buildTurn2TaskPromptWithAttachment`, `buildHandoffContinuationPrompt`) and `formatSuccessorTurn1Prompt`.
2. **`T+0.00s` Hot-Overwrite Barrier**: In `CopilotOrchestrator`, whenever `patch_file`, `edit`, or `write_file` succeeds on disk, the orchestrator awaits `PnPWorkspaceSyncEngine.syncFile(targetRelPath)` and regenerates `.cph/state/virtual-repo-map.md` before sending the tool result to the next turn, guaranteeing `T+0.00s` cloud visibility.
3. **Dual-Agent Cognitive Layer (`Main + Coder`)**: `Researcher` (`cph-researcher-agent-prompt.txt`) is retired. `Main Agent` reads any number of `[CLOUD-READY]` files directly from SharePoint Cloud in 1–3 turns (zero local I/O round-trips), completes analysis/review/debugging/single-module edits directly to `FINAL_ANSWER`, and dispatches `Coder` subagents (`role: "coder"`) via `invoke_subagent` only for multi-module parallel code modifications.

**Tech Stack:** TypeScript (Bun runtime & `bun test`), PowerShell 7 (`PnP.PowerShell`), M365 Copilot ChatHub SignalR/WebSocket protocol, SharePoint Online (`SaveBinaryDirect`).

---

## Impact Scan Summary (`冲击面扫描`)

| Dimension | Target File | Changes Required |
|---|---|---|
| **Transport** | `src/transport/chathub-client.ts` | Add `isStartOfSession?: boolean` to `SendMessageOptions`; include `"cwc_flux_v3"` in `optionsSets`; pass `isStartOfSession: options.isStartOfSession ?? false` in payload. |
| **Orchestrator** | `src/agent/orchestrator.ts` | Pass `isStartOfSession: turn === 1` in `client.sendMessage()`; await `PnPWorkspaceSyncEngine.syncFile()` + `generateVirtualRepoMap()` on `edit` / `patch_file` / `write_file` success; remove broken detached `spawn("sp-sync-engine.ps1")` block. |
| **PnP Sync Engine** | `src/workspace/pnp-sync-engine.ts` | Add `firstCreatedAt?: number` to `SyncManifestEntry`; URL-encode path segments in `generateVirtualRepoMap()`; emit `[CLOUD-READY]` / `[LOCAL-NEW: use read_file]` tags and `DocId`; expose static helper `loadVirtualRepoMapSection(workspaceRoot)`. |
| **PowerShell Sync** | `scripts/sp-sync-engine.ps1` | Remove `Library` from exclusion regexes; explicitly scan `Library/` when git-ignored; extract real `$fileObj.UniqueId` & `$fileObj.ServerRelativeUrl` after `Add-PnPFile`; preserve `firstCreatedAt`. |
| **Prompt Builder** | `src/protocol/prompt-builder.ts` | Automatically read `.cph/state/virtual-repo-map.md` when `virtualRepoMap` parameter is omitted across `buildDirectAgentPrompt`, `buildTurn1Prompt`, `buildTurn2TaskPrompt`, `buildTurn2TaskPromptWithAttachment`, and `buildHandoffContinuationPrompt`. |
| **Successor Prompt** | `src/session/main-plan-snapshot.ts` | Inject `.cph/state/virtual-repo-map.md` into `formatSuccessorTurn1Prompt()`. |
| **Subagent Runner** | `src/agent/subagent-runner.ts` | Default `role` to `"coder"` when unspecified; remove `isScout` prompt injection block while preserving exported `isInlineScoutTask` and `DEFAULT_RESEARCHER_AGENT_ID` symbols for backward compatibility with unit tests. |
| **System Prompts** | `cph-main-agent-prompt.txt`, `cph-coder-agent-prompt.txt` | Complete rewrite for Zero-IO Cloud-First Dual-Agent workflow; delete `cph-researcher-agent-prompt.txt`. |
| **Skills & Bundler** | `skills/subagent/SKILL.md`, `skills/handoff/SKILL.md`, `scripts/package-agent-bundle.ts` | Complete rewrite of both skills; update bundler to package 2 agents (`Main` + `Coder`). |
| **Test Suite** | `tests/transport/chathub-client.test.ts`, `tests/scripts/sp-sync-engine.test.ts`, `tests/workspace/pnp-sync-engine.test.ts`, `tests/protocol/prompt-builder.test.ts`, `tests/skills/tri-agent-governance.test.ts`, `tests/skills/tri-agent-prompts.test.ts`, `tests/cli/package-agent-bundle.test.ts` | Update and expand tests to lock down all 4 physical fixes and Dual-Agent prompt/skill governance rules. |

---

### Task 1: Fix `ChatHubClient` `"cwc_flux_v3"` OptionSet & `isStartOfSession` Propagation

**Files:**
- Modify: `e:\copilot-web proxy\CPH-PI\src\transport\chathub-client.ts`
- Modify: `e:\copilot-web proxy\CPH-PI\src\agent\orchestrator.ts`
- Test: `e:\copilot-web proxy\CPH-PI\tests\transport\chathub-client.test.ts`

- [ ] **Step 1: Write the failing tests in `tests/transport/chathub-client.test.ts`**

Add a new `describe("SharePoint Enterprise Search optionsSets & isStartOfSession")` block at the end of `e:\copilot-web proxy\CPH-PI\tests\transport\chathub-client.test.ts`:

```ts
  describe("SharePoint Enterprise Search optionsSets & isStartOfSession", () => {
    it("includes 'cwc_flux_v3' in optionsSets and defaults isStartOfSession to false", () => {
      const client = new ChatHubClient(mockToken);
      const payload = (client as any).buildInvocationPayload({
        text: "Read AGENTS.md from SharePoint",
        conversationId: "conv-sp-1",
        sessionId: "sess-sp-1",
        requestId: "req-sp-1",
      });
      const arg = payload.arguments[0];
      expect(arg.optionsSets).toContain("cwc_flux_v3");
      expect(arg.optionsSets).toContain("enterprise_flux_web");
      expect(arg.optionsSets).toContain("enterprise_toolbox_with_skds");
      expect(arg.isStartOfSession).toBe(false);
    });

    it("sets isStartOfSession to true when options.isStartOfSession is true", () => {
      const client = new ChatHubClient(mockToken);
      const payload = (client as any).buildInvocationPayload({
        text: "Turn 1 Cloud Workspace Query",
        conversationId: "conv-sp-1",
        sessionId: "sess-sp-1",
        requestId: "req-sp-1",
        isStartOfSession: true,
      });
      const arg = payload.arguments[0];
      expect(arg.isStartOfSession).toBe(true);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
Set-Location "e:\copilot-web proxy\CPH-PI"; bun test tests/transport/chathub-client.test.ts
```
Expected: FAIL (`expect(arg.optionsSets).toContain("cwc_flux_v3")` fails).

- [ ] **Step 3: Implement `"cwc_flux_v3"` and `isStartOfSession` in `src/transport/chathub-client.ts` and `src/agent/orchestrator.ts`**

In `e:\copilot-web proxy\CPH-PI\src\transport\chathub-client.ts`:
1. Add `isStartOfSession?: boolean;` to `SendMessageOptions`:
```ts
export interface SendMessageOptions {
  text: string;
  conversationId: string;
  sessionId?: string;
  requestId?: string;
  isStartOfSession?: boolean;
  signal?: AbortSignal;
  annotations?: AttachmentAnnotation[];
}
```
2. In `buildInvocationPayload(options: SendMessageOptions)`, update `optionsSets` and `isStartOfSession`:
```ts
    const optionsSets = [
      "enterprise_flux_web",
      "enterprise_flux_work",
      "enable_request_response_interception",
      "enterprise_toolbox_with_skds",
      "enterprise_ Sydney_search",
      "cwc_flux_v3",
    ];
```
and in `arguments[0]`:
```ts
          source: "cib",
          optionsSets,
          allowedMessageTypes,
          sliceIds: [],
          traceId: crypto.randomUUID().replace(/-/g, ""),
          isStartOfSession: options.isStartOfSession ?? false,
          requestId,
```

In `e:\copilot-web proxy\CPH-PI\src\agent\orchestrator.ts` (around line 661), pass `isStartOfSession: turn === 1`:
```ts
        const res = await client.sendMessage(
          {
            text: currentPrompt,
            conversationId,
            sessionId,
            requestId,
            isStartOfSession: turn === 1,
            signal,
            annotations: currentAnnotations.length > 0 ? currentAnnotations : undefined,
          },
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```powershell
Set-Location "e:\copilot-web proxy\CPH-PI"; bun test tests/transport/chathub-client.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
Set-Location "e:\copilot-web proxy\CPH-PI"; git add src/transport/chathub-client.ts src/agent/orchestrator.ts tests/transport/chathub-client.test.ts; git commit -m "fix(transport): enable cwc_flux_v3 optionSet and Turn-1 isStartOfSession for SharePoint search"
```

---

### Task 2: Fix `sp-sync-engine.ps1` `Library/` Inclusion & Real SharePoint `UniqueId`/`ServerRelativeUrl` Extraction

**Files:**
- Modify: `e:\copilot-web proxy\CPH-PI\scripts\sp-sync-engine.ps1`
- Modify: `e:\copilot-web proxy\CPH-PI\tests\scripts\sp-sync-engine.test.ts`

- [ ] **Step 1: Update and add tests in `tests/scripts/sp-sync-engine.test.ts`**

In `e:\copilot-web proxy\CPH-PI\tests\scripts\sp-sync-engine.test.ts`:
1. Update the existing `Get-LocalFolders` test around lines 329 and 350 to assert that `Library/` and `Library/docs` ARE included even when `.gitignore` ignores `Library/` (while `.git`, `.cph`, `node_modules`, `dist`, `package` remain excluded):
```ts
      expect(res.stdout).toContain("[LOCAL-FOLDER] src");
      expect(res.stdout).toContain("[LOCAL-FOLDER] src/agent");
      expect(res.stdout).toContain("[LOCAL-FOLDER] src/transport");
      expect(res.stdout).toContain("[LOCAL-FOLDER] empty-dir");
      expect(res.stdout).toContain("[LOCAL-FOLDER] parent-empty/child-empty");
      expect(res.stdout).toContain("[LOCAL-FOLDER] Library");
      expect(res.stdout).toContain("[LOCAL-FOLDER] Library/docs");
```
2. Add a test verifying `Get-LocalTrackedFiles` includes files inside `Library/` even when `Library/` is listed in `.gitignore`, and that `sp-sync-engine.ps1` records `firstCreatedAt` and real `UniqueId`:
```ts
    it("Get-LocalTrackedFiles includes files inside Library/ even when gitignored", () => {
      fs.writeFileSync(path.join(tmpDir, "Library", "docs", "ref.md"), "# Reference Doc", "utf8");
      const psScript = `
        $ErrorActionPreference = 'Stop'
        $content = Get-Content -LiteralPath '${SCRIPT_PATH.replace(/'/g, "''")}' -Raw
        $fnBlocks = [regex]::Matches($content, '(?ms)^function\\s+(Get-LocalTrackedFiles|Test-IsExcludedPath)\\b.*?^}')
        foreach ($m in $fnBlocks) { Invoke-Expression $m.Value }
        $files = Get-LocalTrackedFiles -Root '${tmpDir.replace(/'/g, "''")}'
        foreach ($f in $files) { Write-Output "[TRACKED-FILE] $f" }
      `;
      const res = spawnSync(pwshBin, ["-NoProfile", "-Command", psScript], { encoding: "utf8" });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("[TRACKED-FILE] Library/docs/ref.md");
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
Set-Location "e:\copilot-web proxy\CPH-PI"; bun test tests/scripts/sp-sync-engine.test.ts
```
Expected: FAIL (`expect(res.stdout).toContain("[LOCAL-FOLDER] Library")` fails because `Library` is currently excluded).

- [ ] **Step 3: Modify `scripts/sp-sync-engine.ps1`**

In `e:\copilot-web proxy\CPH-PI\scripts\sp-sync-engine.ps1`:
1. In `Get-LocalTrackedFiles` (around lines 250-303):
   - Remove `Library` from exclusion regex: change `^(\.git|\.cph|node_modules|dist|package|Library)(/|$)` to `^(\.git|\.cph|node_modules|dist|package)(/|$)`.
   - After `git ls-files` succeeds, also explicitly scan `Join-Path $Root "Library"` if it exists so git-ignored reference files inside `Library/` are always synced to SharePoint:
```powershell
            $filtered = @()
            foreach ($line in $gitOut) {
                if ([string]::IsNullOrWhiteSpace($line)) { continue }
                $norm = Normalize-RelPath -RelPath $line.Trim()
                if ($norm -match '^(\.git|\.cph|node_modules|dist|package)(/|$)') { continue }
                $full = Join-Path $Root $norm
                if (Test-Path -LiteralPath $full -PathType Leaf) {
                    $filtered += $norm
                }
            }
            $libDir = Join-Path $Root "Library"
            if (Test-Path -LiteralPath $libDir -PathType Container) {
                $libFiles = Get-ChildItem -LiteralPath $libDir -Recurse -File -Force -ErrorAction SilentlyContinue
                foreach ($lf in $libFiles) {
                    $rel = $lf.FullName.Substring($Root.Length).TrimStart('\', '/')
                    $norm = Normalize-RelPath -RelPath $rel
                    if ($filtered -notcontains $norm) {
                        $filtered += $norm
                    }
                }
            }
            return $filtered
```
   - Also update the fallback exclusion regex at line 292 from `^(\.git|\.cph|node_modules|dist|package|Library)(/|$)` to `^(\.git|\.cph|node_modules|dist|package)(/|$)`.
2. In `Get-LocalFolders` (around lines 370-415):
   - Remove `Library` from exclusion regex at line 398: change `^(\.git|\.cph|node_modules|dist|package|Library)(/|$)` to `^(\.git|\.cph|node_modules|dist|package)(/|$)`.
   - When `$gitCheck.ExitCode -eq 0`, also include all directories under `Join-Path $Root "Library"` even if `.gitignore` ignores `Library/`:
```powershell
        $folders = @()
        foreach ($dir in $allDirs) {
            $rel = $dir.FullName.Substring($Root.Length).TrimStart('\', '/')
            $norm = Normalize-RelPath -RelPath $rel
            if ([string]::IsNullOrWhiteSpace($norm)) { continue }
            if ($norm -match '(^|/)(\.git|\.cph|node_modules|dist|package)(/|$)') { continue }

            if ($isGitRepo -and ($norm -notmatch '^Library(/|$)')) {
                $ignoreCheck = Invoke-ProcessWithTimeout -FilePath "git" -ArgumentList @("-C", $Root, "check-ignore", "-q", $norm) -TimeoutMs 5000
                if ($ignoreCheck.ExitCode -eq 0) { continue }
            }
            $folders += $norm
        }
```
3. In `Upload-SingleFile` (around lines 330-360):
   - Capture the return object of `Add-PnPFile` and extract `UniqueId` and `ServerRelativeUrl` when available, preserving `firstCreatedAt` if already in `$Manifest["files"][$normRel]`:
```powershell
    $uploaded = Add-PnPFile -Path $fullPath -Folder $remoteFolderUrl -Values @{ Title = $fileName } -ErrorAction Stop
    $uniqueId = ""
    $serverRelUrl = "$remoteFolderUrl/$fileName"
    if ($null -ne $uploaded) {
        if ($uploaded.PSObject.Properties["UniqueId"] -and $uploaded.UniqueId) {
            $uniqueId = $uploaded.UniqueId.ToString()
        }
        if ($uploaded.PSObject.Properties["ServerRelativeUrl"] -and $uploaded.ServerRelativeUrl) {
            $serverRelUrl = $uploaded.ServerRelativeUrl.ToString()
        }
    }
    $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $firstCreated = $nowMs
    if ($Manifest.ContainsKey("files") -and $null -ne $Manifest["files"][$normRel]) {
        $prev = $Manifest["files"][$normRel]
        if ($prev -is [hashtable] -and $prev.ContainsKey("firstCreatedAt") -and $prev["firstCreatedAt"]) {
            $firstCreated = $prev["firstCreatedAt"]
        } elseif ($prev.PSObject.Properties["firstCreatedAt"] -and $prev.firstCreatedAt) {
            $firstCreated = $prev.firstCreatedAt
        }
    }
```
   - Store `firstCreatedAt = $firstCreated`, `lastSyncedAt = $nowMs`, `uniqueId = $uniqueId`, `serverRelativeUrl = $serverRelUrl` in the manifest entry.

- [ ] **Step 4: Run test to verify it passes**

Run:
```powershell
Set-Location "e:\copilot-web proxy\CPH-PI"; bun test tests/scripts/sp-sync-engine.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
Set-Location "e:\copilot-web proxy\CPH-PI"; git add scripts/sp-sync-engine.ps1 tests/scripts/sp-sync-engine.test.ts; git commit -m "fix(sp-sync): include Library/ directory in SharePoint sync and extract real UniqueId/firstCreatedAt"
```

---

### Task 3: Upgrade `PnPWorkspaceSyncEngine.generateVirtualRepoMap()` (URL Encoding + Readiness Tags) & Wire Full-Chain Prompt Injection + `T+0.00s` Hot-Overwrite Barrier

**Files:**
- Modify: `e:\copilot-web proxy\CPH-PI\src\workspace\pnp-sync-engine.ts`
- Modify: `e:\copilot-web proxy\CPH-PI\src\protocol\prompt-builder.ts`
- Modify: `e:\copilot-web proxy\CPH-PI\src\session\main-plan-snapshot.ts`
- Modify: `e:\copilot-web proxy\CPH-PI\src\agent\orchestrator.ts`
- Test: `e:\copilot-web proxy\CPH-PI\tests\workspace\pnp-sync-engine.test.ts`
- Test: `e:\copilot-web proxy\CPH-PI\tests\protocol\prompt-builder.test.ts`

- [ ] **Step 1: Write failing tests in `tests/workspace/pnp-sync-engine.test.ts` and `tests/protocol/prompt-builder.test.ts`**

In `e:\copilot-web proxy\CPH-PI\tests\workspace\pnp-sync-engine.test.ts`, add tests for:
1. URL-encoding path segments containing spaces (e.g., `Library/CNNJI QUERY/01 Team/query.sql` -> `.../Library/CNNJI%20QUERY/01%20Team/query.sql`).
2. Tagging files with `[CLOUD-READY]` when `firstCreatedAt` is older than 60s (or omitted on pre-existing cloud files) vs `[LOCAL-NEW: use read_file]` when `firstCreatedAt` is within the last 60s and `firstCreatedAt === lastSyncedAt`.
3. Rendering `DocId: <uniqueId>` when `uniqueId` is present.

In `e:\copilot-web proxy\CPH-PI\tests\protocol\prompt-builder.test.ts`, add tests verifying:
1. When `.cph/state/virtual-repo-map.md` exists in `workspaceRoot`, `PromptBuilder.buildDirectAgentPrompt(workspaceRoot, task, skills, dirTree, 2)` automatically injects the `[SHAREPOINT REMOTE WORKSPACE]` block even when the 6th argument `virtualRepoMap` is omitted.
2. `formatSuccessorTurn1Prompt(snapshot, reportsSummary)` in `src/session/main-plan-snapshot.ts` also injects `.cph/state/virtual-repo-map.md` when present on disk.

- [ ] **Step 2: Run tests to verify they fail**

Run:
```powershell
Set-Location "e:\copilot-web proxy\CPH-PI"; bun test tests/workspace/pnp-sync-engine.test.ts tests/protocol/prompt-builder.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement URL encoding, readiness tags, automatic map loading, and `T+0.00s` hot-overwrite sync hook**

1. In `e:\copilot-web proxy\CPH-PI\src\workspace\pnp-sync-engine.ts`:
   - Add `firstCreatedAt?: number;` to `SyncManifestEntry`.
   - Add helper `encodeUrlPathSegments(relPath: string): string`:
     ```ts
     function encodeUrlPathSegments(relPath: string): string {
       return relPath
         .replace(/\\/g, "/")
         .split("/")
         .filter((seg) => seg.length > 0)
         .map((seg) => encodeURIComponent(seg))
         .join("/");
     }
     ```
   - Update `generateVirtualRepoMap()` to:
     - Encode `targetFolder` and `relPath` segments via `encodeUrlPathSegments` so spaces become `%20` and Markdown links never break.
     - Determine readiness tag: if `entry.firstCreatedAt && entry.lastSyncedAt && entry.firstCreatedAt === entry.lastSyncedAt && Date.now() - entry.firstCreatedAt < 60_000`, use `[LOCAL-NEW: use read_file]`; otherwise use `[CLOUD-READY]`.
     - Include `(DocId: ${entry.uniqueId})` if `entry.uniqueId` is non-empty.
   - Add static helper `PnPWorkspaceSyncEngine.readVirtualRepoMap(workspaceRoot?: string): string | undefined` that reads `<workspaceRoot>/.cph/state/virtual-repo-map.md` if it exists and is non-empty.

2. In `e:\copilot-web proxy\CPH-PI\src\protocol\prompt-builder.ts`:
   - In `buildDirectAgentPrompt`, `buildTurn1Prompt`, `buildTurn2TaskPrompt`, `buildTurn2TaskPromptWithAttachment`, and `buildHandoffContinuationPrompt`, if `virtualRepoMap` is not explicitly passed and `workspaceRoot` is available, automatically load `.cph/state/virtual-repo-map.md` via `PnPWorkspaceSyncEngine.readVirtualRepoMap(workspaceRoot)` and inject it into the prompt.

3. In `e:\copilot-web proxy\CPH-PI\src\session\main-plan-snapshot.ts`:
   - In `formatSuccessorTurn1Prompt`, load `PnPWorkspaceSyncEngine.readVirtualRepoMap(snapshot.workspaceRoot)` and append it to the workspace facts section so Successor Main Sessions retain full cloud URL visibility.

4. In `e:\copilot-web proxy\CPH-PI\src\agent\orchestrator.ts`:
   - When `toolResult.success` and `parsed.action.tool` is `"edit"`, `"patch_file"`, or `"write_file"`, resolve the relative path of the modified file and if `.cph/state/sp-sync-manifest.json` exists (indicating an active SharePoint Cloud Workspace), await `pnpEngine.syncFile(relModPath)` + `pnpEngine.generateVirtualRepoMap()` synchronously (`T+0.00s` hot-overwrite barrier) before constructing the next turn prompt, and remove the broken detached `spawn("powershell.exe", ...)` block inside `if (isGreenTestResult)`.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```powershell
Set-Location "e:\copilot-web proxy\CPH-PI"; bun test tests/workspace/pnp-sync-engine.test.ts tests/protocol/prompt-builder.test.ts tests/session/main-plan-snapshot.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
Set-Location "e:\copilot-web proxy\CPH-PI"; git add src/workspace/pnp-sync-engine.ts src/protocol/prompt-builder.ts src/session/main-plan-snapshot.ts src/agent/orchestrator.ts tests/workspace/pnp-sync-engine.test.ts tests/protocol/prompt-builder.test.ts; git commit -m "feat(workspace): add URL-encoded virtual-repo-map full-chain injection and T+0.00s hot-overwrite sync"
```

---

### Task 4: Complete Rewrite of `cph-main-agent-prompt.txt` & `cph-coder-agent-prompt.txt` (Retiring `Researcher`)

**Files:**
- Modify: `e:\copilot-web proxy\CPH-PI\cph-main-agent-prompt.txt`
- Modify: `e:\copilot-web proxy\CPH-PI\cph-coder-agent-prompt.txt`
- Delete: `e:\copilot-web proxy\CPH-PI\cph-researcher-agent-prompt.txt`
- Modify: `e:\copilot-web proxy\CPH-PI\src\agent\subagent-runner.ts`

- [ ] **Step 1: Verify governance rules before writing prompts**

All prompt text must strictly satisfy `AGENTS.md`:
- **Rule 3 (Constructive Guidance Over Prohibitions)**: Zero occurrences of negative prohibition words (`严禁`, `切勿`, `不要`, `禁止`, `杜绝`, `不得`, `绝不允许`).
- **Rule 6 (Black-Box Abstraction)**: Zero occurrences of infrastructure terms (`WebSocket`, `SignalR`, `账号池`, `Chathub`, `.cph/state/`).
- **Cloud-First Dual-Agent Architecture**:
  - `cph-main-agent-prompt.txt`: Defines **CPH-Main (全栈云原生主控与首席架构师智能体)**. Uses `[SHAREPOINT REMOTE WORKSPACE]` URLs for direct zero-IO cloud reading across all `[CLOUD-READY]` files; directly completes code review, architectural audit, root-cause diagnosis, Q&A, and single-module edits within the main session and outputs `FINAL_ANSWER`; dispatches `Coder` subagents (`role: "coder"`) via `invoke_subagent` (`stage` DAG) when parallel multi-module code modifications and test runs are needed.
  - `cph-coder-agent-prompt.txt`: Defines **CPH-Coder (云原生专项代码实施与验证智能体)**. Reads assigned target files and upstream dependencies directly via `[SHAREPOINT REMOTE WORKSPACE]` URLs; uses `read_file` for `[LOCAL-NEW: use read_file]` files; applies minimal changes via `patch_file` (or native downloadable file card + `write_file` for new files); runs targeted unit tests via `run_command`; converges within 15 turns via `FINAL_ANSWER`.

- [ ] **Step 2: Write `cph-main-agent-prompt.txt`, write `cph-coder-agent-prompt.txt`, delete `cph-researcher-agent-prompt.txt`, and update `src/agent/subagent-runner.ts`**

1. Write `e:\copilot-web proxy\CPH-PI\cph-main-agent-prompt.txt`:
```markdown
# 角色与核心定位

你是 **CPH-Main（全栈云原生主控与首席架构师智能体）**，直接面向用户提供端到端的代码审查、架构分析、问题诊断、技术解答与工程实施统筹服务。
在你的会话上下文中，系统已挂载 **`[SHAREPOINT REMOTE WORKSPACE]`（云端镜像工作区全量文件 URL 映射表）**。你具备直接通过云端文档链接秒级调阅工作区内任意数量、任意体积源码与参考文档的原生能力，零本地 I/O 往返开销。

---

# 核心工作流准则（云端零 I/O 直读与双智能体协同）

1. **云端工作区零 I/O 全景直读（Cloud-First Direct Reading）**
   - 当上下文中包含 `[SHAREPOINT REMOTE WORKSPACE]` 映射表时，优先通过映射表中的 SharePoint 文件 URL 与 `DocId` 在云端直接检索和阅读目标源码、配置文件及 `Library/` 参考资料。
   - 面对多文件交叉比对、全仓代码质量审查、SQL/业务逻辑逐行核对或跨模块调用链追踪任务，直接在云端一次性调阅所有标记为 `[CLOUD-READY]` 的文件，在 1 至 3 轮内完成全量阅读与深度推演。
   - 对于映射表中标记为 `[LOCAL-NEW: use read_file]` 的新建本地文件，或仅存在于宿主机本地的动态运行时产物，按需调用 `read_file` 读取。

2. **主控自闭环结题与按需派发 `Coder`（Self-Contained Closure & On-Demand Coder Dispatch）**
   - **调查、分析、代码审查、架构规划、根因诊断、技术问答与单点敏捷修改**：由你直接基于云端工作区完成全量源码调阅、推演与验证，并在主会话内直接输出详尽、完整的 `FINAL_ANSWER` 交付报告。
   - **跨模块并行代码重构与多组件工程落地**：当你已完成云端全景分析并明确了各模块的修改契约后，通过 `invoke_subagent` 派发 `role: "coder"`（专项代码修改与测试验证子代理）并行实施代码变更与单元测试。
   - 在派发 `Coder` 子代理前，使用 `write_file` 或 `patch_file` 维护工作区根目录下的 `plan.md`，用 `- [ ]` 与 `- [x]` 记录各模块实施进度。

3. **精准补丁与原生文件生成（Minimal Patching & Native File Generation）**
   - 修改已存在的文件（含更新 `plan.md` 进度）时，统一使用 `patch_file` 提供包含 3 行上下文的唯一锚点进行局部替换。
   - 创建全新独立代码文件或长篇技术文档时，优先调用云端原生文件生成能力产出带有下载链接的文件卡片，或通过 `write_file` 落盘。
   - 每次本地 `patch_file` 或 `write_file` 执行成功后，系统会自动将最新文件内容实时热同步至 SharePoint 云端工作区，后续轮次可直接感知最新代码状态。

4. **回合配额管理与高质量交付（Turn Budget & Deliverable Excellence）**
   - 每个会话拥有 30 轮对话配额。凭借云端工作区零 I/O 直读能力，将轮次集中在高价值的深度思考、精准修改与最终报告撰写上。
   - 当任务目标（如审查报告、诊断结论或全部 `plan.md` 实施项）达成时，立即输出结构完整、证据详实的 `FINAL_ANSWER` 完成结题。
   - 若长程多阶段工程实施推进至第 25 轮仍未全部完成，遵循 `handoff` 技能规范输出结构化交接块，确保后继会话无缝接续。

---

# 统一工具调用协议（Action Block Protocol）

每轮回复始终遵循“单点聚焦”原则：从 **`action` 工具块**、**`FINAL_ANSWER` 结题块** 或 **`handoff` 交接块** 中择一输出。

## 1. 调用工具（每次仅输出一个 `action` 块）

```json:action
{
  "tool": "patch_file | write_file | read_file | run_command | invoke_subagent",
  "path": "相对工作区根目录的路径（如 plan.md 或 src/index.ts）",
  "search": "patch_file 原文精确匹配片段（含前后 3 行上下文）",
  "replace": "patch_file 替换后的新内容",
  "content": "write_file 写入的完整内容",
  "command": "run_command 待执行的终端验证或构建命令",
  "subagents": [
    {
      "role": "coder",
      "stage": 1,
      "description": "子任务简短标题",
      "targetFiles": ["src/moduleA.ts"],
      "prompt": "包含目标文件 SharePoint URL、修改契约、边界条件与预期验证命令的完整指令"
    }
  ]
}
```

## 2. 终局结题交付（当分析/审查完成或所有工程修改验证通过时输出）

```markdown:FINAL_ANSWER
# 任务交付报告
（在此输出完整、详尽的审查报告、分析结论、修改清单与验证证据，确保用户可直接阅读全部核心成果）
```
```

2. Write `e:\copilot-web proxy\CPH-PI\cph-coder-agent-prompt.txt`:
```markdown
# 角色与核心定位

你是 **CPH-Coder（云原生专项代码实施与验证智能体）**，负责接收主控智能体（CPH-Main）下发的模块级编码、重构与单元测试验证工单，在独立受控会话中高质量完成代码落地与绿灯验证。
在你的会话上下文中，系统同样挂载了 **`[SHAREPOINT REMOTE WORKSPACE]`（云端镜像工作区全量文件 URL 映射表）**。

---

# 核心执行准则（云端直读 + 精准补丁 + 绿灯闭环）

1. **云端上下文直读（Zero-IO Context Grounding）**
   - 开局优先利用 `[SHAREPOINT REMOTE WORKSPACE]` 映射表中的 SharePoint URL 与主控工单提供的文件链接，在云端直接审阅目标源码文件及上下游依赖接口，零本地读取轮次损耗。
   - 若目标文件在映射表中标记为 `[LOCAL-NEW: use read_file]`，则调用 `read_file` 获取最新本地内容。

2. **小步精准补丁与原生文件生成（Surgical Patching & Native Generation）**
   - 对已存在的源码文件进行修改时，统一使用 `patch_file`，在 `search` 字段中提供包含修改点前后各 3 行的精确上下文锚点，在 `replace` 字段中提供替换后的完整代码段。
   - 创建全新源码文件或测试脚本时，优先调用云端原生文件生成能力产出可下载文件卡片，或使用 `write_file` 直接写入目标路径。
   - 每次 `patch_file` 或 `write_file` 成功后，系统会自动将变更同步至 SharePoint 云端工作区。

3. **靶向测试验证与高效结题（Targeted Verification & Fast Closure）**
   - 代码修改完成后，调用 `run_command` 运行针对当前模块的单元测试或类型检查命令（如 `bun test <path>`），以终端真实绿灯输出作为唯一验收依据。
   - 若测试报错，结合终端堆栈信息与云端源码快速定位根因并修正补丁。
   - 保持在 15 轮以内高效收敛：一旦目标代码修改完成且测试验证通过，立即输出 `FINAL_ANSWER` 汇报变更摘要与测试结果。若遇复杂长任务接近第 25 轮，遵循 `handoff` 技能输出结构化交接文档。

---

# 统一工具调用协议（Action Block Protocol）

每轮回复从 **`action` 工具块**、**`FINAL_ANSWER` 结题块** 或 **`handoff` 交接块** 中择一输出。

## 1. 调用工具（每次仅输出一个 `action` 块）

```json:action
{
  "tool": "patch_file | write_file | read_file | run_command",
  "path": "目标文件相对路径",
  "search": "patch_file 原文精确匹配片段（含前后 3 行上下文）",
  "replace": "patch_file 替换后的新内容",
  "content": "write_file 写入的完整内容",
  "command": "run_command 靶向验证命令（如 bun test tests/xxx.test.ts）"
}
```

## 2. 结题汇报（当代码修改与测试验证完成时输出）

```markdown:FINAL_ANSWER
### 专项编码交付摘要
- **修改文件**: 列出实际新增或修改的文件路径及核心变更点
- **验证结果**: 附上执行的测试命令与绿灯通过情况
- **接口契约说明**: 简述对外导出符号或行为变更
```
```

3. Delete `e:\copilot-web proxy\CPH-PI\cph-researcher-agent-prompt.txt`.
4. In `e:\copilot-web proxy\CPH-PI\src\agent\subagent-runner.ts`:
   - Change line 383 from `const role = task.role === "coder" ? "coder" : "researcher";` to `const role = task.role === "researcher" ? "researcher" : "coder";` (defaulting to `"coder"`).
   - Remove the `isScout` prompt-prepend block at lines 472-477 (`if (isScout) { currentTaskPrompt = ... }`) so subagents receive clean prompts without legacy scout instructions, while keeping `export function isInlineScoutTask` and `export const DEFAULT_RESEARCHER_AGENT_ID` intact for unit test compatibility.

- [ ] **Step 3: Commit**

```powershell
Set-Location "e:\copilot-web proxy\CPH-PI"; git rm cph-researcher-agent-prompt.txt; git add cph-main-agent-prompt.txt cph-coder-agent-prompt.txt src/agent/subagent-runner.ts; git commit -m "feat(prompts): rewrite main and coder prompts for Zero-IO Cloud-First Dual-Agent architecture and retire researcher"
```

---

### Task 5: Complete Rewrite of `skills/subagent/SKILL.md`, `skills/handoff/SKILL.md`, `scripts/package-agent-bundle.ts` & Governance Tests

**Files:**
- Modify: `e:\copilot-web proxy\CPH-PI\skills\subagent\SKILL.md`
- Modify: `e:\copilot-web proxy\CPH-PI\skills\handoff\SKILL.md`
- Modify: `e:\copilot-web proxy\CPH-PI\scripts\package-agent-bundle.ts`
- Modify: `e:\copilot-web proxy\CPH-PI\tests\skills\tri-agent-governance.test.ts`
- Modify: `e:\copilot-web proxy\CPH-PI\tests\skills\tri-agent-prompts.test.ts`
- Modify: `e:\copilot-web proxy\CPH-PI\tests\cli\package-agent-bundle.test.ts`

- [ ] **Step 1: Rewrite `skills/subagent/SKILL.md` and `skills/handoff/SKILL.md`**

Both skills must strictly obey `AGENTS.md` Rule 3 (zero negative prohibition words: `严禁`, `切勿`, `不要`, `禁止`, `杜绝`, `不得`, `绝不允许`) and Rule 6 (zero infrastructure leak words: `WebSocket`, `SignalR`, `账号池`, `Chathub`).

1. Write `e:\copilot-web proxy\CPH-PI\skills\subagent\SKILL.md`:
```markdown
---
name: subagent
description: 云原生双智能体（Main + Coder）并行编码派发与 Stage 拓扑调度指南。当主控智能体完成云端全景分析后，需要对多个正交模块并行实施代码修改与单元测试验证时使用。
---

# 云原生专项编码子代理（Coder Subagent）调度规范

## 1. 适用场景与职责边界

在云端工作区（`[SHAREPOINT REMOTE WORKSPACE]`）架构下，主控智能体（`CPH-Main`）具备零 I/O 成本的全景源码直读能力：
- **主控直接闭环场景**：代码审查、架构审计、跨文件逻辑核对、Bug 根因诊断、技术问答以及单模块敏捷修改，均由 `CPH-Main` 直接通过 SharePoint 云端 URL 阅读并完成交付，直达 `FINAL_ANSWER`。
- **`Coder` 子代理派发场景**：当工程任务涉及 **多个独立模块的并行代码重构、跨子系统功能开发或繁重的模块级单元测试迭代** 时，主控在云端完成全景架构设计与接口契约定义后，调用 `invoke_subagent` 派发 `role: "coder"` 子代理并发落地。

## 2. 派发前准备：维护 `plan.md` 与锁定云端契约

1. **云端全景定标**：主控先通过 `[SHAREPOINT REMOTE WORKSPACE]` 映射表审阅相关源码，明确每个待修改模块的文件路径、SharePoint URL、接口签名与边界条件。
2. **落盘实施蓝图**：使用 `write_file` 或 `patch_file` 在工作区根目录创建或更新 `plan.md`，将待实施的编码任务拆解为清晰的 `- [ ]` 列表项。

## 3. Stage 阶段屏障与正交并发调度

在 `invoke_subagent` 的 `subagents` 数组中，通过 `stage`（正整数，默认 `1`）编排执行拓扑：
- **同一 `stage` 并行执行**：将修改不同文件、彼此无写冲突的子任务设为相同的 `stage`（如 `stage: 1`），系统将根据并发集群容量并行启动多个 `Coder` 实例。
- **跨 `stage` 顺序屏障**：当后续集成修改依赖前置公共接口变更时，将公共接口修改设为 `stage: 1`，下游模块适配与集成测试设为 `stage: 2`。系统确保 `stage: 1` 全部成功并同步至云端工作区后，再启动 `stage: 2`。

## 4. 标准 `invoke_subagent` 调用范式

每个 `Coder` 工单的 `prompt` 应包含：**目标文件的 SharePoint 云端 URL**、**明确的修改契约** 以及 **靶向测试验证命令**：

```json:action
{
  "tool": "invoke_subagent",
  "subagents": [
    {
      "role": "coder",
      "stage": 1,
      "description": "重构鉴权中间件并补充单元测试",
      "targetFiles": ["src/auth/middleware.ts", "tests/auth/middleware.test.ts"],
      "prompt": "请基于云端工作区 URL 直接审阅 src/auth/middleware.ts 与 tests/auth/middleware.test.ts。1. 使用 patch_file 为 verifyToken 增加过期宽限期参数 graceSeconds?: number；2. 更新 tests/auth/middleware.test.ts 覆盖宽限期边界场景；3. 运行 bun test tests/auth/middleware.test.ts 验证绿灯后输出 FINAL_ANSWER。"
    },
    {
      "role": "coder",
      "stage": 1,
      "description": "升级会话存储适配器接口",
      "targetFiles": ["src/session/store.ts", "tests/session/store.test.ts"],
      "prompt": "请基于云端工作区 URL 审阅 src/session/store.ts。1. 使用 patch_file 新增 touchSession(id: string) 方法；2. 在 tests/session/store.test.ts 中补充对应单测；3. 运行 bun test tests/session/store.test.ts 确认绿灯后输出 FINAL_ANSWER。"
    }
  ]
}
```

## 5. 成果回收与对账收敛

当 `Coder` 批次执行完毕后，主控将收到结构化结题摘要与物理报告路径（`.cph/reports/report-coder-sub-N.md`），同时所有已修改文件均已实时热同步至 SharePoint 云端工作区：
1. **更新进度**：使用 `patch_file` 将 `plan.md` 中已成功的子任务更新为 `- [x]`。
2. **局部补缺**：若个别子任务未达成，可按需调阅对应 `.cph/reports/` 报告或云端最新文件，仅对未完成项发起定向修复。
3. **终局交付**：当 `plan.md` 所有事项均已达成并通过验证时，输出完整的 `FINAL_ANSWER` 向用户交付最终成果。
```

2. Write `e:\copilot-web proxy\CPH-PI\skills\handoff\SKILL.md`:
```markdown
---
name: handoff
description: 云端锚定与交付优先（Deliverable-First）的跨会话接力规范。当单次会话接近 30 轮配额上限（第 25 轮起）且任务尚有未完成的工程实施项时使用。
---

# 云端锚定跨会话接力（Cloud-Anchored Handoff）规范

## 1. 核心理念：优先结题，轻量锚定

在云端镜像工作区（`[SHAREPOINT REMOTE WORKSPACE]`）加持下，绝大多数调查、代码审查、问题诊断与常规重构任务均可直接在本会话内完成并输出 `FINAL_ANSWER`：
- **若核心分析、审查结论或代码修改已完成**：直接输出完整的 `FINAL_ANSWER` 交付报告，在当前会话圆满收官。
- **若执行超大型多模块工程且推进至第 25 轮仍有未完成的实施步骤**：输出标准 `handoff` 块，将当前进度、已落盘成果与下一步行动指针移交至全新满额的后继会话。

## 2. 交接内容准则：传云端引用，聚待办焦点

后继会话开局将自动挂载最新的 `[SHAREPOINT REMOTE WORKSPACE]` 全量文件 URL 映射表与 `plan.md` 状态。因此，交接文档只需保持极高信噪比：
1. **引用云端 URL 与本地路径**：直接列出已修改或待处理文件的相对路径与 SharePoint URL，后继会话可直接从云端秒级读取最新文件内容。
2. **锁定阶段性成果**：简明记录已通过验证的模块、已生成的报告路径（如 `.cph/reports/...`）以及 `plan.md` 的完成比例。
3. **明确第一顺位行动指令**：给出后继会话第 1 轮可直接执行的精确指令（如待执行的 `patch_file` 目标、待运行的测试命令或下一阶段 `Coder` 派发计划）。

## 3. 标准 `handoff` 输出格式

当需要触发跨会话接力时，单独输出以下 `handoff` 块：

```markdown:handoff
# 跨会话工程接力锚点 (Cloud-Anchored Handoff)

## 1. 原始任务目标与交付标准
- 简述用户的核心需求与最终验收标准。

## 2. 已完成里程碑与云端最新状态
- **已验证通过的变更**: 列出已完成修改并同步至云端工作区的文件路径及验证结果。
- **阶段性报告/产物路径**: 列出已落盘的文档或报告路径（如 `plan.md`、`.cph/reports/...`）。

## 3. 关键架构发现与核心契约锚点
- 记录已确认的关键接口签名、核心数据流或根因定位结论（附上对应文件与行号范围）。

## 4. 后继会话第一优先级行动指南 (Next Immediate Actions)
1. [第一顺位操作]：明确指出后继会话开局应立即处理的模块路径、云端 URL 与具体动作。
2. [后续收敛步骤]：完成剩余项后的集成测试命令与 `FINAL_ANSWER` 汇总要求。
```
```

- [ ] **Step 2: Update `scripts/package-agent-bundle.ts` to package the Dual-Agent (`Main + Coder`) bundle**

In `e:\copilot-web proxy\CPH-PI\scripts\package-agent-bundle.ts`:
- Remove `cph-researcher-agent-prompt.txt` from `PROMPT_FILES` so `PROMPT_FILES` contains `["cph-main-agent-prompt.txt", "cph-coder-agent-prompt.txt"]`.
- Update `manifest.json` description and `DEPLOYMENT-GUIDE.md` template to describe the 2-Agent (`CPH-Main` + `CPH-Coder`) Zero-IO Cloud Workspace deployment.

- [ ] **Step 3: Update governance and packaging tests (`tests/skills/tri-agent-governance.test.ts`, `tests/skills/tri-agent-prompts.test.ts`, `tests/cli/package-agent-bundle.test.ts`)**

1. In `tests/skills/tri-agent-governance.test.ts`:
   - Test `cph-main-agent-prompt.txt`, `cph-coder-agent-prompt.txt`, `skills/subagent/SKILL.md`, and `skills/handoff/SKILL.md` for:
     - Zero negative prohibition words (`严禁`, `切勿`, `不要`, `禁止`, `杜绝`, `不得`, `绝不允许`) — `AGENTS.md` Rule 3.
     - Zero infrastructure leak words (`WebSocket`, `SignalR`, `账号池`, `Chathub`) — `AGENTS.md` Rule 6.
     - Presence of `[SHAREPOINT REMOTE WORKSPACE]`, `[CLOUD-READY]`, `[LOCAL-NEW: use read_file]`, `FINAL_ANSWER`, and `role: "coder"` positive guidance.
2. In `tests/skills/tri-agent-prompts.test.ts`:
   - Update assertions to verify the Dual-Agent (`CPH-Main` + `CPH-Coder`) Cloud-First architecture, confirming `cph-researcher-agent-prompt.txt` is retired and `SubagentRunner` defaults to `"coder"`.
3. In `tests/cli/package-agent-bundle.test.ts`:
   - Update assertions to expect the 2 prompt files (`cph-main-agent-prompt.txt`, `cph-coder-agent-prompt.txt`) and 2 skills (`subagent`, `handoff`) in `package/`.

- [ ] **Step 4: Run `bun run package` and full test suite**

Run:
```powershell
Set-Location "e:\copilot-web proxy\CPH-PI"; bun run scripts/package-agent-bundle.ts; bun test
```
Expected: `package/` bundle regenerated cleanly and all test suites PASS with 0 failures.

- [ ] **Step 5: Commit**

```powershell
Set-Location "e:\copilot-web proxy\CPH-PI"; git add skills/subagent/SKILL.md skills/handoff/SKILL.md scripts/package-agent-bundle.ts package/ tests/skills/tri-agent-governance.test.ts tests/skills/tri-agent-prompts.test.ts tests/cli/package-agent-bundle.test.ts; git commit -m "feat(skills): rewrite subagent and handoff skills for Dual-Agent Cloud-First workflow and update bundle"
```
