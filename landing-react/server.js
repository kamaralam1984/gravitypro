const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = process.env.PORT || 8090
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
  let urlPath = req.url.split('?')[0]

  let filePath = path.join(DIST, urlPath)

  // Security: prevent directory traversal
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  const tryServe = (fp) => {
    const ext = path.extname(fp)
    const contentType = MIME[ext] || 'application/octet-stream'

    fs.readFile(fp, (err, data) => {
      if (err) {
        // SPA fallback: serve index.html for all unknown routes
        const index = path.join(DIST, 'index.html')
        fs.readFile(index, (err2, indexData) => {
          if (err2) {
            res.writeHead(404)
            res.end('Not Found')
            return
          }
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
          })
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
  }

  tryServe(filePath)
})

server.listen(PORT, () => console.log(`Gravity React web on :${PORT}`))
