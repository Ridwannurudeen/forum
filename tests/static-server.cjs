const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "../frontend");
const defaultPort = Number(process.env.PORT || 4173);
const host = "127.0.0.1";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function resolveRequest(url, port) {
  const pathname = new URL(url, `http://${host}:${port}`).pathname;
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = path.resolve(root, rel);
  if (!target.startsWith(root + path.sep) && target !== root) return null;
  return target;
}

function createStaticServer(port = defaultPort) {
  return http.createServer((req, res) => {
    const target = resolveRequest(req.url || "/", port);
    if (!target) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    fs.readFile(target, (err, body) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "cache-control": "no-store",
        "content-type": contentTypes[path.extname(target)] || "application/octet-stream",
      });
      res.end(body);
    });
  });
}

function startStaticServer(port = defaultPort) {
  const server = createStaticServer(port);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve({ server, url: `http://${host}:${port}` });
    });
  });
}

if (require.main === module) {
  startStaticServer()
    .then(({ server, url }) => {
      console.log(`static server listening at ${url}`);
      function shutdown() {
        server.close(() => process.exit(0));
      }

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { startStaticServer };
