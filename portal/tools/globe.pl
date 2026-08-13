#!/usr/bin/env perl
# globe.pl — Haversine distance in Perl (converted from TypeScript globe math)
#
# Run: perl tools/globe.pl

use strict;
use warnings;
use Math::Trig qw(asin pi);

my $EARTH_RADIUS_KM = 6371.0;
my $DEG_TO_RAD = pi / 180.0;

sub haversine_km {
    my ($lat1, $lng1, $lat2, $lng2) = @_;
    my $dlat = ($lat2 - $lat1) * $DEG_TO_RAD;
    my $dlng = ($lng2 - $lng1) * $DEG_TO_RAD;
    my $sin_dlat = sin($dlat / 2.0);
    my $sin_dlng = sin($dlng / 2.0);
    my $cos_lat1 = cos($lat1 * $DEG_TO_RAD);
    my $cos_lat2 = cos($lat2 * $DEG_TO_RAD);
    my $h = $sin_dlat * $sin_dlat + $cos_lat1 * $cos_lat2 * $sin_dlng * $sin_dlng;
    return 2.0 * $EARTH_RADIUS_KM * asin(sqrt($h));
}

# Check .gitignore (converted from TypeScript prd-orchestrator.ts)
sub check_gitignore {
    open(my $fh, '<', '.gitignore') or return 0;
    while (<$fh>) {
        return 1 if /Local PRD Isolation/;
    }
    close $fh;
    return 0;
}

# Count MD files in OpenCodeWEBsPRD (converted from TypeScript listPRDs)
sub count_prd_files {
    opendir(my $dh, 'OpenCodeWEBsPRD') or return 0;
    my $count = grep { /\.md$/i && -f "OpenCodeWEBsPRD/$_" } readdir($dh);
    closedir $dh;
    return $count;
}

# ─── Main ─────────────────────────────────────────────────

my $dist = haversine_km(37.77, -122.42, 40.71, -74.01);
my $ratio = $dist / 4120.0;
printf "Perl: SF → NYC = %.0f km\n", $dist;
print ($ratio > 0.95 && $ratio < 1.05 ? "✅ Haversine test PASSED\n" : "❌ Haversine test FAILED\n");
print "PRD git isolation: " . (check_gitignore() ? "yes" : "no") . "\n";
print "PRD files: " . count_prd_files() . "\n";
print "Polyglot status: Perl #32 in OpenCodeABs/UX\n";
