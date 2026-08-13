// ─── cmd/pocwu — OpenCodeABs/UX CLI Tool ──────────────────────────────────
//
// A Go CLI tool for project management tasks:
//   pocwu build       build the frontend
//   pocwu deploy      deploy to Cloudflare Pages
//   pocwu status      show project deployment status
//   pocwu wasm        compile Rust WASM module
//
// Build:
//   cd cmd/pocwu && go build -o pocwu.exe
//
// ──────────────────────────────────────────────────────────────────────────

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

const version = "0.1.0"

// ─── Subcommands ──────────────────────────────────────────────────────────

type subcommand struct {
	name        string
	description string
	run         func(args []string) error
}

// ─── Helpers ──────────────────────────────────────────────────────────────

func runCommand(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func checkDir(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("directory not found: %s", path)
	}
	if !info.IsDir() {
		return fmt.Errorf("not a directory: %s", path)
	}
	return nil
}

// ─── Build Command ────────────────────────────────────────────────────────

func cmdBuild(args []string) error {
	fmt.Println("🔨 Building frontend...")

	// Run npm ci and npm run build
	if err := runCommand("npm", "ci"); err != nil {
		return fmt.Errorf("npm ci failed: %w", err)
	}
	if err := runCommand("npm", "run", "build"); err != nil {
		return fmt.Errorf("npm run build failed: %w", err)
	}

	fmt.Println("✅ Build complete (dist/)")
	return nil
}

// ─── Deploy Command ───────────────────────────────────────────────────────

func cmdDeploy(args []string) error {
	preview := false
	for _, a := range args {
		if a == "--preview" || a == "-p" {
			preview = true
		}
	}

	fmt.Println("🚀 Deploying to", map[bool]string{true: "preview", false: "production"}[preview], "...")

	wranglerArgs := []string{"pages", "deploy", "--branch=main", "--skip-caching", "dist"}
	if err := runCommand("npx", wranglerArgs...); err != nil {
		return fmt.Errorf("deploy failed: %w", err)
	}

	fmt.Println("✅ Deploy complete")
	if !preview {
		fmt.Println("   Production: https://pocwu.pages.dev")
	}
	return nil
}

// ─── Status Command ───────────────────────────────────────────────────────

func cmdStatus(args []string) error {
	fmt.Println("📊 OpenCodeABs/UX — Status")
	fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━")

	// Check project directories
	dirs := []string{"src", "functions", "do-worker", "rswasm-globe-physics", "native", "scripts", "shaders"}
	fmt.Println("\n📁 Project structure:")
	for _, d := range dirs {
		err := checkDir(d)
		if err == nil {
			fmt.Printf("  ✅ %s/\n", d)
		} else {
			fmt.Printf("  ⚠️  %s: %v\n", d, err)
		}
	}

	// Check wrangler config
	fmt.Println("\n⚙️  Config:")
	if _, err := os.Stat("wrangler.toml"); err == nil {
		fmt.Println("  ✅ wrangler.toml")
	} else {
		fmt.Println("  ⚠️  wrangler.toml missing")
	}

	// Version info
	fmt.Printf("\nℹ️  pocwu CLI v%s\n", version)
	fmt.Printf("   Go: %s\n", strings.TrimPrefix(runAndCapture("go", "version"), "go version "))

	return nil
}

func runAndCapture(name string, args ...string) string {
	cmd := exec.Command(name, args...)
	out, err := cmd.Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(out))
}

// ─── WASM Command ─────────────────────────────────────────────────────────

func cmdWasm(args []string) error {
	fmt.Println("🦀 Building Rust WASM module...")

	cargoArgs := []string{"build", "--release"}
	if err := runCommand("cargo", cargoArgs...); err != nil {
		return fmt.Errorf("cargo build failed: %w", err)
	}

	fmt.Println("✅ Rust WASM build complete")
	return nil
}

// ─── JSON Command (utility) ───────────────────────────────────────────────

func cmdJSON(args []string) error {
	fmt.Println("📋 JSON Project Summary")
	fmt.Println("{")

	// Count files by language
	langs := map[string]string{
		"TypeScript": "*.ts,*.tsx",
		"JavaScript": "*.js",
		"CSS":        "*.css",
		"JSON":       "*.json",
		"Rust":       "*.rs",
		"Python":     "*.py",
		"Go":         "*.go",
		"C":          "*.c,*.h",
		"Shell":      "*.sh",
		"GLSL":       "*.vert,*.frag",
	}

	first := true
	for lang, patterns := range langs {
		if !first {
			fmt.Println(",")
		}
		first = false
		count := countFiles(patterns)
		fmt.Printf("  %q: %d", lang, count)
	}
	fmt.Println()
	fmt.Println("}")
	return nil
}

func countFiles(patterns string) int {
	// Simple count using PowerShell on Windows
	cmd := exec.Command("powershell", "-Command",
		fmt.Sprintf("(Get-ChildItem -Recurse -File -Include %s -Exclude 'node_modules','dist','target' | Measure-Object).Count", patterns))
	out, err := cmd.Output()
	if err != nil {
		return 0
	}
	var count int
	fmt.Sscanf(strings.TrimSpace(string(out)), "%d", &count)
	return count
}

// ─── Main ─────────────────────────────────────────────────────────────────

func main() {
	commands := []subcommand{
		{"build", "Build the frontend (npm ci + npm run build)", cmdBuild},
		{"deploy", "Deploy to Cloudflare Pages (use --preview for preview)", cmdDeploy},
		{"status", "Show project status and directory structure", cmdStatus},
		{"wasm", "Build Rust WASM globe physics module", cmdWasm},
		{"json", "Output JSON summary of language file counts", cmdJSON},
		{"help", "Show this help message", func(args []string) error {
			printHelp(commands)
			return nil
		}},
	}

	if len(os.Args) < 2 {
		printHelp(commands)
		os.Exit(0)
	}

	commandName := os.Args[1]
	var commandArgs []string
	if len(os.Args) > 2 {
		commandArgs = os.Args[2:]
	}

	for _, cmd := range commands {
		if cmd.name == commandName {
			if err := cmd.run(commandArgs); err != nil {
				fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
				os.Exit(1)
			}
			return
		}
	}

	fmt.Fprintf(os.Stderr, "❌ Unknown command: %s\n", commandName)
	printHelp(commands)
	os.Exit(1)
}

func printHelp(commands []subcommand) {
	fmt.Printf("pocwu v%s — OpenCodeABs/UX CLI\n\n", version)
	fmt.Println("Usage: pocwu <command> [args]")
	fmt.Println()
	fmt.Println("Commands:")
	for _, cmd := range commands {
		fmt.Printf("  %-10s %s\n", cmd.name, cmd.description)
	}
}
