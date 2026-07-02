$targetDirs = @("frontend-react\src", "frontend-web", "backend-node", "backend", "functions")
$rootFiles = @("README.md", "start.bat", "restart.bat", "Launch Divu AI.bat", "install_autostart.bat", "DEPLOYMENT.md")

function Replace-In-File {
    param([string]$FilePath)
    if (Test-Path $FilePath) {
        $content = Get-Content -Path $FilePath -Raw
        if ($null -ne $content -and $content -match "Divu|divu") {
            $newContent = $content -replace 'Divu AI Assistant', 'SERENOVA'
            $newContent = $newContent -replace 'Divu AI', 'SERENOVA'
            $newContent = $newContent -replace 'Divu', 'SERENOVA'
            $newContent = $newContent -replace 'divu', 'serenova'
            [IO.File]::WriteAllText($FilePath, $newContent)
            Write-Host "Updated $FilePath"
        }
    }
}

foreach ($file in $rootFiles) {
    Replace-In-File -FilePath ".\$file"
}

foreach ($dir in $targetDirs) {
    if (Test-Path ".\$dir") {
        Get-ChildItem -Path ".\$dir" -Recurse -File | ForEach-Object {
            $ext = $_.Extension
            if ($ext -in @('.js', '.jsx', '.json', '.html', '.css', '.md', '.py', '.bat')) {
                Replace-In-File -FilePath $_.FullName
            }
        }
    }
}

if (Test-Path ".\Launch Divu AI.bat") {
    Rename-Item -Path ".\Launch Divu AI.bat" -NewName "Launch SERENOVA.bat"
}
