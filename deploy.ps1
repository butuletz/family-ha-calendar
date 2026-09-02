<#
.SYNOPSIS
  Copy the Family Calendar integration into Home Assistant.

.DESCRIPTION
  The app is a Home Assistant custom integration: one folder, copied into
  /config/custom_components/, then restart Home Assistant. The integration
  registers its own sidebar panel and serves its own frontend files, so there
  is nothing to add to configuration.yaml and no version numbers to bump.

  For everyday use install it through HACS instead; this script is for
  developing against a Home Assistant that has no HACS, or before a release.

  The integration serves those files with caching disabled, so a restart is
  genuinely all it takes for everyone to see the new version. That is the whole
  reason this is an integration rather than files in www/.

.PARAMETER Stage
  Don't copy anywhere -- gather the integration into .\_deploy\family_calendar
  and open it in Explorer. Use this with the Studio Code Server add-on: drag the
  single folder into /config/custom_components/.

.PARAMETER Destination
  Target folder, ending in custom_components. Prefer the IP over
  \\homeassistant\ -- Windows resolves SMB names to .local unreliably.

.EXAMPLE
  .\deploy.ps1 -Stage
  .\deploy.ps1 -Destination \\192.168.1.50\config\custom_components
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch] $Stage,
    [string] $Destination = '\\homeassistant\config\custom_components'
)

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'custom_components\family_calendar'

if (-not (Test-Path -LiteralPath $source)) {
    Write-Error "Integration folder not found at $source"
    exit 1
}

if ($Stage) {
    $Destination = Join-Path $PSScriptRoot '_deploy'
    if (Test-Path -LiteralPath $Destination) {
        Remove-Item -LiteralPath $Destination -Recurse -Force
    }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
}

$target = Join-Path $Destination 'family_calendar'

Write-Host "Source:      $source"
Write-Host "Destination: $target"
Write-Host ''

if (-not (Test-Path -LiteralPath $Destination)) {
    if ($PSCmdlet.ShouldProcess($Destination, 'Create folder')) {
        try {
            New-Item -ItemType Directory -Path $Destination -Force | Out-Null
        }
        catch {
            Write-Error @"
Could not create $Destination

Home Assistant's config folder is not reachable from this machine at that path.
Use -Stage and drag the folder in with the Studio Code Server add-on, or pass a
reachable path with -Destination.
"@
            exit 1
        }
    }
}

if ($PSCmdlet.ShouldProcess($target, 'Copy integration')) {
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
    Copy-Item -LiteralPath $source -Destination $target -Recurse -Force

    # __pycache__ from a previous run on the server would shadow new code.
    Get-ChildItem -LiteralPath $target -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force

    $count = (Get-ChildItem -LiteralPath $target -Recurse -File).Count
    Write-Host "  copied $count files"
}

Write-Host ''

if ($Stage) {
    Write-Host 'Staged. Next:' -ForegroundColor Green
    Write-Host '  1. Open Studio Code Server in Home Assistant.'
    Write-Host '  2. Drag the family_calendar folder into /config/custom_components/,'
    Write-Host '     replacing the old one.'
    Write-Host '  3. Restart Home Assistant.'
    Start-Process explorer.exe $Destination
}
else {
    Write-Host 'Copied. Restart Home Assistant to load it.' -ForegroundColor Green
}

Write-Host ''
Write-Host 'First install only: after restarting, add it from'
Write-Host '  Settings > Devices & services > Add integration > Family Calendar' -ForegroundColor Cyan
Write-Host ''
Write-Host 'The panel then appears in the sidebar. Nothing goes in configuration.yaml.'
