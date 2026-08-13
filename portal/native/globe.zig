// ─── globe.zig — Zig implementation of globe math utilities ──────────────
//
// Zig version of the globe physics library, compilable to native code
// or WASM via Zig's built-in wasm target.
//
// Build:
//   zig build-exe native/globe.zig -O ReleaseSmall -femit-bin=globe.exe
//   zig build-lib native/globe.zig -O ReleaseSmall -target wasm32-freestanding
//
// ──────────────────────────────────────────────────────────────────────────

const std = @import("std");
const math = std.math;
const testing = std.testing;

// ─── Constants ─────────────────────────────────────────────────────────────

pub const EARTH_RADIUS_KM: f64 = 6371.0;
pub const DEG_TO_RAD: f64 = math.pi / 180.0;
pub const RAD_TO_DEG: f64 = 180.0 / math.pi;

// ─── Types ─────────────────────────────────────────────────────────────────

pub const GeoCoord = struct {
    lat: f64,
    lng: f64,
};

pub const Vec3 = struct {
    x: f64,
    y: f64,
    z: f64,
};

// ─── Helpers ───────────────────────────────────────────────────────────────

inline fn toRadians(deg: f64) f64 {
    return deg * DEG_TO_RAD;
}

inline fn toDegrees(rad: f64) f64 {
    return rad * RAD_TO_DEG;
}

inline fn clamp(v: f64) f64 {
    return if (v < -1.0) -1.0 else if (v > 1.0) 1.0 else v;
}

// ─── Core Functions ────────────────────────────────────────────────────────

/// Haversine great-circle distance in kilometers.
pub fn haversineKm(a: GeoCoord, b: GeoCoord) f64 {
    const dlat = toRadians(b.lat - a.lat);
    const dlng = toRadians(b.lng - a.lng);
    const sin_dlat = @sin(dlat * 0.5);
    const sin_dlng = @sin(dlng * 0.5);
    const cos_lat1 = @cos(toRadians(a.lat));
    const cos_lat2 = @cos(toRadians(b.lat));

    const h = sin_dlat * sin_dlat + cos_lat1 * cos_lat2 * sin_dlng * sin_dlng;
    return 2.0 * EARTH_RADIUS_KM * math.asin(@sqrt(h));
}

/// Convert lat/lng to unit sphere vector.
pub fn geoToVec3(coord: GeoCoord) Vec3 {
    const lat = toRadians(coord.lat);
    const lng = toRadians(coord.lng);
    const cos_lat = @cos(lat);
    return Vec3{
        .x = cos_lat * @cos(lng),
        .y = @sin(lat),
        .z = cos_lat * @sin(lng),
    };
}

/// Convert unit sphere vector to lat/lng.
pub fn vec3ToGeo(v: Vec3) GeoCoord {
    return GeoCoord{
        .lat = toDegrees(math.asin(clamp(v.y))),
        .lng = toDegrees(math.atan2(f64, v.x, v.z)),
    };
}

/// Great-circle interpolation at fraction t (0.0 = a, 1.0 = b).
pub fn greatCircleInterp(a: GeoCoord, b: GeoCoord, t: f64) GeoCoord {
    const va = geoToVec3(a);
    const vb = geoToVec3(b);

    const dot = va.x * vb.x + va.y * vb.y + va.z * vb.z;
    const angle = math.acos(clamp(dot));

    if (angle < 1e-12) return a;

    const sin_angle = @sin(angle);
    const scale_a = @sin((1.0 - t) * angle) / sin_angle;
    const scale_b = @sin(t * angle) / sin_angle;

    return vec3ToGeo(Vec3{
        .x = va.x * scale_a + vb.x * scale_b,
        .y = va.y * scale_a + vb.y * scale_b,
        .z = va.z * scale_a + vb.z * scale_b,
    });
}

/// Rotate a vector around the Y axis.
pub fn rotateY(v: Vec3, angle_rad: f64) Vec3 {
    const c = @cos(angle_rad);
    const s = @sin(angle_rad);
    return Vec3{
        .x = v.x * c + v.z * s,
        .y = v.y,
        .z = -v.x * s + v.z * c,
    };
}

/// Rotate a vector around the X axis.
pub fn rotateX(v: Vec3, angle_rad: f64) Vec3 {
    const c = @cos(angle_rad);
    const s = @sin(angle_rad);
    return Vec3{
        .x = v.x,
        .y = v.y * c - v.z * s,
        .z = v.y * s + v.z * c,
    };
}

// ─── CLI Entry Point ───────────────────────────────────────────────────────

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();

    try stdout.print("globe.zig — Globe Math Utility\n", .{});
    try stdout.print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n", .{});

    // SF → NYC
    const sf = GeoCoord{ .lat = 37.77, .lng = -122.42 };
    const nyc = GeoCoord{ .lat = 40.71, .lng = -74.01 };
    const dist = haversineKm(sf, nyc);
    try stdout.print("SF → NYC: {d:.0} km\n", .{dist});

    // Midpoint
    const mid = greatCircleInterp(sf, nyc, 0.5);
    try stdout.print("Midpoint: ({d:.2}, {d:.2})\n", .{mid.lat, mid.lng});

    // Rotation test
    const v = Vec3{ .x = 1.0, .y = 0.0, .z = 0.0 };
    const r = rotateY(v, math.pi / 2.0);
    try stdout.print("Rotate (1,0,0) by 90°Y: ({d:.2}, {d:.2}, {d:.2})\n", .{r.x, r.y, r.z});
}

// ─── Tests ─────────────────────────────────────────────────────────────────

test "haversine SF to NYC" {
    const sf = GeoCoord{ .lat = 37.77, .lng = -122.42 };
    const nyc = GeoCoord{ .lat = 40.71, .lng = -74.01 };
    const dist = haversineKm(sf, nyc);
    try testing.expectApproxEqAbs(dist, 4120.0, 200.0);
}

test "vec3 roundtrip" {
    const coord = GeoCoord{ .lat = 51.5, .lng = -0.12 };
    const v = geoToVec3(coord);
    const back = vec3ToGeo(v);
    try testing.expectApproxEqAbs(coord.lat, back.lat, 0.001);
    try testing.expectApproxEqAbs(coord.lng, back.lng, 0.001);
}

test "great circle midpoint" {
    const a = GeoCoord{ .lat = 0.0, .lng = 0.0 };
    const b = GeoCoord{ .lat = 0.0, .lng = 90.0 };
    const mid = greatCircleInterp(a, b, 0.5);
    try testing.expect(@abs(mid.lat) < 1.0);
    try testing.expect(@abs(mid.lng - 45.0) < 1.0);
}

test "rotation Y 90 degrees" {
    const v = Vec3{ .x = 1.0, .y = 0.0, .z = 0.0 };
    const r = rotateY(v, math.pi / 2.0);
    try testing.expect(@abs(r.x) < 1e-10);
    try testing.expect(@abs(r.z + 1.0) < 1e-10);
}
