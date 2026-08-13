/// globe.dart — Haversine distance in Dart (converted from TypeScript globe math)
///
/// Run: dart tools/globe.dart
library;

import 'dart:math';

const double earthRadiusKm = 6371.0;
const double degToRad = pi / 180.0;

double haversineKm(double lat1, double lng1, double lat2, double lng2) {
  final dlat = (lat2 - lat1) * degToRad;
  final dlng = (lng2 - lng1) * degToRad;
  final sinDlat = sin(dlat / 2);
  final sinDlng = sin(dlng / 2);
  final cosLat1 = cos(lat1 * degToRad);
  final cosLat2 = cos(lat2 * degToRad);
  final h = sinDlat * sinDlat + cosLat1 * cosLat2 * sinDlng * sinDlng;
  return 2 * earthRadiusKm * asin(sqrt(h));
}

void main() {
  // SF → NYC (same test as TypeScript rswasm-globe-physics)
  final dist = haversineKm(37.77, -122.42, 40.71, -74.01);
  final ratio = dist / 4120.0;
  print('Dart: SF → NYC = ${dist.toStringAsFixed(0)} km');

  // Validate against TypeScript expected value (~4120 km)
  if (ratio > 0.95 && ratio < 1.05) {
    print('✅ Haversine test PASSED');
  } else {
    print('❌ Haversine test FAILED');
  }

  // Total languages check (for polyglot validation)
  print('\nPolyglot status: Dart #23 in OpenCodeABs/UX');
}
