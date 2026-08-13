# ─── pocwu.nim — Nim utility for project maintenance ─────────────────────
#
# Provides project health checks, file counting, and orchestration.
#
# Build & Run:
#   nim compile --run tools/pocwu.nim
#
# ──────────────────────────────────────────────────────────────────────────

import std/[os, strformat, strutils, times]

# ─── Types ──────────────────────────────────────────────────────────────

type
  LangInfo = object
    name: string
    exts: seq[string]
    count: int

  FileCheck = object
    path: string
    label: string

# ─── Helpers ────────────────────────────────────────────────────────────

proc countFiles(root: string, exts: seq[string]): int =
  for (path, dirs, files) in walkDir(root):
    if dirs.len > 0:
      for d in dirs:
        let full = path / d
        if d notin ["node_modules", "dist", "target", ".git"]:
          result += countFiles(full, exts)
    for f in files:
      let (_, name, ext) = splitFile(f)
      if ext in exts or name in exts:
        result += 1

proc formatCount(n: int): string =
  ($n).align(4)

# ─── Main ──────────────────────────────────────────────────────────────

proc main() =
  let root = getCurrentDir()
  let now = now()
  echo ""
  echo "═══════════════════════════════════════════════"
  echo "  OpenCodeABs/UX — Nim Project Utility"
  echo &"  {now.format(\"yyyy-MM-dd HH:mm:ss\")}"
  echo "═══════════════════════════════════════════════"
  echo ""

  # ─── Language counts ────────────────────────────────

  var langs = @[
    LangInfo(name: "TypeScript",   exts: @[".ts", ".tsx"]),
    LangInfo(name: "JavaScript",   exts: @[".js"]),
    LangInfo(name: "CSS",          exts: @[".css"]),
    LangInfo(name: "JSON",         exts: @[".json"]),
    LangInfo(name: "HTML",         exts: @[".html"]),
    LangInfo(name: "Rust",         exts: @[".rs"]),
    LangInfo(name: "Python",       exts: @[".py"]),
    LangInfo(name: "Go",           exts: @[".go"]),
    LangInfo(name: "C",            exts: @[".c", ".h"]),
    LangInfo(name: "GLSL",         exts: @[".vert", ".frag"]),
    LangInfo(name: "Lua",          exts: @[".lua"]),
    LangInfo(name: "Ruby",         exts: @[".rb"]),
    LangInfo(name: "Zig",          exts: @[".zig"]),
    LangInfo(name: "Kotlin",       exts: @[".kt", ".kts"]),
    LangInfo(name: "Nim",          exts: @[".nim"]),
    LangInfo(name: "Shell",        exts: @[".sh"]),
    LangInfo(name: "SQL",          exts: @[".sql"]),
    LangInfo(name: "TOML",         exts: @[".toml"]),
    LangInfo(name: "PowerShell",   exts: @[".ps1"]),
    LangInfo(name: "YAML",         exts: @[".yml", ".yaml"]),
    LangInfo(name: "Dockerfile",   exts: @["Dockerfile"]),
    LangInfo(name: "Makefile",     exts: @["Makefile", ".mk"]),
  ]

  var total = 0
  let maxNameLen = 15

  echo &"  {'Language'.align(maxNameLen)}  Files"
  echo &"  {'────────'.align(maxNameLen)}  ─────"
  for lang in langs.mitems:
    lang.count = countFiles(root, lang.exts)
    total += lang.count
    echo &"  {lang.name.align(maxNameLen)}  {lang.count.formatCount}"
  echo &"  {'────────'.align(maxNameLen)}  ─────"
  echo &"  {'TOTAL'.align(maxNameLen)}  {total.formatCount}"
  echo ""

  # ─── File checks ──────────────────────────────────

  let checks = @[
    FileCheck(path: "Makefile", label: "Build automation"),
    FileCheck(path: "Dockerfile", label: "Container build"),
    FileCheck(path: "package.json", label: "Node.js project"),
    FileCheck(path: "tsconfig.json", label: "TypeScript config"),
    FileCheck(path: "wrangler.toml", label: "Wrangler config"),
    FileCheck(path: "deploy.ps1", label: "PowerShell deploy"),
    FileCheck(path: "scripts/deploy.sh", label: "Bash deploy"),
    FileCheck(path: "scripts/generate_cities.py", label: "Python generator"),
    FileCheck(path: "scripts/pocwu.lua", label: "Lua config"),
    FileCheck(path: "scripts/preview.rb", label: "Ruby preview"),
    FileCheck(path: "native/globe_math.h", label: "C math header"),
    FileCheck(path: "native/globe_math.c", label: "C math impl"),
    FileCheck(path: "native/globe.zig", label: "Zig math module"),
    FileCheck(path: "rswasm-globe-physics/Cargo.toml", label: "Rust project"),
    FileCheck(path: "cmd/pocwu/main.go", label: "Go CLI"),
    FileCheck(path: "shaders/globe.vert", label: "GLSL vertex shader"),
    FileCheck(path: "shaders/globe.frag", label: "GLSL fragment shader"),
    FileCheck(path: "tools/pocwu.main.kts", label: "Kotlin script"),
    FileCheck(path: "tools/pocwu.nim", label: "Nim utility"),
    FileCheck(path: "schema.sql", label: "SQL schema"),
  ]

  echo "📋 File existence checks:"
  echo ""
  var allGood = true
  for check in checks:
    if fileExists(check.path):
      echo &"  ✅ {check.label} ({check.path})"
    else:
      echo &"  ❌ {check.label} ({check.path} — MISSING)"
      allGood = false

  echo ""
  if allGood:
    echo "✅ All files present — polyglot architecture healthy!"
  else:
    echo "⚠️  Some files missing — run 'make polyglot' for details"

  echo ""

when isMainModule:
  main()
