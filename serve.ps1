<#
.SYNOPSIS
  Serve the two development pages.

.DESCRIPTION
  Starts devserver.py, which serves this folder with caching off. Use it for
  selftest.html and preview.html.

  The app itself cannot run here: it is a Home Assistant panel and needs the
  hass object the frontend gives it. Use .\deploy.ps1 and test it in Home
  Assistant.

.PARAMETER Port
  Port to listen on. Default 8080.

.EXAMPLE
  .\serve.ps1
  .\serve.ps1 -Port 3000
#>

param(
    [int] $Port = 8080
)

$ErrorActionPreference = 'Stop'

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }

if (-not $python) {
    Write-Error 'Python was not found. Install it, or use .\deploy.ps1 and test in Home Assistant.'
    exit 1
}

& $python.Source (Join-Path $PSScriptRoot 'devserver.py') --port $Port
