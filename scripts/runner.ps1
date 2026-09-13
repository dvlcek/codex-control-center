$ErrorActionPreference = "Stop"

$threadId = $env:CCC_THREAD_ID
$promptFile = $env:CCC_PROMPT_FILE
$cwd = $env:CCC_CWD

if ([string]::IsNullOrWhiteSpace($threadId)) { throw "Missing CCC_THREAD_ID" }
if ([string]::IsNullOrWhiteSpace($promptFile) -or !(Test-Path -LiteralPath $promptFile)) { throw "Prompt file not found" }
if (-not [string]::IsNullOrWhiteSpace($cwd) -and (Test-Path -LiteralPath $cwd)) { Set-Location -LiteralPath $cwd }

$prompt = [System.IO.File]::ReadAllText($promptFile)
$codex = Get-Command codex -ErrorAction Stop

& $codex.Source exec --json resume $threadId $prompt
exit $LASTEXITCODE
