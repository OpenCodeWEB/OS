#!/usr/bin/env julia
# globe.jl — Haversine distance in Julia (converted from TypeScript globe math)
#
# Run: julia tools/globe.jl

const EARTH_RADIUS_KM = 6371.0
const DEG_TO_RAD = π / 180.0

function haversine_km(lat1, lng1, lat2, lng2)
    dlat = (lat2 - lat1) * DEG_TO_RAD
    dlng = (lng2 - lng1) * DEG_TO_RAD
    sin_dlat = sin(dlat / 2)
    sin_dlng = sin(dlng / 2)
    cos_lat1 = cos(lat1 * DEG_TO_RAD)
    cos_lat2 = cos(lat2 * DEG_TO_RAD)
    h = sin_dlat^2 + cos_lat1 * cos_lat2 * sin_dlng^2
    2 * EARTH_RADIUS_KM * asin(sqrt(h))
end

# Great-circle midpoint — converted from Rust rswasm-globe-physics
function great_circle_midpoint(lat1, lng1, lat2, lng2, t=0.5)
    x1 = cos(lat1 * DEG_TO_RAD) * cos(lng1 * DEG_TO_RAD)
    y1 = sin(lat1 * DEG_TO_RAD)
    z1 = cos(lat1 * DEG_TO_RAD) * sin(lng1 * DEG_TO_RAD)
    x2 = cos(lat2 * DEG_TO_RAD) * cos(lng2 * DEG_TO_RAD)
    y2 = sin(lat2 * DEG_TO_RAD)
    z2 = cos(lat2 * DEG_TO_RAD) * sin(lng2 * DEG_TO_RAD)
    dot = x1*x2 + y1*y2 + z1*z2
    angle = acos(clamp(dot, -1, 1))
    if angle < 1e-12
        return (lat1, lng1)
    end
    sin_angle = sin(angle)
    scale_a = sin((1-t) * angle) / sin_angle
    scale_b = sin(t * angle) / sin_angle
    mx = x1*scale_a + x2*scale_b
    my = y1*scale_a + y2*scale_b
    mz = z1*scale_a + z2*scale_b
    mlat = rad2deg(asin(clamp(my, -1, 1)))
    mlng = rad2deg(atan(mx, mz))
    (mlat, mlng)
end

# ─── Main ─────────────────────────────────────────────

dist = haversine_km(37.77, -122.42, 40.71, -74.01)
ratio = dist / 4120.0
println("Julia: SF → NYC = $(round(Int, dist)) km")
println(ratio > 0.95 && ratio < 1.05 ? "✅ Haversine test PASSED" : "❌ Haversine test FAILED")

mlat, mlng = great_circle_midpoint(37.77, -122.42, 40.71, -74.01)
println("Midpoint: ($(round(mlat, digits=2)), $(round(mlng, digits=2)))")
println("Polyglot status: Julia #34 in OpenCodeABs/UX")
