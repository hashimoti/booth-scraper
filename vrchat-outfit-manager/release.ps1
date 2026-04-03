param (
    [Parameter(Mandatory=$true)]
    [string]$Version,
    
    [string]$ReleaseNotes = "UIの改善とバグ修正を行いました。"
)

$RawVersion = $Version.TrimStart("v")
$TagVersion = "v$RawVersion"

Write-Host "🚀 リリース準備を開始します: $TagVersion" -ForegroundColor Cyan

# おせっかいなBOMを付けないように「BOMなしUTF-8」のルールを作成
$utf8NoBom = New-Object System.Text.UTF8Encoding($False)

# 1. バージョン番号の書き換え
Write-Host "📝 バージョン番号を書き換えています..."
$filesToUpdate = @("package.json", "src-tauri/tauri.conf.json")
foreach ($file in $filesToUpdate) {
    if (Test-Path $file) {
        $content = Get-Content $file -Raw -Encoding UTF8
        $content = $content -replace '"version":\s*".*?"', ('"version": "' + $RawVersion + '"')
        
        # 安全な方法(BOMなし)で上書き保存
        $FullPath = Join-Path $PWD $file
        [System.IO.File]::WriteAllText($FullPath, $content, $utf8NoBom)
    }
}

# 2. ビルドの実行
Write-Host "🔨 ビルドを実行しています... (少し時間がかかります)"
& .\build.ps1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ ビルドに失敗しました。" -ForegroundColor Red
    exit 1
}

# 3. 新しい署名の取得
$SigPath = "src-tauri/target/release/bundle/nsis/VRC-Outfit-manager_${RawVersion}_x64-setup.exe.sig"
if (-Not (Test-Path $SigPath)) {
    Write-Host "❌ 署名ファイルが見つかりません: $SigPath" -ForegroundColor Red
    exit 1
}
$Signature = (Get-Content $SigPath -Raw).Trim()

# 4. latest.json の自動更新
Write-Host "📝 latest.json を更新しています..."
$LatestJsonPath = "latest.json"
$PubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$Url = "https://github.com/hashimoti/booth-scraper/releases/download/$TagVersion/VRC-Outfit-manager_${RawVersion}_x64-setup.exe"

$jsonContent = Get-Content $LatestJsonPath -Raw -Encoding UTF8
$jsonContent = $jsonContent -replace '"version":\s*".*?"', ('"version": "' + $TagVersion + '"')
$jsonContent = $jsonContent -replace '"notes":\s*".*?"', ('"notes": "' + $ReleaseNotes + '"')
$jsonContent = $jsonContent -replace '"pub_date":\s*".*?"', ('"pub_date": "' + $PubDate + '"')
$jsonContent = $jsonContent -replace '"signature":\s*".*?"', ('"signature": "' + $Signature + '"')
$jsonContent = $jsonContent -replace '"url":\s*".*?"', ('"url": "' + $Url + '"')

# latest.json も安全な方法(BOMなし)で保存
$LatestFullPath = Join-Path $PWD $LatestJsonPath
[System.IO.File]::WriteAllText($LatestFullPath, $jsonContent, $utf8NoBom)

# --- Gitの操作案内 ---
Write-Host ""
Write-Host "✅ ビルドとファイルの準備がすべて完了しました！" -ForegroundColor Green
Write-Host "変更内容（Gitの差分）を確認してから、以下のコマンドをコピペして手動でリリースを進めてください。" -ForegroundColor Yellow
Write-Host "--------------------------------------------------"
Write-Host "git add ."
Write-Host "git commit -m `"chore: release $TagVersion`""
Write-Host "git push origin main"
Write-Host "git tag $TagVersion"
Write-Host "git push origin $TagVersion"
Write-Host "--------------------------------------------------"
Write-Host "最後にGitHub Releasesを開き、$TagVersion を作成して以下の3つをアップロードしてください：" -ForegroundColor Cyan
Write-Host "1. VRC-Outfit-manager_${RawVersion}_x64-setup.exe"
Write-Host "2. VRC-Outfit-manager_${RawVersion}_x64-setup.exe.sig"
Write-Host "3. latest.json"