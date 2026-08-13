#!/usr/bin/env dotnet fsi
(* globe.fsx — Haversine distance in F# (converted from TypeScript globe math)
 *
 * Run: dotnet fsi tools/globe.fsx
 *)

let earthRadiusKm = 6371.0
let degToRad = System.Math.PI / 180.0

let haversineKm (lat1: float) (lng1: float) (lat2: float) (lng2: float) : float =
    let dlat = (lat2 - lat1) * degToRad
    let dlng = (lng2 - lng1) * degToRad
    let sinDlat = sin (dlat / 2.0)
    let sinDlng = sin (dlng / 2.0)
    let cosLat1 = cos (lat1 * degToRad)
    let cosLat2 = cos (lat2 * degToRad)
    let h = sinDlat * sinDlat + cosLat1 * cosLat2 * sinDlng * sinDlng
    2.0 * earthRadiusKm * asin (sqrt h)

/// List files in a directory (converted from TypeScript prd-orchestrator.ts)
let listFiles dir pattern =
    if System.IO.Directory.Exists dir then
        System.IO.Directory.GetFiles(dir, pattern)
        |> Array.map System.IO.Path.GetFileName
        |> Array.toList
    else []

(* ─── Main ──────────────────────────────────────────────── *)
let dist = haversineKm 37.77 -122.42 40.71 -74.01
let ratio = dist / 4120.0
printfn "F#: SF → NYC = %.0f km" dist
printfn "%s" (if ratio > 0.95 && ratio < 1.05 then "✅ Haversine test PASSED" else "❌ Haversine test FAILED")
let prdFiles = listFiles "OpenCodeWEBsPRD" "*.md"
printfn "PRD files: %d" (List.length prdFiles)
printfn "Polyglot status: F# #29 in OpenCodeABs/UX"
