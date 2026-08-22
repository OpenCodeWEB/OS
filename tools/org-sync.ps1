<#
.SYNOPSIS
    org-sync - OpenCodeWEB org-wide git preservation & production-merge tool.

.DESCRIPTION
    Treats every repository under the OpenCodeWEB workspace as one product
    surface. For each repo it can:

      1. AUDIT        branch, dirty files, unpushed commits, default branch
      2. PRESERVE     stage meaningful changes (junk-aware), auto-commit,
                      push current branch to origin
      3. MERGE-PROD   land the working branch onto the repo's production
                      branch (remote HEAD) - fast-forward only, never force

    Junk-aware: __pycache__, dist, node_modules, .pytest_cache, *.log,
    .wrangler, tmp-store*.json etc. are never committed.

.PARAMETER Audit
    Show status table only. No writes.

.PARAMETER Push
    Preserve (commit+push) uncommitted meaningful work and push unpushed commits.

.PARAMETER MergeProd
    After pushing, land the current branch into the production branch
    (remote HEAD) via fast-forward refspec push. Creates the prod branch
    from current if it does not exist yet.

.PARAMETER Repos
    Subset of repo names to process (default: all git repos under -Root).

.PARAMETER Root
    Workspace root containing all org repos.
    Default: D:\OpenCodeWEBsui\OpenCodeWEB

.EXAMPLE
    ./org-sync.ps1 -Audit
    ./org-sync.ps1 -Push
    ./org-sync.ps1 -Push -MergeProd -Repos GDBX,OS,AiA
#>
param(
  [switch]$Audit,
  [switch]$Push,
  [switch]$MergeProd,
  [string[]]$Repos,
  [string]$Root = "D:\OpenCodeWEBsui\OpenCodeWEB"
)

$ErrorActionPreference = "Continue"

# Junk patterns that must never be auto-committed
$JunkRegex = '(^|/|\\)(__pycache__|\.pytest_cache|\.ruff_cache|dist|node_modules|\.wrangler|\.worktrees)(/|\\|$)|\.pyc$|\.log$|^tmp-store|^tmp-store\d|tsconfig\.tsbuildinfo'

function Get-DefaultBranch {
  param([string]$RepoPath)
  $head = git -C $RepoPath symbolic-ref refs/remotes/origin/HEAD 2>$null
  if ($head) { return $head -replace 'refs/remotes/origin/', '' }
  foreach ($c in @("main", "master", "Dev")) {
    if (git -C $RepoPath show-ref --verify --quiet "refs/heads/$c") { return $c }
  }
  return $null
}

function Get-MeaningfulStatus {
  param([string]$RepoPath)
  $lines = git -C $RepoPath status --porcelain 2>$null
  $meaningful = @(); $junk = @()
  foreach ($l in $lines) {
    if ([string]::IsNullOrWhiteSpace($l)) { continue }
    $path = $l.Substring(3).Trim('"')
    if ($path -match $JunkRegex) { $junk += $l } else { $meaningful += $l }
  }
  return @{ Meaningful = $meaningful; Junk = $junk }
}

function Format-Bullet([string]$Text) {
  $t = ($Text.Trim() -replace "\r?\n", " -- ")
  if ($t.Length -gt 72) { $t = $t.Substring(0, 69) + "..." }
  return $t
}

$results = @()

Get-ChildItem -Directory -Path $Root | Where-Object { Test-Path (Join-Path $_.FullName ".git") } | ForEach-Object {
  $name = $_.Name
  if ($Repos -and $Repos -notcontains $name) { return }
  $path = $_.FullName

  $branch   = (git -C $path branch --show-current 2>$null)
  $default  = Get-DefaultBranch $path
  $st       = Get-MeaningfulStatus $path
  $dirty    = $st.Meaningful.Count
  $aheadList = @(git -C $path log --branches --not --remotes --oneline 2>$null)

  $row = New-Object PSObject -Property @{
    Repo = $name; Branch = $branch; Prod = $default
    Dirty = $dirty; Unpushed = $aheadList.Count; Action = ""
  }

  # ---- 1. PRESERVE -------------------------------------------------
  if ($Push) {
    if ($dirty -gt 0) {
      git -C $path add -A 2>$null | Out-Null
      $st.Junk | ForEach-Object {
        $jp = $_.Substring(3).Trim('"')
        git -C $path reset -q HEAD -- $jp 2>$null | Out-Null
      }
      $statLine = (git -C $path diff --cached --stat 2>$null | Select-Object -Last 1)
      if ($statLine -match "changed") {
        $msg = "chore(sync): preserve work-in-progress - $statLine"
        git -C $path commit -q -m $msg 2>$null | Out-Null
        $row.Action += "committed($($statLine.Trim())); "
      } else {
        git -C $path reset -q 2>$null | Out-Null
      }
      $dirty = (Get-MeaningfulStatus $path).Meaningful.Count
      $row.Dirty = $dirty
    }
    $upstream = git -C $path rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null
    $out = git -C $path push origin $branch 2>&1
    if ($LASTEXITCODE -eq 0) { $row.Action += "pushed->origin/$branch; " }
    else { $row.Action += "PUSH-FAIL: $(Format-Bullet ($out -join ' ')); " }
  }

  # ---- 2. MERGE TO PRODUCTION --------------------------------------
  if ($MergeProd -and $default -and $branch -ne $default) {
    git -C $path merge-base --is-ancestor $default $branch 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $out = git -C $path push origin "${branch}:refs/heads/$default" 2>&1
      if ($LASTEXITCODE -eq 0) { $row.Action += "prod-merged->$default(ff); " }
      else { $row.Action += "PROD-PUSH-FAIL: $(Format-Bullet ($out -join ' ')); " }
    } else {
      $row.Action += "prod-DIVERGED($default needs pull/rebase); "
    }
  }

  if (-not $row.Action) {
    if ($dirty -gt 0 -or $aheadList.Count -gt 0) { $row.Action = "NEEDS -Push" }
    else { $row.Action = "clean OK" }
  }

  $results += $row
}

# ---- Report --------------------------------------------------------
$results |
  Select-Object Repo, Branch, Prod, Dirty, Unpushed, Action |
  Format-Table -AutoSize | Out-String -Width 220 | Write-Output

$needsWork = $results | Where-Object { $_.Action -notmatch "clean OK" }
Write-Output ("SUMMARY: {0} repos - {1} need attention" -f $results.Count, $needsWork.Count)
if ($needsWork.Count -gt 0) {
  $needsWork | ForEach-Object { Write-Output ("  * {0} [{1}] -> {2}" -f $_.Repo, $_.Branch, $_.Action) }
}
