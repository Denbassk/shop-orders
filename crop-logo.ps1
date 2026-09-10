Add-Type -AssemblyName System.Drawing
$BandIndex = -1
$inPath  = "D:\shop-orders\assets\logo.png"
$outPath = "D:\shop-orders\assets\logo_header.png"

$orig = [System.Drawing.Bitmap]::FromFile($inPath)
$img = New-Object System.Drawing.Bitmap($orig.Width, $orig.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($img)
$g.DrawImage($orig, 0, 0, $orig.Width, $orig.Height)
$g.Dispose(); $orig.Dispose()

$W = $img.Width; $H = $img.Height
$bg = $img.GetPixel(0,0)
Write-Host "Size: $W x $H  bg: $($bg.R),$($bg.G),$($bg.B)"

$rows = New-Object System.Collections.ArrayList
for ($y=0; $y -lt $H; $y++) {
  for ($x=0; $x -lt $W; $x+=3) {
    $p = $img.GetPixel($x,$y)
    if ([Math]::Abs($p.R-$bg.R)+[Math]::Abs($p.G-$bg.G)+[Math]::Abs($p.B-$bg.B) -gt 40) { [void]$rows.Add($y); break }
  }
}
if ($rows.Count -eq 0) { Write-Host "NOTHING FOUND"; exit }

$bands = New-Object System.Collections.ArrayList
$s = $rows[0]; $prev = $rows[0]
foreach ($r in $rows) {
  if ($r - $prev -gt 12) { [void]$bands.Add(@($s,$prev)); $s = $r }
  $prev = $r
}
[void]$bands.Add(@($s,$prev))
Write-Host "Bands: $($bands.Count)"
for ($i=0; $i -lt $bands.Count; $i++) { Write-Host "  [$i] rows $($bands[$i][0])-$($bands[$i][1])" }

$b = if ($BandIndex -lt 0) { $bands[$bands.Count-1] } else { $bands[$BandIndex] }
$top = $b[0]; $bot = $b[1]
$left = $W; $right = 0
for ($y=$top; $y -le $bot; $y++) {
  for ($x=0; $x -lt $W; $x++) {
    $p = $img.GetPixel($x,$y)
    if ([Math]::Abs($p.R-$bg.R)+[Math]::Abs($p.G-$bg.G)+[Math]::Abs($p.B-$bg.B) -gt 40) {
      if ($x -lt $left) { $left = $x }
      if ($x -gt $right) { $right = $x }
    }
  }
}
$cw = $right-$left+1; $ch = $bot-$top+1
Write-Host "Cropped to: $cw x $ch"

$rect = New-Object System.Drawing.Rectangle($left,$top,$cw,$ch)
$crop = $img.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$img.Dispose()

$plate = $crop.GetPixel(1,1)
$white = [System.Drawing.Color]::White
for ($y=0; $y -lt $ch; $y++) {
  for ($x=0; $x -lt $cw; $x++) {
    $p = $crop.GetPixel($x,$y)
    if ([Math]::Abs($p.R-$plate.R)+[Math]::Abs($p.G-$plate.G)+[Math]::Abs($p.B-$plate.B) -lt 45) { $crop.SetPixel($x,$y,$white) }
  }
}
$crop.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$crop.Dispose()
Write-Host "DONE: $outPath"
