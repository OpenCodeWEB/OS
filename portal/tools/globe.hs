-- globe.hs — Haversine distance in Haskell (converted from TypeScript globe math)
--
-- Run: runhaskell tools/globe.hs

module Main where

earthRadiusKm :: Double
earthRadiusKm = 6371.0

degToRad :: Double
degToRad = pi / 180.0

haversineKm :: Double -> Double -> Double -> Double -> Double
haversineKm lat1 lng1 lat2 lng2 =
    let dlat = (lat2 - lat1) * degToRad
        dlng = (lng2 - lng1) * degToRad
        sinDlat = sin (dlat / 2)
        sinDlng = sin (dlng / 2)
        cosLat1 = cos (lat1 * degToRad)
        cosLat2 = cos (lat2 * degToRad)
        h = sinDlat * sinDlat + cosLat1 * cosLat2 * sinDlng * sinDlng
    in 2.0 * earthRadiusKm * asin (sqrt h)

-- Midpoint interpolation (converted from rswasm-globe-physics/src/lib.rs)
midpoint :: Double -> Double -> Double -> Double -> (Double, Double)
midpoint lat1 lng1 lat2 lng2 =
    let t = 0.5
        dlat = (lat2 - lat1) * degToRad
        dlng = (lng2 - lng1) * degToRad
        a = sin (dlat / 2) * sin (dlat / 2) + cos (lat1 * degToRad) * cos (lat2 * degToRad) * sin (dlng / 2) * sin (dlng / 2)
        c = 2 * atan2 (sqrt a) (sqrt (1 - a))
        dist = earthRadiusKm * c
        -- Simple linear approximation for midpoint
        midLat = (lat1 + lat2) / 2
        midLng = (lng1 + lng2) / 2
    in (midLat, midLng)

main :: IO ()
main = do
    let dist = haversineKm 37.77 (-122.42) 40.71 (-74.01)
    let ratio = dist / 4120.0
    putStrLn $ "Haskell: SF → NYC = " ++ show (round dist :: Int) ++ " km"
    putStrLn $ if ratio > 0.95 && ratio < 1.05 then "✅ Haversine test PASSED" else "❌ Haversine test FAILED"
    let (mlat, mlng) = midpoint 37.77 (-122.42) 40.71 (-74.01)
    putStrLn $ "Midpoint: (" ++ show mlat ++ ", " ++ show mlng ++ ")"
    putStrLn "Polyglot status: Haskell #25 in OpenCodeABs/UX"
