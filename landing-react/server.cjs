const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = process.env.PORT || 8090
const API_PORT = process.env.API_PORT || 8002
const DIST = path.join(__dirname, 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const isSSE = (req.headers['accept'] || '').includes('text/event-stream')

    const options = {
      hostname: 'localhost',
      port: API_PORT,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `localhost:${API_PORT}`,
      },
    }

    const proxy = http.request(options, (proxyRes) => {
      const headers = { ...proxyRes.headers }

      if (isSSE) {
        // SSE: disable buffering, keep connection alive
        headers['cache-control'] = 'no-cache'
        headers['x-accel-buffering'] = 'no'
        headers['connection'] = 'keep-alive'
        res.socket && res.socket.setNoDelay(true)
        res.socket && res.socket.setTimeout(0)
      }

      res.writeHead(proxyRes.statusCode, headers)

      proxyRes.on('data', (chunk) => {
        res.write(chunk)
        if (isSSE && res.flush) res.flush()
      })
      proxyRes.on('end', () => res.end())
      proxyRes.on('error', () => res.end())
    })

    proxy.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502)
        res.end(JSON.stringify({ error: 'Backend unavailable', detail: err.message }))
      }
    })

    // For SSE: destroy proxy when client disconnects to free resources
    if (isSSE) {
      req.on('close', () => proxy.destroy())
    }

    req.pipe(proxy, { end: true })
    return
  }

  const urlPath = req.url.split('?')[0]
  const filePath = path.join(DIST, urlPath)

  if (!filePath.startsWith(DIST)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  const ext = path.extname(filePath)
  const contentType = MIME[ext] || 'application/octet-stream'

  fs.readFile(filePath, (err, data) => {
    if (err) {
      const index = path.join(DIST, 'index.html')
      fs.readFile(index, (err2, indexData) => {
        if (err2) { res.writeHead(404); res.end('Not Found'); return }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' })
        res.end(indexData)
      })
      return
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
    })
    res.end(data)
  })
})

server.listen(PORT, () => console.log(`Gravity React web on :${PORT} | API proxy → :${API_PORT}`))
