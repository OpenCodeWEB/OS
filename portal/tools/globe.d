/// globe.d — Haversine distance in D (converted from TypeScript globe math)
///
/// Compile & run: rdmd tools/globe.d
module globe;

import std.math, std.stdio;

enum double earthRadiusKm = 6371.0;
enum double degToRad = PI / 180.0;

double haversineKm(double lat1, double lng1, double lat2, double lng2) pure @nogc {
    double dlat = (lat2 - lat1) * degToRad;
    double dlng = (lng2 - lng1) * degToRad;
    double sinDlat = sin(dlat / 2.0);
    double sinDlng = sin(dlng / 2.0);
    double cosLat1 = cos(lat1 * degToRad);
    double cosLat2 = cos(lat2 * degToRad);
    double h = sinDlat * sinDlat + cosLat1 * cosLat2 * sinDlng * sinDlng;
    return 2.0 * earthRadiusKm * asin(sqrt(h));
}

/// Rotate Y axis — converted from rswasm-globe-physics rotate_y
void rotateY(double x, double y, double z, double angleRad,
             ref double ox, ref double oy, ref double oz) pure {
    double c = cos(angleRad);
    double s = sin(angleRad);
    ox = x * c + z * s;
    oy = y;
    oz = -x * s + z * c;
}

void main() {
    double dist = haversineKm(37.77, -122.42, 40.71, -74.01);
    double ratio = dist / 4120.0;
    writefln("D: SF → NYC = %.0f km", dist);
    writeln(ratio > 0.95 && ratio < 1.05 ? "✅ Haversine test PASSED" : "❌ Haversine test FAILED");

    // Rotation test from TypeScript/Rust
    double ox, oy, oz;
    rotateY(1.0, 0.0, 0.0, PI / 2.0, ox, oy, oz);
    writefln("Rotate (1,0,0) by 90°Y: (%.2f, %.2f, %.2f)", ox, oy, oz);
    writeln("Polyglot status: D #35 in OpenCodeABs/UX");
}
