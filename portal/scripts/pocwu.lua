-- ─── pocwu.lua — Project build configuration script ──────────────────────
--
-- Provides build automation functions that can be used standalone or
-- integrated with the Makefile / shell pipeline.
--
-- Usage:
--   lua scripts/pocwu.lua build
--   lua scripts/pocwu.lua check
--   lua scripts/pocwu.lua count
--
-- ──────────────────────────────────────────────────────────────────────────

local M = {}

-- ─── Configuration ─────────────────────────────────────────────────────────

M.config = {
    project_name = "OpenCodeABs/UX",
    version = "0.1.0",
    src_dir = "src",
    dist_dir = "dist",
    langs = {
        "TypeScript", "JavaScript", "CSS", "JSON", "HTML",
        "Rust", "Python", "Go", "C", "GLSL", "Lua", "Ruby",
        "Zig", "Kotlin", "Nim", "Shell", "SQL", "TOML",
        "PowerShell", "YAML", "Dockerfile", "Makefile"
    }
}

-- ─── File Helpers ─────────────────────────────────────────────────────────

local function file_exists(path)
    local f = io.open(path, "r")
    if f then
        f:close()
        return true
    end
    return false
end

local function read_file(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local content = f:read("*all")
    f:close()
    return content
end

-- ─── Build Check ──────────────────────────────────────────────────────────

function M.check()
    print("🔍 " .. M.config.project_name .. " — Build Check")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    local checks = {
        {"wrangler.toml", "Wrangler config"},
        {"package.json", "Node.js project"},
        {"tsconfig.json", "TypeScript config"},
        {"Makefile", "Build automation"},
        {"Dockerfile", "Container build"},
        {"deploy.ps1", "PowerShell deploy"},
        {"scripts/deploy.sh", "Bash deploy"},
        {"scripts/generate_cities.py", "Python generator"},
        {"native/globe_math.h", "C math header"},
        {"native/globe_math.c", "C math impl"},
        {"rswasm-globe-physics/Cargo.toml", "Rust project"},
        {"rswasm-globe-physics/src/lib.rs", "Rust impl"},
        {"cmd/pocwu/main.go", "Go CLI"},
        {"shaders/globe.vert", "GLSL vertex"},
        {"shaders/globe.frag", "GLSL fragment"},
    }

    local passed, failed = 0, 0
    for _, check in ipairs(checks) do
        local path, label = check[1], check[2]
        if file_exists(path) then
            print("  ✅ " .. label .. " (" .. path .. ")")
            passed = passed + 1
        else
            print("  ❌ " .. label .. " (" .. path .. " — MISSING)")
            failed = failed + 1
        end
    end

    print("")
    print("Result: " .. passed .. " passed, " .. failed .. " failed")
    return failed == 0
end

-- ─── Language File Count ──────────────────────────────────────────────────

function M.count()
    print("📊 Language File Count")
    print("━━━━━━━━━━━━━━━━━━━━━")

    local patterns = {
        TypeScript = {".ts", ".tsx"},
        JavaScript = {".js"},
        CSS = {".css"},
        JSON = {".json"},
        HTML = {".html"},
        Rust = {".rs"},
        Python = {".py"},
        Go = {".go"},
        C = {".c", ".h"},
        GLSL = {".vert", ".frag"},
        Lua = {".lua"},
        Ruby = {".rb"},
        Zig = {".zig"},
        Kotlin = {".kt", ".kts"},
        Nim = {".nim"},
        Shell = {".sh"},
        SQL = {".sql"},
        TOML = {".toml"},
        PowerShell = {".ps1"},
        YAML = {".yml", ".yaml"},
        Dockerfile = {"Dockerfile"},
        Makefile = {"Makefile", ".mk"},
    }

    -- Use a simple recursive directory walk
    local function count_files(dir, exts)
        local count = 0
        local handle = io.popen('dir /s /b "' .. dir .. '" 2>nul')
        if not handle then return 0 end
        local result = handle:read("*all")
        handle:close()

        for line in result:gmatch("[^\r\n]+") do
            for _, ext in ipairs(exts) do
                if line:sub(-#ext) == ext then
                    count = count + 1
                    break
                end
            end
        end
        return count
    end

    local total = 0
    for name, exts in pairs(patterns) do
        local c = count_files(".", exts)
        if c > 0 then
            print(string.format("  %-15s %d files", name, c))
            total = total + c
        end
    end
    print("  ─────────────────────")
    print(string.format("  %-15s %d files", "TOTAL", total))
    return total
end

-- ─── Build (delegate to npm) ──────────────────────────────────────────────

function M.build()
    print("🔨 Building frontend...")
    local result = os.execute("npm run build")
    if result then
        print("✅ Build complete")
    else
        print("❌ Build failed")
    end
    return result
end

-- ─── Main ─────────────────────────────────────────────────────────────────

local commands = {
    check = M.check,
    count = M.count,
    build = M.build,
}

local cmd = arg and arg[1]
if cmd and commands[cmd] then
    local ok = commands[cmd]()
    if ok == false then
        os.exit(1)
    end
else
    print("pocwu.lua — OpenCodeABs/UX build config")
    print("")
    print("Usage: lua scripts/pocwu.lua <command>")
    print("")
    print("Commands:")
    print("  check    Verify all project files exist")
    print("  count    Count files by language")
    print("  build    Build the frontend")
end

return M
