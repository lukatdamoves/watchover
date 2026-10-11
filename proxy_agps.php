<?php
// proxy_agps.php
// This script acts as a caching proxy for the A9G AGPS data file (brdcGPD.dat).
// It fetches the file from the remote slowly-responding server, caches it locally 
// for 2 hours (the dataset changes every ~2 hours), and serves it quickly to your A9G modules.
//
// INSTRUCTIONS:
// Upload this file to the web root of your server (e.g. watchover.tech)
// so it is accessible at: http://watchover.tech/proxy_agps.php
// Make sure the web server has write permissions to create 'brdcGPD.dat' in the same folder.

$cache_file = __DIR__ . '/brdcGPD.dat';
$cache_time = 2 * 3600; // 2 hours

$remote_url = 'http://106.14.219.140:7777/brdcGPD.dat';

// Check if we have a valid cached file
if (file_exists($cache_file) && (time() - filemtime($cache_file)) < $cache_time) {
    // Serve the cached file
    $file_size = filesize($cache_file);
    header('Content-Type: application/x-zip-compressed');
    header('Content-Disposition: attachment; filename="brdcGPD.dat"');
    header('Content-Length: ' . $file_size);
    readfile($cache_file);
    exit;
}

// Otherwise, fetch a fresh copy from the remote server
$context = stream_context_create([
    'http' => [
        'timeout' => 15 // 15 seconds timeout for fetching
    ]
]);

$data = @file_get_contents($remote_url, false, $context);

if ($data !== false) {
    // Save to cache
    file_put_contents($cache_file, $data);
    
    // Serve the freshly downloaded data
    header('Content-Type: application/x-zip-compressed');
    header('Content-Disposition: attachment; filename="brdcGPD.dat"');
    header('Content-Length: ' . strlen($data));
    echo $data;
} else {
    // If the remote server failed but we have a stale cache, serve the stale cache anyway as a fallback
    if (file_exists($cache_file)) {
        $file_size = filesize($cache_file);
        header('Content-Type: application/x-zip-compressed');
        header('Content-Disposition: attachment; filename="brdcGPD.dat"');
        header('Content-Length: ' . $file_size);
        header('X-Fallback-Cache: true');
        readfile($cache_file);
        exit;
    }
    
    // Otherwise, return an error
    http_response_code(502); // Bad Gateway
    echo "Failed to fetch AGPS data.";
}
?>
