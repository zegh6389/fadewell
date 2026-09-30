param([string]$App = 'fadewell-api')
$ErrorActionPreference = 'Stop'
$api = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path (Split-Path -Parent $api) 'web'
$temp = [System.IO.Path]::GetTempPath()
if (-not (Test-Path -LiteralPath $temp)) { throw 'Missing temporary directory' }
if ($App -notmatch '^[a-z][a-z0-9-]+$') { throw 'Invalid Heroku app name' }
$archive = Join-Path $temp "mmjgreen-$([guid]::NewGuid().ToString('N')).tar.gz"

npm --prefix $api run typecheck
if ($LASTEXITCODE -ne 0) { throw 'API typecheck failed' }
npm --prefix $frontend run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }

# Explicit source allowlist excludes credentials, node_modules, tests, and legacy files.
tar -czf $archive -C $api package.json package-lock.json Procfile src migrations deploy -C $frontend dist
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }
$token = (& heroku auth:token).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Heroku login failed' }
$headers = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.heroku+json; version=3' }
$source = Invoke-RestMethod -Uri "https://api.heroku.com/apps/$App/sources" -Method Post -Headers $headers
& curl.exe --fail --silent --show-error --request PUT --header 'Content-Type:' --data-binary "@$archive" $source.source_blob.put_url
if ($LASTEXITCODE -ne 0) { throw 'Source upload failed' }
$body = @{ source_blob = @{ url = $source.source_blob.get_url; version = "staging-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))" } }
$build = Invoke-RestMethod -Uri "https://api.heroku.com/apps/$App/builds" -Method Post -Headers $headers -ContentType 'application/json' -Body (ConvertTo-Json -Compress $body)
"Build submitted: $($build.id)"
for ($i = 0; $i -lt 50; $i++) {
  Start-Sleep -Seconds 6
  $result = Invoke-RestMethod -Uri "https://api.heroku.com/apps/$App/builds/$($build.id)" -Headers $headers
  if ($result.status -eq 'failed') { throw "Heroku build failed: $($build.id)" }
  if ($result.status -eq 'succeeded') {
    "Build succeeded: $($build.id)"
    heroku ps:scale web=1:Basic --app $App
    if ($LASTEXITCODE -ne 0) { throw 'Dyno scaling failed' }
    $appInfo = Invoke-RestMethod -Uri "https://api.heroku.com/apps/$App" -Headers $headers
    $origin = $appInfo.web_url.TrimEnd('/')
    $healthy = $false
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
      try {
        $ready = Invoke-RestMethod -Uri "$origin/api/health/ready" -TimeoutSec 15
        $auth = Invoke-RestMethod -Uri "$origin/api/auth/status" -TimeoutSec 15
        if ($ready.status -eq 'ready' -and $auth.configured -eq $true) {
          $healthy = $true
          break
        }
      } catch { }
      Start-Sleep -Seconds 3
    }
    if (-not $healthy) { throw 'Deployment released but origin readiness/auth checks failed' }
    'Origin readiness and authentication configuration verified'
    exit 0
  }
}
throw "Build still pending: $($build.id)"
