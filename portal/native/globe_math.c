/**
 * globe_math.c — C99 implementation of globe math library.
 *
 * Compile to WASM with Emscripten:
 *   emcc -O3 -s WASM=1 -s EXPORTED_FUNCTIONS=@native/exports.json \
 *         native/globe_math.c -o native/globe_math.wasm
 *
 * Test (native):
 *   gcc -DTEST_GLOBE_MATH native/globe_math.c -o /tmp/globe_test -lm && /tmp/globe_test
 */

#include "globe_math.h"
#include <math.h>
#include <stdio.h>

/* ─── Internal Helpers ────────────────────────────────────────────────────*/

static inline double deg_to_rad(double deg) {
    return deg * GLOBE_DEG_TO_RAD;
}

static inline double rad_to_deg(double rad) {
    return rad * GLOBE_RAD_TO_DEG;
}

/* Clamp value to [-1, 1] for safe acos/asin */
static inline double clamp(double v) {
    return v < -1.0 ? -1.0 : (v > 1.0 ? 1.0 : v);
}

/* ─── API Implementation ──────────────────────────────────────────────────*/

double globe_haversine_km(double lat1, double lng1, double lat2, double lng2) {
    double dlat = deg_to_rad(lat2 - lat1);
    double dlng = deg_to_rad(lng2 - lng1);
    double sin_dlat = sin(dlat * 0.5);
    double sin_dlng = sin(dlng * 0.5);
    double cos_lat1 = cos(deg_to_rad(lat1));
    double cos_lat2 = cos(deg_to_rad(lat2));

    double h = sin_dlat * sin_dlat
             + cos_lat1 * cos_lat2 * sin_dlng * sin_dlng;
    return 2.0 * GLOBE_EARTH_RADIUS_KM * asin(sqrt(h));
}

void globe_great_circle_interp(
    double lat1, double lng1,
    double lat2, double lng2,
    double t,
    double *out_lat, double *out_lng
) {
    double x1, y1, z1, x2, y2, z2;

    // Convert to 3D
    globe_geo_to_vec3(lat1, lng1, &x1, &y1, &z1);
    globe_geo_to_vec3(lat2, lng2, &x2, &y2, &z2);

    // Angle between vectors
    double dot = x1*x2 + y1*y2 + z1*z2;
    double angle = acos(clamp(dot));

    if (angle < 1e-12) {
        *out_lat = lat1;
        *out_lng = lng1;
        return;
    }

    double sin_angle = sin(angle);
    double scale_a = sin((1.0 - t) * angle) / sin_angle;
    double scale_b = sin(t * angle) / sin_angle;

    double ox = x1 * scale_a + x2 * scale_b;
    double oy = y1 * scale_a + y2 * scale_b;
    double oz = z1 * scale_a + z2 * scale_b;

    globe_vec3_to_geo(ox, oy, oz, out_lat, out_lng);
}

void globe_geo_to_vec3(double lat, double lng, double *ox, double *oy, double *oz) {
    double rlat = deg_to_rad(lat);
    double rlng = deg_to_rad(lng);
    double cos_lat = cos(rlat);
    *ox = cos_lat * cos(rlng);
    *oy = sin(rlat);
    *oz = cos_lat * sin(rlng);
}

void globe_vec3_to_geo(double x, double y, double z, double *out_lat, double *out_lng) {
    *out_lat = rad_to_deg(asin(clamp(y)));
    *out_lng = rad_to_deg(atan2(x, z));
}

void globe_rotate_y(double x, double y, double z, double angle_rad,
                     double *ox, double *oy, double *oz) {
    double c = cos(angle_rad);
    double s = sin(angle_rad);
    *ox = x * c + z * s;
    *oy = y;
    *oz = -x * s + z * c;
}

void globe_rotate_x(double x, double y, double z, double angle_rad,
                     double *ox, double *oy, double *oz) {
    double c = cos(angle_rad);
    double s = sin(angle_rad);
    *ox = x;
    *oy = y * c - z * s;
    *oz = y * s + z * c;
}

/* ─── Test Harness ─────────────────────────────────────────────────────────*/

#if defined(TEST_GLOBE_MATH) && !defined(__EMSCRIPTEN__)
int main() {
    int passed = 0;
    int failed = 0;

    // Haversine: San Francisco → New York (~4120 km)
    double dist = globe_haversine_km(37.77, -122.42, 40.71, -74.01);
    double ratio = dist / 4120.0;
    if (ratio > 0.95 && ratio < 1.05) {
        printf("✓ haversine_sf_nyc: %.0f km\n", dist);
        passed++;
    } else {
        printf("✗ haversine_sf_nyc: %.0f km (expected ~4120)\n", dist);
        failed++;
    }

    // Midpoint: equator at 0° → 90°E → midpoint should be at 45°E
    double mlat, mlng;
    globe_great_circle_interp(0.0, 0.0, 0.0, 90.0, 0.5, &mlat, &mlng);
    if (fabs(mlat) < 1.0 && fabs(mlng - 45.0) < 1.0) {
        printf("✓ midpoint: (%.2f, %.2f)\n", mlat, mlng);
        passed++;
    } else {
        printf("✗ midpoint: (%.2f, %.2f) (expected (0, 45))\n", mlat, mlng);
        failed++;
    }

    // Vec3 roundtrip: London
    double x, y, z;
    globe_geo_to_vec3(51.5, -0.12, &x, &y, &z);
    double rlat, rlng;
    globe_vec3_to_geo(x, y, z, &rlat, &rlng);
    if (fabs(51.5 - rlat) < 0.001 && fabs(-0.12 - rlng) < 0.001) {
        printf("✓ vec3_roundtrip: (%.4f, %.4f)\n", rlat, rlng);
        passed++;
    } else {
        printf("✗ vec3_roundtrip: (%.4f, %.4f)\n", rlat, rlng);
        failed++;
    }

    // Rotation Y: (1,0,0) by 90° → (0,0,-1)
    double rx, ry, rz;
    globe_rotate_y(1.0, 0.0, 0.0, 1.57079632679, &rx, &ry, &rz);
    if (fabs(rx) < 0.001 && fabs(rz + 1.0) < 0.001) {
        printf("✓ rotation_y\n");
        passed++;
    } else {
        printf("✗ rotation_y: (%.4f, %.4f, %.4f)\n", rx, ry, rz);
        failed++;
    }

    printf("\n%d passed, %d failed\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
#endif
