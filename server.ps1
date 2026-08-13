param([int]$Port = 4173)

$root = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
$listener.Start()
Write-Host "Food Journal server listening on port $Port"

while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
        $stream = $client.GetStream()
        $reader = [System.IO.StreamReader]::new($stream)
        $requestLine = $reader.ReadLine()
        while (($line = $reader.ReadLine()) -and $line.Length -gt 0) { }
        $parts = $requestLine -split ' '
        $relative = if ($parts.Count -gt 1) { [Uri]::UnescapeDataString(($parts[1] -split '\?')[0]).TrimStart('/') } else { 'index.html' }
        if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
        $candidate = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
        $valid = $candidate.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $candidate -PathType Leaf)
        if ($valid) {
            $contentTypes = @{ '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.json'='application/json; charset=utf-8'; '.jpg'='image/jpeg'; '.png'='image/png'; '.svg'='image/svg+xml' }
            $extension = [System.IO.Path]::GetExtension($candidate).ToLowerInvariant()
            $contentType = $contentTypes[$extension]
            if (-not $contentType) { $contentType = 'application/octet-stream' }
            $body = [System.IO.File]::ReadAllBytes($candidate)
            $status = '200 OK'
        } else {
            $body = [System.Text.Encoding]::UTF8.GetBytes('Not found')
            $contentType = 'text/plain; charset=utf-8'
            $status = '404 Not Found'
        }
        $header = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
        $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
        $stream.Write($headerBytes, 0, $headerBytes.Length)
        $stream.Write($body, 0, $body.Length)
        $stream.Flush()
        $stream.Dispose()
        $client.Dispose()
    } catch {
        try { $client.Dispose() } catch {}
    }
}
