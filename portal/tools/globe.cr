# globe.cr — Haversine distance in Crystal (converted from TypeScript globe math)
#
# Run: crystal tools/globe.cr

EARTH_RADIUS_KM = 6371.0
DEG_TO_RAD = Math::PI / 180.0

def haversine_km(lat1 : Float64, lng1 : Float64, lat2 : Float64, lng2 : Float64) : Float64
  dlat = (lat2 - lat1) * DEG_TO_RAD
  dlng = (lng2 - lng1) * DEG_TO_RAD
  sin_dlat = Math.sin(dlat / 2.0)
  sin_dlng = Math.sin(dlng / 2.0)
  cos_lat1 = Math.cos(lat1 * DEG_TO_RAD)
  cos_lat2 = Math.cos(lat2 * DEG_TO_RAD)
  h = sin_dlat * sin_dlat + cos_lat1 * cos_lat2 * sin_dlng * sin_dlng
  2.0 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
end

# Gitignore check — converted from TypeScript prd-orchestrator.ts ensureGitignoreIsolation
def gitignore_has_prd_isolation? : Bool
  if File.exists?(".gitignore")
    content = File.read(".gitignore")
    content.includes?("Local PRD Isolation")
  else
    false
  end
end

# ─── Main ──────────────────────────────────────────

dist = haversine_km(37.77, -122.42, 40.71, -74.01)
ratio = dist / 4120.0
puts "Crystal: SF → NYC = #{dist.round.to_i} km"
puts ratio > 0.95 && ratio < 1.05 ? "✅ Haversine test PASSED" : "❌ Haversine test FAILED"
puts "PRD git isolation: #{gitignore_has_prd_isolation?}"
puts "Polyglot status: Crystal #30 in OpenCodeABs/UX"
