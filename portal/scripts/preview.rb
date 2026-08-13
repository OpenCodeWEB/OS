#!/usr/bin/env ruby
# frozen_string_literal: true

# ─── preview.rb — Lightweight preview server for OpenCodeABs/UX ─────────
#
# Serves the dist/ directory on a local port with CORS headers,
# useful for testing the production build before deploying.
#
# Usage:
#   ruby scripts/preview.rb              # serve on port 8788
#   ruby scripts/preview.rb -p 3000      # custom port
#   ruby scripts/preview.rb -o 0.0.0.0   # bind all interfaces
#
# Dependencies: none (stdlib only — WEBrick)
# ──────────────────────────────────────────────────────────────────────────

require 'webrick'
require 'json'
require 'fileutils'

# ─── Config ──────────────────────────────────────────────────────────────

PORT = (ENV['PORT'] || 8788).to_i
BIND = ENV['BIND'] || '127.0.0.1'
ROOT = File.expand_path('..', __dir__)
DIST = File.join(ROOT, 'dist')
MIME_TYPES = {
  '.js'     => 'application/javascript',
  '.css'    => 'text/css',
  '.html'   => 'text/html',
  '.json'   => 'application/json',
  '.png'    => 'image/png',
  '.svg'    => 'image/svg+xml',
  '.wasm'   => 'application/wasm',
}.freeze

# ─── Logging ────────────────────────────────────────────────────────────

def log(level, msg)
  timestamp = Time.now.strftime('%H:%M:%S')
  puts "[#{timestamp}] [#{level}] #{msg}"
end

# ─── Server ─────────────────────────────────────────────────────────────

def create_server(port, bind)
  unless Dir.exist?(DIST)
    log('ERROR', "Build directory not found: #{DIST}")
    log('INFO', 'Run "npm run build" or "make build" first')
    exit 1
  end

  log('INFO', "Starting preview server...")
  log('INFO', "  Root: #{DIST}")
  log('INFO', "  URL:  http://#{bind}:#{port}")
  log('INFO', "  Press Ctrl+C to stop")

  server = WEBrick::HTTPServer.new(
    Port: port,
    BindAddress: bind,
    DocumentRoot: DIST,
    Logger: WEBrick::Log.new($stdout, WEBrick::Log::INFO),
    AccessLog: [[File.open(File::NULL, 'w'), WEBrick::AccessLog::COMMON_LOG_FORMAT]],
  )

  # CORS headers on every response
  server.config[:MimeTypes] = WEBrick::HTTPUtils::DefaultMimeTypes.merge(MIME_TYPES)

  server.mount_proc '/' do |req, res|
    path = req.path == '/' ? '/index.html' : req.path
    file = File.join(DIST, path)

    if File.exist?(file) && !File.directory?(file)
      ext = File.extname(file)
      res['Content-Type'] = MIME_TYPES[ext] || 'application/octet-stream'
      res['Access-Control-Allow-Origin'] = '*'
      res['Cache-Control'] = 'no-cache'
      res.body = File.read(file, mode: 'rb')
    else
      # SPA fallback to index.html
      fallback = File.join(DIST, 'index.html')
      if File.exist?(fallback)
        res['Content-Type'] = 'text/html'
        res.body = File.read(fallback, mode: 'rb')
      else
        res.status = 404
        res.body = "404 Not Found: #{path}"
      end
    end
  end

  server
end

# ─── CLI ────────────────────────────────────────────────────────────────

def parse_args
  port = PORT
  bind = BIND

  i = 0
  while i < ARGV.length
    case ARGV[i]
    when '-p', '--port'
      port = ARGV[i + 1].to_i
      i += 2
    when '-o', '--bind'
      bind = ARGV[i + 1]
      i += 2
    when '-h', '--help'
      puts "Usage: ruby scripts/preview.rb [options]"
      puts ""
      puts "Options:"
      puts "  -p, --port PORT   Port to serve on (default: #{PORT})"
      puts "  -o, --bind ADDR   Address to bind to (default: #{BIND})"
      puts "  -h, --help        Show this help"
      exit 0
    else
      puts "Unknown option: #{ARGV[i]}"
      exit 1
    end
  end

  [port, bind]
end

# ─── Main ───────────────────────────────────────────────────────────────

begin
  port, bind = parse_args
  server = create_server(port, bind)

  trap('INT') { server.shutdown }
  trap('TERM') { server.shutdown }

  server.start
rescue => e
  log('ERROR', e.message)
  exit 1
end
