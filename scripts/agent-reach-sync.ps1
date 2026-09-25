# ============================================================
# CivilCareer — Agent Reach sync script (example)
# ============================================================
# Sends structured Agent Reach results to the CivilCareer
# ingestion endpoint. Safe to run repeatedly: the server
# de-duplicates every item (external id / source URL).
#
# Everything ingested enters Pending Review. Agent Reach
# NEVER publishes directly — an admin publishes from
# Admin → Agent Reach after verifying the source.
#
# Required environment variables (never hard-code the secret):
#   CIVILCAREER_URL         e.g. https://civilcareer-india-two.vercel.app
#   AGENT_REACH_INGEST_KEY  the value of AGENT_REACH_INGEST_KEY on the server
#
# Usage:
#   .\agent-reach-sync.ps1                          # sends .\agent-reach-items.json
#   .\agent-reach-sync.ps1 -ItemsFile results.json  # any Agent Reach output file
# ============================================================

param(
  [string]$ItemsFile = ".\agent-reach-items.json"
)

$ErrorActionPreference = "Stop"

$BaseUrl = $env:CIVILCAREER_URL
$IngestKey = $env:AGENT_REACH_INGEST_KEY

if (-not $BaseUrl)     { Write-Error "Set CIVILCAREER_URL (your deployment URL), e.g. https://civilcareer-india-two.vercel.app"; exit 1 }
if (-not $IngestKey)   { Write-Error "Set AGENT_REACH_INGEST_KEY (must match the server environment variable)"; exit 1 }
if (-not (Test-Path $ItemsFile)) { Write-Error "Items file not found: $ItemsFile"; exit 1 }

$BaseUrl = $BaseUrl.TrimEnd("/")

# ── Optional: verify the endpoint and key before sending ─────────
try {
  $probe = Invoke-RestMethod -Method Get `
    -Uri "$BaseUrl/api/agent-reach-ingest?status=1" `
    -Headers @{ Authorization = "Bearer $IngestKey" } `
    -TimeoutSec 30

  if ($probe.ok) { Write-Host "Endpoint ready ($($probe.service))." -ForegroundColor Green }
} catch {
  Write-Error "Endpoint check failed: $($_.Exception.Message). Check CIVILCAREER_URL and AGENT_REACH_INGEST_KEY."
  exit 1
}

# ── Load Agent Reach results ─────────────────────────────────────
# The file must contain either one item object or { "items": [ ... ] }.
# Expected item shapes (fields beyond these are preserved as metadata):
#
# Job:
# {
#   "type": "job",
#   "source": { "url": "https://example.com/job/123", "name": "Example Engineering Careers", "external_id": "abc123" },
#   "title": "Civil Site Engineer",
#   "company": "Example Infra Pvt Ltd",
#   "location": "Bengaluru, Karnataka",
#   "description": "...",
#   "apply_url": "https://example.com/apply",
#   "employment_type": "Full-time",
#   "experience": "2-5 years",
#   "skills": ["AutoCAD", "Civil 3D"],
#   "published_date": "2026-09-25",
#   "deadline": null
# }
#
# Resource / video / note:
# {
#   "type": "resource",
#   "source": { "url": "https://example.com/video", "name": "Example Source" },
#   "title": "Highway Engineering Lecture",
#   "description": "...",
#   "url": "https://example.com/video",
#   "category": "Transportation Engineering",
#   "content_type": "video"
# }

$Payload = Get-Content -Raw -Path $ItemsFile | ConvertFrom-Json

# Normalise to a batch: a bare array or a single object also works.
if ($Payload -is [array]) {
  $BodyObject = @{ items = $Payload }
} elseif ($Payload.items) {
  $BodyObject = $Payload
} else {
  $BodyObject = @{ items = @($Payload) }
}

$BodyJson = $BodyObject | ConvertTo-Json -Depth 12

# ── Send ─────────────────────────────────────────────────────────
try {
  $Response = Invoke-RestMethod -Method Post `
    -Uri "$BaseUrl/api/agent-reach-ingest" `
    -Headers @{ Authorization = "Bearer $IngestKey"; "Content-Type" = "application/json" } `
    -Body $BodyJson `
    -TimeoutSec 120

  Write-Host ("Received: {0}  Created: {1}  Updated: {2}  Duplicates: {3}  Rejected: {4}" -f `
    $Response.received, $Response.created, $Response.updated, $Response.duplicates, $Response.rejected) `
    -ForegroundColor Green

  if ($Response.errors) {
    Write-Host "Items with problems:" -ForegroundColor Yellow
    foreach ($e in $Response.errors) {
      Write-Host ("  - [{0}] {1}: {2}" -f $e.index, $e.title, $e.error)
    }
  }

  Write-Host "`nAll ingested items are waiting in Admin → Agent Reach for review." -ForegroundColor Cyan
  exit 0
} catch {
  $status = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
  switch ($status) {
    401 { Write-Error "Unauthorized (401): the key does not match AGENT_REACH_INGEST_KEY on the server." }
    400 { Write-Error "Rejected payload (400): $($_.ErrorDetails.Message)" }
    default { Write-Error "Sync failed: $($_.Exception.Message)" }
  }
  exit 1
}
