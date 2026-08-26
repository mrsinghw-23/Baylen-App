param(
  [string]$SourcePath = "assets\icon\logo.png"
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $SourcePath)) {
  Write-Error "Missing launcher icon source: $SourcePath"
  exit 1
}

function Save-IconPng {
  param(
    [System.Drawing.Image]$Source,
    [string]$Path,
    [int]$Size,
    [int]$Padding = 0
  )

  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::Black)
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $available = $Size - ($Padding * 2)
  $scale = [Math]::Min($available / $Source.Width, $available / $Source.Height)
  $width = [int][Math]::Round($Source.Width * $scale)
  $height = [int][Math]::Round($Source.Height * $scale)
  $x = [int][Math]::Round(($Size - $width) / 2)
  $y = [int][Math]::Round(($Size - $height) / 2)

  $graphics.DrawImage($Source, $x, $y, $width, $height)
  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

  $graphics.Dispose()
  $bitmap.Dispose()
}

$source = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $SourcePath))

$androidSizes = @{
  "mipmap-mdpi" = 48
  "mipmap-hdpi" = 72
  "mipmap-xhdpi" = 96
  "mipmap-xxhdpi" = 144
  "mipmap-xxxhdpi" = 192
}

foreach ($entry in $androidSizes.GetEnumerator()) {
  Save-IconPng `
    -Source $source `
    -Path "android\app\src\main\res\$($entry.Key)\ic_launcher.png" `
    -Size $entry.Value
}

$adaptiveSizes = @{
  "mipmap-mdpi" = 108
  "mipmap-hdpi" = 162
  "mipmap-xhdpi" = 216
  "mipmap-xxhdpi" = 324
  "mipmap-xxxhdpi" = 432
}

foreach ($entry in $adaptiveSizes.GetEnumerator()) {
  Save-IconPng `
    -Source $source `
    -Path "android\app\src\main\res\$($entry.Key)\ic_launcher_foreground.png" `
    -Size $entry.Value `
    -Padding ([int][Math]::Round($entry.Value * 0.10))
}

New-Item -ItemType Directory -Force -Path "android\app\src\main\res\mipmap-anydpi-v26" | Out-Null
@'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
'@ | Set-Content -Encoding UTF8 "android\app\src\main\res\mipmap-anydpi-v26\ic_launcher.xml"

New-Item -ItemType Directory -Force -Path "android\app\src\main\res\values" | Out-Null
@'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#000000</color>
</resources>
'@ | Set-Content -Encoding UTF8 "android\app\src\main\res\values\ic_launcher_background.xml"

$iosIconSet = "ios\Runner\Assets.xcassets\AppIcon.appiconset"
$contentsPath = Join-Path $iosIconSet "Contents.json"
$contents = Get-Content -Raw $contentsPath | ConvertFrom-Json

foreach ($image in $contents.images) {
  if (-not $image.filename -or -not $image.size -or -not $image.scale) {
    continue
  }

  $baseSize = [double](($image.size -split "x")[0])
  $multiplier = [int]($image.scale -replace "x", "")
  $pixels = [int][Math]::Round($baseSize * $multiplier)
  Save-IconPng `
    -Source $source `
    -Path (Join-Path $iosIconSet $image.filename) `
    -Size $pixels
}

$source.Dispose()
Write-Host "Generated launcher icons from $SourcePath"
