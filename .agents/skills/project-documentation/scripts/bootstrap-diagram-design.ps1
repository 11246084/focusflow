[CmdletBinding()]
param(
    [ValidateSet('Check', 'InstallCodex', 'InstallClaude', 'InstallAll')]
    [string]$Mode = 'Check'
)

$ErrorActionPreference = 'Stop'

$marketplaceSource = 'cathrynlavery/diagram-design'
$marketplaceName = 'diagram-design'
$pluginId = 'diagram-design@diagram-design'

function Resolve-ClaudeExecutable {
    $claudeCommand = Get-Command claude -ErrorAction SilentlyContinue
    if ($claudeCommand) {
        return $claudeCommand.Source
    }

    if ($env:APPDATA) {
        $candidate = Join-Path $env:APPDATA 'npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe'
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    return $null
}

function Resolve-PythonExecutable {
    foreach ($name in @('python3', 'python')) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if (-not $command) {
            continue
        }

        & $command.Source --version *> $null
        if ($LASTEXITCODE -eq 0) {
            return $command.Source
        }
    }

    return $null
}

function Test-CodexPlugin {
    if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
        return $false
    }

    $raw = & codex plugin list --marketplace $marketplaceName --json 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $raw) {
        return $false
    }

    try {
        $state = $raw | ConvertFrom-Json
        return [bool]($state.installed | Where-Object {
            $_.pluginId -eq $pluginId -and $_.installed -and $_.enabled
        })
    }
    catch {
        return $false
    }
}

function Test-ClaudePlugin {
    $claudeExecutable = Resolve-ClaudeExecutable
    if (-not $claudeExecutable) {
        return $false
    }

    $raw = & $claudeExecutable plugin list --json 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $raw) {
        return $false
    }

    try {
        $state = $raw | ConvertFrom-Json
        return [bool]($state | Where-Object {
            $_.id -eq $pluginId -and $_.enabled
        })
    }
    catch {
        return $false
    }
}

function Test-Playwright {
    $pythonExecutable = Resolve-PythonExecutable
    if (-not $pythonExecutable) {
        return $false
    }

    & $pythonExecutable -c 'import playwright' *> $null
    return $LASTEXITCODE -eq 0
}

function Test-PlaywrightChromium {
    $pythonExecutable = Resolve-PythonExecutable
    if (-not $pythonExecutable -or -not (Test-Playwright)) {
        return $false
    }

    $probe = "from playwright.sync_api import sync_playwright; p=sync_playwright().start(); b=p.chromium.launch(headless=True); b.close(); p.stop()"
    & $pythonExecutable -c $probe *> $null
    return $LASTEXITCODE -eq 0
}

function Ensure-CodexPlugin {
    if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
        throw 'Codex CLI was not found. Install Codex before installing its diagram-design plugin.'
    }

    $marketplaces = (& codex plugin marketplace list 2>&1 | Out-String)
    if ($marketplaces -notmatch '(?m)^diagram-design\s') {
        & codex plugin marketplace add $marketplaceSource
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to add the diagram-design marketplace to Codex.'
        }
    }

    if (-not (Test-CodexPlugin)) {
        & codex plugin add $pluginId
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to install diagram-design for Codex.'
        }
    }
}

function Ensure-ClaudePlugin {
    $claudeExecutable = Resolve-ClaudeExecutable
    if (-not $claudeExecutable) {
        throw 'Claude Code CLI was not found. Install Claude Code before installing its diagram-design plugin.'
    }

    $marketplaces = (& $claudeExecutable plugin marketplace list 2>&1 | Out-String)
    if ($marketplaces -notmatch '(?m)^\s*>\s*diagram-design\s*$') {
        & $claudeExecutable plugin marketplace add $marketplaceSource
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to add the diagram-design marketplace to Claude Code.'
        }
    }

    if (-not (Test-ClaudePlugin)) {
        & $claudeExecutable plugin install $pluginId --scope user --yes
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to install diagram-design for Claude Code.'
        }
    }
}

function Ensure-ExportDependencies {
    $pythonExecutable = Resolve-PythonExecutable
    if (-not $pythonExecutable) {
        throw 'Python 3.10 or newer is required for diagram-design import/export checks.'
    }

    if (-not (Test-Playwright)) {
        & $pythonExecutable -m pip install --progress-bar off playwright
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to install the Python Playwright package.'
        }
    }

    if (-not (Test-PlaywrightChromium)) {
        & $pythonExecutable -m playwright install chromium
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to install Playwright Chromium.'
        }
    }
}

if ($Mode -eq 'InstallCodex' -or $Mode -eq 'InstallAll') {
    Ensure-CodexPlugin
}

if ($Mode -eq 'InstallClaude' -or $Mode -eq 'InstallAll') {
    Ensure-ClaudePlugin
}

if ($Mode -ne 'Check') {
    Ensure-ExportDependencies
}

$codexReady = Test-CodexPlugin
$claudeReady = Test-ClaudePlugin
$playwrightReady = Test-Playwright
$chromiumReady = Test-PlaywrightChromium

Write-Output ('Codex plugin: ' + $(if ($codexReady) { 'READY' } else { 'MISSING' }))
Write-Output ('Claude Code plugin: ' + $(if ($claudeReady) { 'READY' } else { 'MISSING' }))
Write-Output ('Python Playwright: ' + $(if ($playwrightReady) { 'READY' } else { 'MISSING' }))
Write-Output ('Playwright Chromium: ' + $(if ($chromiumReady) { 'READY' } else { 'MISSING' }))

if ($codexReady -and $claudeReady -and $playwrightReady -and $chromiumReady) {
    Write-Output 'DIAGRAM_DESIGN_READY'
    exit 0
}

Write-Output 'DIAGRAM_DESIGN_INCOMPLETE'
exit 2
