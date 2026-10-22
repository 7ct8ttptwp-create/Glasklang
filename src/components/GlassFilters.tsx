// SVG filter used by the experimental "refraction" glass quality.
// A small generated map bends the pixels behind each panel near its edges, like the rim of a lens.

const MAP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" preserveAspectRatio="none">
<defs>
<linearGradient id="x" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgb(255,0,0)"/><stop offset="0.18" stop-color="rgb(128,0,0)"/><stop offset="0.82" stop-color="rgb(128,0,0)"/><stop offset="1" stop-color="rgb(0,0,0)"/></linearGradient>
<linearGradient id="y" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(0,255,0)"/><stop offset="0.18" stop-color="rgb(0,128,0)"/><stop offset="0.82" stop-color="rgb(0,128,0)"/><stop offset="1" stop-color="rgb(0,0,0)"/></linearGradient>
</defs>
<rect width="256" height="256" fill="url(#x)"/>
<rect width="256" height="256" fill="url(#y)" style="mix-blend-mode:screen"/>
</svg>`;

const MAP_URL = `data:image/svg+xml;utf8,${encodeURIComponent(MAP_SVG)}`;

export function GlassFilters() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <filter id="glk-refract" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feImage href={MAP_URL} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="42" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}
