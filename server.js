// Zero-dependency static server for the Pairwise app.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const TEXT = /^(text\/|application\/json|image\/svg)/;

// Files are cached in memory (with a gzip copy and ETag) until they change on disk.
const cache = new Map();
function load(file, cb) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return cb(err || new Error('not a file'));
    const hit = cache.get(file);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return cb(null, hit);
    fs.readFile(file, (err2, data) => {
      if (err2) return cb(err2);
      const type = TYPES[path.extname(file)] || 'application/octet-stream';
      const entry = { mtime: st.mtimeMs, size: st.size, type, data,
        etag: '"' + crypto.createHash('sha1').update(data).digest('base64url').slice(0, 16) + '"',
        gz: TEXT.test(type) && data.length > 1024 ? zlib.gzipSync(data, { level: 9 }) : null };
      cache.set(file, entry);
      cb(null, entry);
    });
  });
}

http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
  let file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  if (urlPath.endsWith('/')) file = path.join(file, 'index.html');
  load(file, (err, f) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    // no-cache = the browser keeps a copy but checks it each load; unchanged files come back as a tiny 304
    const headers = { 'Content-Type': f.type, 'Cache-Control': 'no-cache', 'ETag': f.etag, 'Vary': 'Accept-Encoding', 'X-Content-Type-Options': 'nosniff' };
    if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, headers); return res.end(); }
    const gzip = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (gzip) headers['Content-Encoding'] = 'gzip';
    const body = gzip ? f.gz : f.data;
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}).listen(PORT, () => console.log(`Pairwise running at http://localhost:${PORT}`));
