;; globe.clj — Haversine distance in Clojure (converted from TypeScript globe math)
;;
;; Run: clojure -M tools/globe.clj

(def earth-radius-km 6371.0)
(def deg-to-rad (/ Math/PI 180.0))

(defn haversine-km
  "Great-circle distance between two lat/lng points."
  [lat1 lng1 lat2 lng2]
  (let [dlat (* (- lat2 lat1) deg-to-rad)
        dlng (* (- lng2 lng1) deg-to-rad)
        sin-dlat (Math/sin (/ dlat 2.0))
        sin-dlng (Math/sin (/ dlng 2.0))
        cos-lat1 (Math/cos (* lat1 deg-to-rad))
        cos-lat2 (Math/cos (* lat2 deg-to-rad))
        h (+ (* sin-dlat sin-dlat) (* cos-lat1 cos-lat2 sin-dlng sin-dlng))]
    (* 2.0 earth-radius-km (Math/asin (Math/sqrt h)))))

(defn list-prd-files
  "List markdown files in OpenCodeWEBsPRD/ (mimics TypeScript prd-orchestrator.ts listPRDs)"
  []
  (let [prd-dir "OpenCodeWEBsPRD"]
    (when (.exists (java.io.File. prd-dir))
      (->> (.listFiles (java.io.File. prd-dir))
           (filter #(.endsWith (.getName %) ".md"))
           (mapv #(.getName %))))))

;; ─── Main ────────────────────────────────────────────────

(let [dist (haversine-km 37.77 -122.42 40.71 -74.01)
      ratio (/ dist 4120.0)]
  (println (format "Clojure: SF → NYC = %.0f km" dist))
  (println (if (and (> ratio 0.95) (< ratio 1.05))
             "✅ Haversine test PASSED"
             "❌ Haversine test FAILED"))
  (println "Polyglot status: Clojure #26 in OpenCodeABs/UX")

  ;; PRD file listing (mimics TypeScript PRD orchestrator)
  (let [files (list-prd-files)]
    (println (str "PRD files: " (count files) " found"))))
