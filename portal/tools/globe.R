#!/usr/bin/env Rscript
# globe.R — Haversine distance in R (converted from TypeScript globe math)
#
# Run: Rscript tools/globe.R

earth_radius_km <- 6371.0
deg_to_rad <- pi / 180.0

haversine_km <- function(lat1, lng1, lat2, lng2) {
  dlat <- (lat2 - lat1) * deg_to_rad
  dlng <- (lng2 - lng1) * deg_to_rad
  sin_dlat <- sin(dlat / 2)
  sin_dlng <- sin(dlng / 2)
  cos_lat1 <- cos(lat1 * deg_to_rad)
  cos_lat2 <- cos(lat2 * deg_to_rad)
  h <- sin_dlat^2 + cos_lat1 * cos_lat2 * sin_dlng^2
  2 * earth_radius_km * asin(sqrt(h))
}

# PRD file listing — converted from TypeScript prd-orchestrator.ts listPRDs
list_prd_files <- function() {
  if (dir.exists("OpenCodeWEBsPRD")) {
    files <- list.files("OpenCodeWEBsPRD", pattern = "\\.md$")
    return(files)
  }
  character(0)
}

# ─── Main ─────────────────────────────────────────────

dist <- haversine_km(37.77, -122.42, 40.71, -74.01)
ratio <- dist / 4120.0
cat(sprintf("R: SF → NYC = %.0f km\n", dist))
cat(ifelse(ratio > 0.95 && ratio < 1.05,
  "✅ Haversine test PASSED\n",
  "❌ Haversine test FAILED\n"))

prd_files <- list_prd_files()
cat(sprintf("PRD files: %d\n", length(prd_files)))
cat("Polyglot status: R #33 in OpenCodeABs/UX\n")
