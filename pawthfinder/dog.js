// The Pawthfinder guide dog, shared by the landing page and the extension.
// Faces right. Parts carry classes so CSS can animate them (tail wag, blink, sniff, sleep).
window.PF_DOG_SVG = `
<svg class="pf-dog-svg" viewBox="0 0 130 104" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <g class="pf-tail"><path d="M26 52 C14 46 10 34 8 24" stroke="#C98A3E" stroke-width="7" stroke-linecap="round" fill="none"/></g>
  <g class="pf-legs-far" fill="#C98A3E">
    <rect x="34" y="62" width="9" height="30" rx="4.5"/>
    <rect x="84" y="62" width="9" height="30" rx="4.5"/>
  </g>
  <g class="pf-bodygroup">
    <ellipse cx="60" cy="57" rx="38" ry="21" fill="#E3A857"/>
    <ellipse cx="62" cy="66" rx="26" ry="9" fill="#F0C27F"/>
    <g class="pf-legs" fill="#E3A857">
      <rect x="26" y="64" width="10" height="30" rx="5"/>
      <rect x="76" y="64" width="10" height="30" rx="5"/>
    </g>
    <g fill="#F7F1E6">
      <ellipse cx="31" cy="94" rx="7" ry="3.5"/><ellipse cx="81" cy="94" rx="7" ry="3.5"/>
    </g>
    <!-- guide harness -->
    <path d="M70 38 L64 12 L48 12 L50 40" stroke="#0B5563" stroke-width="4.5" stroke-linejoin="round" fill="none"/>
    <rect x="66" y="37" width="11" height="40" rx="3" fill="#0B5563"/>
    <rect x="40" y="44" width="40" height="8" rx="3" fill="#0B5563"/>
    <circle cx="71.5" cy="56" r="5" fill="#F2A541"/>
    <path d="M69.6 55.2 a1 1 0 1 1 0.01 0 M73.4 55.2 a1 1 0 1 1 0.01 0 M71.5 54 a1 1 0 1 1 0.01 0 M71.5 58.6 a2 1.6 0 1 1 0.01 0" stroke="#0B5563" stroke-width="1.4" fill="none"/>
  </g>
  <g class="pf-dhead">
    <path class="pf-ear-back" d="M88 22 C80 22 78 36 82 46 C86 42 90 34 90 26 Z" fill="#B97A35"/>
    <circle cx="97" cy="36" r="19" fill="#E3A857"/>
    <ellipse class="pf-snout" cx="112" cy="43" rx="12" ry="9" fill="#F0C27F"/>
    <circle class="pf-nose" cx="121" cy="40" r="4" fill="#2B1D14"/>
    <path d="M110 49 Q114 52 118 49" stroke="#2B1D14" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path class="pf-tongue" d="M113 50 Q114 58 117 50 Z" fill="#E86A7A"/>
    <ellipse class="pf-eye" cx="102" cy="31" rx="2.8" ry="3" fill="#2B1D14"/>
    <circle cx="103" cy="30" r="0.9" fill="#fff" class="pf-eye-shine"/>
    <path class="pf-ear" d="M86 20 C76 22 76 40 82 50 C90 46 94 34 92 24 Z" fill="#B97A35"/>
    <path d="M80 50 Q90 56 100 54" stroke="#C4453C" stroke-width="4" fill="none" stroke-linecap="round"/>
  </g>
  <g class="pf-zzz" fill="#0B5563" font-family="system-ui, sans-serif" font-weight="700">
    <text x="104" y="14" font-size="11">z</text><text x="113" y="8" font-size="8">z</text>
  </g>
</svg>`;
