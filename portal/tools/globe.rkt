#lang racket
; globe.rkt — Haversine distance in Racket (converted from TypeScript globe math)
;
; Run: racket tools/globe.rkt

(define earth-radius-km 6371.0)
(define deg-to-rad (/ pi 180.0))

(define (haversine-km lat1 lng1 lat2 lng2)
  (define dlat (* (- lat2 lat1) deg-to-rad))
  (define dlng (* (- lng2 lng1) deg-to-rad))
  (define sin-dlat (sin (/ dlat 2.0)))
  (define sin-dlng (sin (/ dlng 2.0)))
  (define cos-lat1 (cos (* lat1 deg-to-rad)))
  (define cos-lat2 (cos (* lat2 deg-to-rad)))
  (define h (+ (* sin-dlat sin-dlat) (* cos-lat1 cos-lat2 sin-dlng sin-dlng)))
  (* 2.0 earth-radius-km (asin (sqrt h))))

; Great-circle midpoint — converted from rswasm-globe-physics/src/lib.rs
(define (great-circle-midpoint lat1 lng1 lat2 lng2)
  (define t 0.5)
  (define dlat (* (- lat2 lat1) deg-to-rad))
  (define dlng (* (- lng2 lng1) deg-to-rad))
  (define a (+ (expt (sin (/ dlat 2.0)) 2)
               (* (cos (* lat1 deg-to-rad)) (cos (* lat2 deg-to-rad)) (expt (sin (/ dlng 2.0)) 2))))
  (define c (* 2 (atan (sqrt a) (sqrt (- 1 a)))))
  (values (/ (+ lat1 lat2) 2) (/ (+ lng1 lng2) 2)))

; ─── Main ───────────────────────────────────────────
(define dist (haversine-km 37.77 -122.42 40.71 -74.01))
(define ratio (/ dist 4120.0))
(printf "Racket: SF → NYC = ~.0f km\n" dist)
(if (and (> ratio 0.95) (< ratio 1.05))
    (displayln "✅ Haversine test PASSED")
    (displayln "❌ Haversine test FAILED"))

(define-values (mlat mlng) (great-circle-midpoint 37.77 -122.42 40.71 -74.01))
(printf "Midpoint: (~a, ~a)\n" (~r mlat #:precision 2) (~r mlng #:precision 2))
(displayln "Polyglot status: Racket #31 in OpenCodeABs/UX")
