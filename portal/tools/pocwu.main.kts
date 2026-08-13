#!/usr/bin/env kotlin
/*
 * ─── pocwu.main.kts — Kotlin build utility script ─────────────────────
 *
 * A Kotlin script that validates the project structure and reports
 * language diversity statistics. Run with the Kotlin script runtime:
 *
 *   kotlin tools/pocwu.main.kts
 *
 * ──────────────────────────────────────────────────────────────────────
 */

import java.io.File

data class LanguageEntry(
    val name: String,
    val extensions: List<String>,
    val count: Int
)

fun countFiles(root: File, exts: List<String>): Int {
    return root.walkTopDown()
        .filter { it.isFile }
        .count { file ->
            exts.any { ext -> file.name.endsWith(ext) }
        }
}

fun main() {
    val root = File("..").normalize()  // project root (from tools/)
    val excludedDirs = listOf("node_modules", "dist", "target", ".git")

    println("═══════════════════════════════════════════")
    println("  OpenCodeABs/UX — Kotlin Build Utility")
    println("═══════════════════════════════════════════")
    println()

    val languages = listOf(
        LanguageEntry("TypeScript",     listOf(".ts", ".tsx"), 0),
        LanguageEntry("JavaScript",     listOf(".js"),         0),
        LanguageEntry("CSS",            listOf(".css"),        0),
        LanguageEntry("JSON",           listOf(".json"),       0),
        LanguageEntry("HTML",           listOf(".html"),       0),
        LanguageEntry("Rust",           listOf(".rs"),         0),
        LanguageEntry("Python",         listOf(".py"),         0),
        LanguageEntry("Go",             listOf(".go"),         0),
        LanguageEntry("C",              listOf(".c", ".h"),    0),
        LanguageEntry("GLSL",           listOf(".vert", ".frag"), 0),
        LanguageEntry("Lua",            listOf(".lua"),        0),
        LanguageEntry("Ruby",           listOf(".rb"),         0),
        LanguageEntry("Zig",            listOf(".zig"),        0),
        LanguageEntry("Kotlin",         listOf(".kt", ".kts"), 0),
        LanguageEntry("Nim",            listOf(".nim"),        0),
        LanguageEntry("Shell",          listOf(".sh"),         0),
        LanguageEntry("SQL",            listOf(".sql"),        0),
        LanguageEntry("TOML",           listOf(".toml"),       0),
        LanguageEntry("PowerShell",     listOf(".ps1"),        0),
        LanguageEntry("YAML",           listOf(".yml", ".yaml"), 0),
        LanguageEntry("Dockerfile",     listOf("Dockerfile"),  0),
        LanguageEntry("Makefile",       listOf("Makefile", ".mk"), 0),
    )

    var total = 0
    var maxNameLen = languages.maxOf { it.name.length }

    val counted = languages.map { lang ->
        val count = countFiles(root, lang.extensions)
        total += count
        lang.copy(count = count)
    }

    for (lang in counted) {
        val padded = lang.name.padEnd(maxNameLen)
        println("  $padded  ${lang.count.toString().padStart(4)} files")
    }
    println("  ${"─".repeat(maxNameLen)}  ─────")
    println("  ${"TOTAL".padEnd(maxNameLen)}  ${total.toString().padStart(4)} files")
    println()

    // File existence check
    val essentialFiles = listOf(
        "tsconfig.json",
        "package.json",
        "wrangler.toml",
        "Makefile",
        "Dockerfile",
        "deploy.ps1",
        "scripts/deploy.sh",
        "scripts/generate_cities.py",
        "native/globe_math.h",
        "native/globe_math.c",
        "native/globe.zig",
        "rswasm-globe-physics/Cargo.toml",
        "cmd/pocwu/main.go",
        "shaders/globe.vert",
        "shaders/globe.frag",
        "tools/pocwu.main.kts",
    )

    println("📋 Essential files:")
    println()
    var allPresent = true
    for (file in essentialFiles) {
        val f = File(root, file)
        if (f.exists()) {
            println("  ✅ $file")
        } else {
            println("  ❌ $file — MISSING")
            allPresent = false
        }
    }

    println()
    if (allPresent) {
        println("✅ All essential files present — polyglot check passed!")
    } else {
        println("⚠️  Some essential files are missing")
    }
}

main()
