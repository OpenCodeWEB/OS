/**
 * globe_math.h — C99 header for WASM-compatible globe math library.
 *
 * All functions use double precision and export with `globe_` prefix.
 * Compatible with Emscripten (emcc) for WASM compilation.
 *
 * Usage:
 *   #include "globe_math.h"
 *   double dist = globe_haversine_km(37.77, -122.42, 40.71, -74.01);
 */

#ifndef GLOBE_MATH_H
#define GLOBE_MATH_H

#ifdef __cplusplus
extern "C" {
#endif

/* ─── Constants ───────────────────────────────────────────────────────────*/

#define GLOBE_EARTH_RADIUS_KM 6371.0
#define GLOBE_DEG_TO_RAD      0.017453292519943295
#define GLOBE_RAD_TO_DEG      57.29577951308232

/* ─── Core API ────────────────────────────────────────────────────────────*/

/**
 * Haversine great-circle distance in km.
 * Returns the distance between two lat/lng points (decimal degrees).
 */
double globe_haversine_km(double lat1, double lng1, double lat2, double lng2);

/**
 * Compute the midpoint along the great-circle arc at fraction t.
 * t=0.0 returns (lat1,lng1), t=1.0 returns (lat2,lng2).
 * Output lat/lng written to *out_lat / *out_lng.
 */
void globe_great_circle_interp(
    double lat1, double lng1,
    double lat2, double lng2,
    double t,
    double *out_lat, double *out_lng
);

/**
 * Convert lat/lng (decimal degrees) to 3D unit sphere coordinates.
 * Output x,y,z written to *ox / *oy / *oz.
 */
void globe_geo_to_vec3(double lat, double lng, double *ox, double *oy, double *oz);

/**
 * Convert 3D unit sphere coordinates back to lat/lng (decimal degrees).
 */
void globe_vec3_to_geo(double x, double y, double z, double *out_lat, double *out_lng);

/**
 * Rotate a 3D vector around the Y axis by angle_rad radians.
 */
void globe_rotate_y(double x, double y, double z, double angle_rad,
                     double *ox, double *oy, double *oz);

/**
 * Rotate a 3D vector around the X axis by angle_rad radians.
 */
void globe_rotate_x(double x, double y, double z, double angle_rad,
                     double *ox, double *oy, double *oz);

#ifdef __cplusplus
}
#endif

#endif /* GLOBE_MATH_H */
