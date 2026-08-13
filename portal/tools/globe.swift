#!/usr/bin/env swift
/// globe.swift — Haversine distance in Swift (converted from TypeScript globe math)
///
/// Run: swift tools/globe.swift

import Foundation

let earthRadiusKm: Double = 6371.0
let degToRad: Double = .pi / 180.0

func haversineKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double) -> Double {
    let dlat = (lat2 - lat1) * degToRad
    let dlng = (lng2 - lng1) * degToRad
    let sinDlat = sin(dlat / 2)
    let sinDlng = sin(dlng / 2)
    let cosLat1 = cos(lat1 * degToRad)
    let cosLat2 = cos(lat2 * degToRad)

    let h = sinDlat * sinDlat + cosLat1 * cosLat2 * sinDlng * sinDlng
    return 2.0 * earthRadiusKm * asin(sqrt(h))
}

func validateProjectRoot(path: String) -> Bool {
    let fm = FileManager.default
    var isDir: ObjCBool = false
    return fm.fileExists(atPath: path, isDirectory: &isDir) && isDir.boolValue
}

// ─── Main ────────────────────────────────────────────

let dist = haversineKm(lat1: 37.77, lng1: -122.42, lat2: 40.71, lng2: -74.01)
let ratio = dist / 4120.0
print("Swift: SF → NYC = \(String(format: "%.0f", dist)) km")
print(ratio > 0.95 && ratio < 1.05 ? "✅ Haversine test PASSED" : "❌ Haversine test FAILED")
print("Polyglot status: Swift #24 in OpenCodeABs/UX")
