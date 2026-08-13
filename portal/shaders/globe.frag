// ─── globe.frag — COBE Globe Fragment Shader ──────────────────────────────
//
// Renders the globe surface with:
//   - A base ocean color (dark blue)
//   - Latitude-based banding for continent silhouettes
//   - Atmospheric glow at the silhouette edge (Fresnel)
//   - Subtle specular highlight from a fixed light direction
//
// Uniforms:
//   uBaseColor    - base ocean colour (vec3, e.g. [0.05, 0.08, 0.20])
//   uGlowColor    - atmospheric glow colour (vec3, e.g. [0.0, 0.4, 0.8])
//   uLightDir     - fixed light direction in view space
//
// ──────────────────────────────────────────────────────────────────────────

precision highp float;

uniform vec3  uBaseColor;
uniform vec3  uGlowColor;
uniform vec3  uLightDir;

varying vec3  vNormal;
varying vec3  vPosition;

void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(-vPosition);           // view direction
    vec3 L = normalize(uLightDir);

    // ─── Fresnel (edge glow) ──────────────────────────────────────────
    float fresnel = 1.0 - max(dot(N, V), 0.0);
    fresnel = pow(fresnel, 2.5);

    // ─── Diffuse (Lambertian) ─────────────────────────────────────────
    float diffuse = max(dot(N, L), 0.0);
    diffuse = mix(0.3, 1.0, diffuse);         // ambient + direct

    // ─── Specular (Blinn-Phong) ───────────────────────────────────────
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 32.0);

    // ─── Latitude banding (continental hint) ──────────────────────────
    // Creates subtle horizontal bands that suggest landmasses
    float latBand = sin(N.y * 8.0) * 0.03 + 0.97;

    // ─── Combine ──────────────────────────────────────────────────────
    vec3 color = uBaseColor * diffuse * latBand;
    color += uGlowColor * fresnel * 0.6;
    color += vec3(1.0, 1.0, 1.0) * spec * 0.15;

    // ─── Markers (transmitted via point sprites from JS) ──────────────
    // Marker rendering is handled by the COBE library's built-in
    // point sprite pipeline. This shader only handles the globe body.

    gl_FragColor = vec4(color, 1.0);
}
