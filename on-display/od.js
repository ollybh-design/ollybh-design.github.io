/* On Display shoebox: live 3D model. Needs THREE r128 (+ OrbitControls optional) and window.OD_DATA.
   Every part is folded from the same flat nets as the dielines: each panel is a polygon in net
   coordinates, hinged to its parent on a crease, so panel sizes never change while folding.
   World mm: x across the box, y front (0) to rear, z up. */
(function(){
const d2r = THREE.MathUtils.degToRad;
const lerp = (a, b, u) => a + (b - a)*u, ez = u => u < 0.5 ? 2*u*u : 1 - Math.pow(-2*u + 2, 2)/2, cl = v => Math.max(0, Math.min(1, v));
const seg = (v, a, b) => cl((v - a)/(b - a));
const C = c => new THREE.Color(c).convertSRGBToLinear();
const BLACK = '#151515';
const SLOT = new THREE.MeshStandardMaterial({color: 0x1a1a1a, roughness: 0.9});
function canvasTex(w, h, draw){ const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t; }
let NOISE = null;
function kraftTex(){ if (NOISE) return NOISE; NOISE = canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 4200; i++){ const a = Math.random()*0.07; g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(70,45,20,${a})`;
    g.fillRect(Math.random()*w, Math.random()*h, 2 + Math.random()*9, 1 + Math.random()*1.5); } });
  NOISE.wrapS = NOISE.wrapT = THREE.RepeatWrapping; NOISE.repeat.set(1/160, 1/160); return NOISE; }
function mat(color, rough = 0.9, map = null, extra = {}){ const e = Object.assign({}, extra); delete e.tint; return new THREE.MeshStandardMaterial(Object.assign({color: map && !extra.tint ? 0xffffff : C(color), roughness: rough, map}, e)); }

/* ---------------- panel trees ---------------- */
function centroid(p){ let x = 0, y = 0; for (const q of p){ x += q[0]; y += q[1]; } return [x/p.length, y/p.length]; }
function frameFor(h, poly){
  const o = h[0]; let ux = [h[1][0] - o[0], h[1][1] - o[1]]; const L = Math.hypot(ux[0], ux[1]); ux = [ux[0]/L, ux[1]/L];
  let uy = [-ux[1], ux[0]]; const c = centroid(poly);
  if ((c[0] - o[0])*uy[0] + (c[1] - o[1])*uy[1] < 0) uy = [-uy[0], -uy[1]];
  if (ux[0]*uy[1] - ux[1]*uy[0] < 0) ux = [-ux[0], -ux[1]];
  return {o, ux, uy};
}
const ROOT = {o: [0, 0], ux: [1, 0], uy: [0, 1]};
function toLocal(F, p){ const dx = p[0] - F.o[0], dy = p[1] - F.o[1]; return [dx*F.ux[0] + dy*F.ux[1], dx*F.uy[0] + dy*F.uy[1]]; }
function netToLocalM(F){ const m = new THREE.Matrix4();
  m.set(F.ux[0], F.ux[1], 0, -(F.o[0]*F.ux[0] + F.o[1]*F.ux[1]),  F.uy[0], F.uy[1], 0, -(F.o[0]*F.uy[0] + F.o[1]*F.uy[1]),  0, 0, 1, 0,  0, 0, 0, 1); return m; }
function panelGeo(poly, holes, T, F){
  const sh = new THREE.Shape(poly.map(p => new THREE.Vector2(p[0], p[1])));
  for (const h of holes || []) sh.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))));
  const g = new THREE.ExtrudeGeometry(sh, {depth: T, bevelEnabled: false, curveSegments: 6});
  const gr = g.groups; if (gr.length >= 2){ const cap = gr[0].count, half = cap/2; g.clearGroups();
    g.addGroup(0, half, 0); g.addGroup(half, half, 1); g.addGroup(cap, gr[1].count, 2); }
  g.applyMatrix4(netToLocalM(F)); g.computeVertexNormals(); return g;
}
function buildTree(panels, T, mats){
  const root = new THREE.Group(), fold = {}, frame = {}, mesh = {};
  for (const p of panels){
    const F = p.hinge ? frameFor(p.hinge, p.poly) : ROOT; frame[p.id] = F;
    let host;
    if (!p.parent){ host = root; fold[p.id] = root; }
    else { const Fp = frame[p.parent]; const hinge = new THREE.Group(); const o = toLocal(Fp, F.o);
      const dx = F.ux[0]*Fp.ux[0] + F.ux[1]*Fp.ux[1], dy = F.ux[0]*Fp.uy[0] + F.ux[1]*Fp.uy[1];
      hinge.position.set(o[0], o[1], 0); hinge.rotation.z = Math.atan2(dy, dx); fold[p.parent].add(hinge);
      const f = new THREE.Group(); hinge.add(f); fold[p.id] = f; host = f; }
    const m = new THREE.Mesh(panelGeo(p.poly, p.holes, T, F), mats(p.id)); m.castShadow = m.receiveShadow = true; host.add(m); mesh[p.id] = m;
    if (/^ledge/.test(p.id)) for (const h of p.holes){ const q = h.map(pt => toLocal(F, pt)), xs = q.map(v => v[0]), ys = q.map(v => v[1]);
      const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...ys) - Math.min(...ys);
      const s = new THREE.Mesh(new THREE.BoxGeometry(w + 3, d + 3, T + 1), SLOT); s.position.set((Math.max(...xs) + Math.min(...xs))/2, (Math.max(...ys) + Math.min(...ys))/2, T/2); host.add(s); }
  }
  // folds towards the inside pivot on the inside face, reverse folds on the print face, so 180 degree folds stack instead of passing through
  const tree = {root, fold, frame, mesh, set(id, deg){ const f = fold[id]; if (!f || f === root) return; const a = d2r(deg); f.rotation.x = a;
    if (deg > 0) f.position.set(0, T*Math.sin(a), T - T*Math.cos(a)); else f.position.set(0, 0, 0); }};
  // world position of a net point (x, y) on panel id, at depth z (0 = print face, T = inside face)
  tree.world = (id, x, y, z = 0) => { const l = toLocal(frame[id], [x, y]); return new THREE.Vector3(l[0], l[1], z).applyMatrix4(mesh[id].matrixWorld); };
  return tree;
}
function netBounds(panels){ let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of panels) for (const q of p.poly){ x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } return {x0, y0, x1, y1, w: x1 - x0, h: y1 - y0}; }
function netPrint(B, ppm, draw){ const w = Math.ceil(B.w*ppm), h = Math.ceil(B.h*ppm);
  const t = canvasTex(w, h, (g) => { const X = x => (x - B.x0)*ppm, Y = y => h - (y - B.y0)*ppm; draw(g, X, Y, ppm, w, h); });
  t.repeat.set(1/B.w, 1/B.h); t.offset.set(-B.x0/B.w, -B.y0/B.h); return t; }
// text that reads correctly on the print face (the net is drawn from the inside)
function outside(g, cx, cy, rot, fn){ g.save(); g.translate(cx, cy); g.rotate(rot); g.scale(-1, 1); fn(g); g.restore(); }
const P = (panels, id) => panels.find(p => p.id === id);
function pb(panels, id){ const xs = P(panels, id).poly.map(q => q[0]), ys = P(panels, id).poly.map(q => q[1]); return {x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys)}; }

/* ---------------- trainer (stylised, no brand marks) ---------------- */
function shoe(S){
  const g = new THREE.Group();
  const L = S.L, W = S.W - 4, OUT = 5, MID = 15, SOLE = OUT + MID, k = S.H/80;
  const sm = u => u*u*(3 - 2*u);
  const lerpK = (K, t) => { for (let i = 1; i < K.length; i++) if (t <= K[i][0]){ const [t0, v0] = K[i-1], [t1, v1] = K[i]; return v0 + (v1 - v0)*sm((t - t0)/(t1 - t0)); } return K[K.length-1][1]; };
  const outline = t => { const toe = Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, 0.22 - t)/0.22, 2))), heel = Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, t - 0.86)/0.14, 2.6)));
    const waist = 1 - 0.13*Math.exp(-Math.pow((t - 0.6)/0.12, 2)); const taper = t < 0.4 ? 1 : 1 - 0.09*(t - 0.4)/0.6; return W/2*toe*heel*waist*taper; };
  const plan = (kk, n = 72) => { const pts = [new THREE.Vector2(0, 0)]; for (let i = 1; i < n; i++){ const t = i/n; pts.push(new THREE.Vector2(outline(t)*kk, t*L)); }
    pts.push(new THREE.Vector2(0, L)); for (let i = n - 1; i >= 1; i--){ const t = i/n; pts.push(new THREE.Vector2(-outline(t)*kk, t*L)); } return new THREE.Shape(pts); };
  const ext = (shape, d, m, z) => { const o = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, {depth: d, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 1.2, bevelSegments: 2, curveSegments: 4}), m); o.position.z = z; o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  ext(plan(1.0), OUT - 1.6, new THREE.MeshStandardMaterial({color: C(0xb07a3e), roughness: 0.55}), 0.8);
  ext(plan(1.0), MID - 1.6, new THREE.MeshStandardMaterial({color: C(0xf1ece0), roughness: 0.6}), OUT + 0.8);
  const TOP = [[0, 6], [0.05, 22], [0.12, 34], [0.25, 42], [0.4, 52], [0.56, 62], [0.63, 60], [0.71, 52], [0.8, 51], [0.9, 58], [0.97, 64], [1, 62]].map(([t, h]) => [t, h*k]);
  // upper: white leather with grey suede overlays (toe cap, side panel, eyestays, heel counter) via vertex colours
  const M = 90, K = 30, pos = [], idx = [], col = [];
  const WHITE = new THREE.Color(0xf5f3ee).convertSRGBToLinear(), SUEDE = new THREE.Color(0x9e9a92).convertSRGBToLinear(), DARK = new THREE.Color(0x7d7970).convertSRGBToLinear();
  for (let i = 0; i <= M; i++){ const t = 0.004 + 0.992*i/M, w = outline(t)*0.95, h = lerpK(TOP, t);
    for (let j = 0; j <= K; j++){ const a = Math.PI*j/K, c = Math.cos(a), sn = Math.max(0, Math.sin(a)), up = Math.pow(sn, 0.55);
      pos.push(Math.sign(c)*Math.pow(Math.abs(c), 0.6)*w, t*L, SOLE - 1 + up*h);
      let cc = WHITE;
      if (t < 0.2 && up < 0.97) cc = SUEDE;                                   // toe cap
      else if (t > 0.84 && up < 0.9) cc = SUEDE;                              // heel counter
      else if (t > 0.45 && t < 0.8 && up < 0.62 && up > 0.12) cc = SUEDE;     // side panel
      else if (t > 0.3 && t < 0.66 && up > 0.8 && up < 0.93) cc = SUEDE;      // eyestays
      if (up < 0.07) cc = DARK;                                               // stitched welt line
      col.push(cc.r, cc.g, cc.b); } }
  for (let i = 0; i < M; i++) for (let j = 0; j < K; j++){ const a0 = i*(K + 1) + j, b0 = a0 + K + 1; idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1); }
  const ug = new THREE.BufferGeometry(); ug.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); ug.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); ug.setIndex(idx); ug.computeVertexNormals();
  const upper = new THREE.Mesh(ug, new THREE.MeshStandardMaterial({color: 0xffffff, vertexColors: true, roughness: 0.62, side: THREE.DoubleSide})); upper.castShadow = upper.receiveShadow = true; g.add(upper);
  const white = new THREE.MeshStandardMaterial({color: C(0xfbfaf7), roughness: 0.5}), lace = new THREE.MeshStandardMaterial({color: C(0xeeebe4), roughness: 0.8});
  const yC = L*0.79, hC = lerpK(TOP, 0.79);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({color: C(0x8f8a82), roughness: 1}));
  hole.scale.set(W*0.32, L*0.12, 1); hole.position.set(0, yC, SOLE + hC - 0.5); g.add(hole);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.16, 10, 48), white); rim.scale.set(W*0.36, L*0.145, 9); rim.position.set(0, yC, SOLE + hC - 0.2); g.add(rim);   // padded collar
  const tongue = new THREE.Mesh(new THREE.BoxGeometry(W*0.3, L*0.2, 3), white); tongue.position.set(0, L*0.66, SOLE + lerpK(TOP, 0.66) + 2); tongue.rotation.x = -0.55; g.add(tongue);
  for (let q = 0; q < 6; q++){ const t = 0.36 + q*0.045; const l = new THREE.Mesh(new THREE.BoxGeometry(W*0.36, 3.4, 1.6), lace);
    l.position.set(0, t*L, SOLE + lerpK(TOP, t) + 0.9); l.rotation.x = -0.35; l.castShadow = true; g.add(l); }
  const ht = new THREE.Mesh(new THREE.BoxGeometry(26, 4, 22*k), new THREE.MeshStandardMaterial({color: C(0x9e9a92), roughness: 0.9})); ht.position.set(0, L - 2.5, SOLE + 44*k); g.add(ht);
  return g;
}

/* ---------------- build ---------------- */
// skins: 'plain' kraft, 'adidas' black with logo, 'nike' Nike SB artwork. imgs = {logo, nf, ns}
function skin(D, theme, imgs){
  const T = D.T, kraftN = kraftTex();
  const kraft = mat('#c49a6c', 0.92, kraftN, {tint: true});
  const B = D.base, BP = B.panels, bd = B.bd, H = B.H, LP = D.lid.panels, lb = D.lid.bd, LH = D.lid.H;
  const logo = imgs.logo, nf = imgs.nf, ns = imgs.ns;
  const logoAt = (g, cx, cy, wpx, rot = 0) => { if (!logo) return; const hpx = wpx*logo.height/logo.width; outside(g, cx, cy, rot, gg => gg.drawImage(logo, -wpx/2, -hpx/2, wpx, hpx)); };
  const imgAt = (g, im, cx, cy, wpx, hpx, rot, src) => { if (!im) return; outside(g, cx, cy, rot, gg => src ? gg.drawImage(im, src[0], src[1], src[2], src[3], -wpx/2, -hpx/2, wpx, hpx) : gg.drawImage(im, -wpx/2, -hpx/2, wpx, hpx)); };
  const txt = (g, cx, cy, rot, s, font, col, str) => outside(g, cx, cy, rot, gg => { gg.fillStyle = col; gg.textAlign = 'center'; gg.textBaseline = 'middle'; gg.font = font; gg.fillText(str, 0, 0); });
  const out = {base: kraft, lid: kraft};
  if (theme === 'adidas'){
    out.base = mat('#ffffff', 0.7, netPrint(netBounds(BP), 1.6, (g, Xf, Yf, s, w, h) => { g.fillStyle = BLACK; g.fillRect(0, 0, w, h);
      logoAt(g, Xf(0), Yf(-H*0.48), 120*s, Math.PI);
      txt(g, Xf(0), Yf(-H*0.80), Math.PI, s, `600 ${11*s}px Inter, Arial`, '#ffffff', 'ON DISPLAY');
      for (const nm of ['L', 'R']){ const o = pb(BP, 'out' + nm), cx = (o.x0 + o.x1)/2, sx = nm === 'R' ? 1 : -1;
        logoAt(g, Xf(cx), Yf(bd*0.82), 70*s, sx*Math.PI/2);
        txt(g, Xf(cx + sx*H*0.28), Yf(bd*0.38), sx*Math.PI/2, s, `500 ${9*s}px Inter, Arial`, 'rgba(255,255,255,.85)', 'Keep the box. Show the shoes.'); }
      logoAt(g, Xf(0), Yf(bd + H*0.45), 90*s, 0); }));
    out.lid = mat('#ffffff', 0.7, netPrint(netBounds(LP), 1.6, (g, Xf, Yf, s, w, h) => { g.fillStyle = BLACK; g.fillRect(0, 0, w, h);
      logoAt(g, Xf(0), Yf(lb*0.42), 130*s, Math.PI);
      txt(g, Xf(0), Yf(lb*0.66), Math.PI, s, `600 ${15*s}px Inter, Arial`, '#ffffff', 'ON DISPLAY');
      txt(g, Xf(0), Yf(lb*0.73), Math.PI, s, `500 ${8.5*s}px Inter, Arial`, 'rgba(255,255,255,.8)', 'Keep the box. Show the shoes.');
      for (const nm of ['L', 'R']){ const o = pb(LP, 'out' + nm), sx = nm === 'R' ? 1 : -1; logoAt(g, Xf((o.x0 + o.x1)/2), Yf(lb*0.18), 34*s, sx*Math.PI/2); } }));
  } else if (theme === 'nike'){
    const SKY = '#22a9e6';
    out.base = mat('#ffffff', 0.8, netPrint(netBounds(BP), 1.6, (g, Xf, Yf, s, w, h) => { g.fillStyle = SKY; g.fillRect(0, 0, w, h);
      const fr = pb(BP, 'front'), fw = (fr.x1 - fr.x0)*s;
      imgAt(g, nf, Xf(0), Yf(-H/2), fw, H*s, Math.PI);
      imgAt(g, nf, Xf(0), Yf(bd + H/2), fw, H*s, 0);
      for (const nm of ['L', 'R']){ const o = pb(BP, 'out' + nm), sx = nm === 'R' ? 1 : -1; imgAt(g, ns, Xf((o.x0 + o.x1)/2), Yf(bd/2), bd*s, H*s, sx*Math.PI/2); } }));
    const hills = nf ? [0, nf.height*0.74, nf.width, nf.height*0.26] : null;
    out.lid = mat('#ffffff', 0.8, netPrint(netBounds(LP), 1.6, (g, Xf, Yf, s, w, h) => { g.fillStyle = SKY; g.fillRect(0, 0, w, h);
      const fr = pb(LP, 'front'), fw = (fr.x1 - fr.x0)*s;
      imgAt(g, nf, Xf(0), Yf(lb/2), fw*0.95, fw*0.95*0.52, Math.PI);
      imgAt(g, nf, Xf(0), Yf(-LH/2), fw, LH*s, Math.PI, hills); imgAt(g, nf, Xf(0), Yf(lb + LH/2), fw, LH*s, 0, hills);
      for (const nm of ['L', 'R']){ const o = pb(LP, 'out' + nm), sx = nm === 'R' ? 1 : -1; imgAt(g, nf, Xf((o.x0 + o.x1)/2), Yf(lb/2), lb*s, LH*s, sx*Math.PI/2, hills); } }));
  }
  return out;
}
function platPrint(D){
  return mat('#ffffff', 0.88, netPrint(netBounds(D.plat.panels), 1.6, (g, Xf, Yf, s, w, h) => { g.fillStyle = '#c49a6c'; g.fillRect(0, 0, w, h);
    const PW = D.plat.PW, PL = D.plat.PL, ink = 'rgba(60,40,20,.55)';
    const txt = (cx, cy, font, str) => outside(g, cx, cy, 0, gg => { gg.fillStyle = ink; gg.textAlign = 'center'; gg.textBaseline = 'middle'; gg.font = font; gg.fillText(str, 0, 0); });
    g.strokeStyle = ink; g.lineWidth = 1.2*s; g.setLineDash([6*s, 5*s]); g.beginPath(); g.moveTo(Xf(-PW/2 + 14), Yf(12)); g.lineTo(Xf(PW/2 - 14), Yf(12)); g.stroke(); g.setLineDash([]);
    txt(Xf(0), Yf(20), `600 ${6.5*s}px Inter, Arial`, 'TOES HERE');
    txt(Xf(0), Yf(PL - 22), `600 ${10*s}px Inter, Arial`, 'KEEP THE BOX. SHOW THE SHOES.'); }));
}
function build(scene, D, theme, imgs){
  const T = D.T, R = {D, theme};
  const kraftN = kraftTex(), kraftIn = mat('#d3b083', 0.92, kraftN, {tint: true}), edge = mat('#a98258', 0.95);
  const plain = skin(D, 'plain', imgs), brand = theme === 'plain' ? plain : skin(D, theme, imgs);
  R.skins = {plain, brand}; R.skinNow = null;
  const B = D.base, X = B.X;
  const tb = buildTree(B.panels, T, () => [brand.base, kraftIn, edge]); scene.add(tb.root); R.base = tb;
  const platOut = platPrint(D), supMat = mat('#7d5533', 0.85);
  const tp = buildTree(D.plat.panels, T, id => /^(sup|fl|ft)/.test(id) ? [supMat, kraftIn, edge] : [platOut, kraftIn, edge]);
  const Xi = X - T; tp.root.position.set(-Xi, D.plat.z_h, T); tb.fold.front.add(tp.root); R.plat = tp;
  const tl = buildTree(D.lid.panels, T, () => [brand.lid, kraftIn, edge]); const lidG = new THREE.Group(); lidG.add(tl.root); scene.add(lidG); R.lid = tl; R.lidG = lidG;
  tl.root.rotation.x = Math.PI;   // top up, walls hang down
  R.setSkin = k => { if (R.skinNow === k) return; R.skinNow = k; const sk = R.skins[k];
    for (const m of Object.values(tb.mesh)){ (m.userData.norm || m.material)[0] = sk.base; } for (const m of Object.values(tl.mesh)) m.material[0] = sk.lid; };
  R.shoes = [shoe(D.shoe), shoe(D.shoe)]; R.shoes.forEach(s => scene.add(s));
  return R;
}

/* ---------------- poses ---------------- */
const S0 = {walls: 90, ears: 90, sides: 90, roll: 1, plat: 90, hems: 180, blayer: 180, sup: 0, flange: 0, ftab: 0, lidFold: 1, lid: 0, shoes: 0, shoesVis: 1, lift: 0, cut: 0, ghost: 0, brand: 1, tab: 2};
const FLAT = {walls: 0, ears: 0, sides: 0, roll: 0, plat: 180, lidFold: 0, lid: 1, shoesVis: 0, brand: 0, tab: 0};
const CUT_IDS = ['outR', 'rimR', 'dropR', 'ledgeR', 'inR', 'tabR0', 'tabR1', 'earfR', 'earrR'];
const GHOST_IDS = ['outR', 'rimR', 'dropR', 'earfR', 'earrR'];
function apply(R, S){
  const D = R.D, T = D.T, b = R.base, p = R.plat, l = R.lid;
  R.setSkin(S.brand > 0.5 ? 'brand' : 'plain');
  for (const w of ['front', 'rear']) b.set(w, S.walls);
  for (const e of ['earfL', 'earfR', 'earrL', 'earrR']) b.set(e, S.ears);
  for (const nm of ['L', 'R']){
    b.set('out' + nm, S.sides); const r = S.roll;
    b.set('rim' + nm, 90*seg(r, 0, 0.35)); b.set('drop' + nm, 90*seg(r, 0.15, 0.55)); b.set('ledge' + nm, -90*seg(r, 0.35, 0.75)); b.set('in' + nm, 90*seg(r, 0.55, 1));
  }
  p.set('tab', TABSIGN*(S.tab <= 1 ? 90*S.tab : 90 + 90*(S.tab - 1)));
  p.set('top', S.plat); p.set('hemL', S.hems); p.set('hemR', S.hems); p.set('bottom', S.blayer);
  for (const nm of ['L', 'R']){ p.set('sup' + nm, -180 + 90*S.sup); p.set('fl' + nm, 180 - 90*S.flange); p.set('ft' + nm + '0', -90*S.ftab); p.set('ft' + nm + '1', -90*S.ftab); }
  // lid: fold, then pose (0 on the box, 1 aside on the table, 2 under the box as a plinth)
  const lf = S.lidFold;
  for (const w of ['front', 'rear']) l.set(w, 90*lf);
  for (const e of ['earfL', 'earfR', 'earrL', 'earrR']) l.set(e, 90*lf);
  for (const nm of ['L', 'R']){ l.set('out' + nm, 90*lf); l.set('strip' + nm, 90*seg(lf, 0.3, 0.7)); l.set('in' + nm, 90*seg(lf, 0.5, 1)); }
  const LB = D.lid, BB = D.base;
  const cy = BB.bd/2, onZ = BB.H + 2*T + 0.5;
  const poses = [new THREE.Vector3(0, cy + LB.bd/2, onZ + T), new THREE.Vector3(-(BB.X + LB.X + 90) - (1 - lf)*((BB.X + BB.H + BB.Rr + BB.Dp + BB.LW + BB.Hin) - BB.X + (LB.H + LB.R + LB.Hin) + 40), cy + LB.bd/2 - 40, T + LB.H*lf), new THREE.Vector3(0, cy + LB.bd/2, LB.H + T)];
  const k = Math.min(1.999, Math.max(0, S.lid)), i0 = Math.floor(k), u = k - i0, e = ez(u);
  const pa = poses[i0], pb2 = poses[i0 + 1]; const up = (i0 === 0 ? 220 : 60)*Math.sin(Math.PI*u);
  R.lidG.position.set(lerp(pa.x, pb2.x, e), lerp(pa.y, pb2.y, e), lerp(pa.z, pb2.z, e) + up);
  if (S.lid >= 2) R.lidG.position.copy(poses[2]);
  R.lidG.visible = !S.noLid;
  // base lifts onto the lid when it becomes a plinth
  b.root.position.z = S.lift;
  for (const id of CUT_IDS) if (b.mesh[id]) b.mesh[id].visible = !S.cut;
  // near long wall fades (never disappears) so the support feet can be seen dropping into the ledge slots
  const g = S.ghost || 0;
  for (const id of GHOST_IDS){ const m = b.mesh[id]; if (!m) continue; const ud = m.userData;
    if (g > 0.01){ if (!ud.norm) ud.norm = m.material; if (!ud.gm || ud.gsrc !== ud.norm[0]){ ud.gsrc = ud.norm[0]; ud.gm = ud.norm.map(x => { const c = x.clone(); c.transparent = true; c.depthWrite = false; return c; }); }
      ud.gm.forEach(x => x.opacity = 1 - 0.72*g); m.material = ud.gm; m.castShadow = false; }
    else if (ud.norm){ m.material = ud.norm; m.castShadow = true; } }
  b.root.updateMatrixWorld(true);
  // trainers
  const sh = D.shoe;
  for (let k2 = 0; k2 < 2; k2++){
    const s = R.shoes[k2], sx = k2 === 0 ? 1 : -1;
    const packed = new THREE.Matrix4().compose(new THREE.Vector3(sx*(sh.W/2 + 3), k2 === 0 ? 17 : BB.bd - 17, T + 0.5 + S.lift), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), k2 === 0 ? 0 : Math.PI), new THREE.Vector3(1, 1, 1));
    const slot = 1 - k2;   // right-hand shoe goes to the far spot, left-hand to the near one, so their paths never cross
    const table = new THREE.Matrix4().compose(new THREE.Vector3(BB.X + 120 + slot*(sh.W + 30), -40 + slot*30, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), d2r(-8)), new THREE.Vector3(1, 1, 1));
    const o = p.world('top', sx*(sh.W/2 + 5.5), 14, 0), ax = p.world('top', sx*(sh.W/2 + 5.5) + 1, 14, 0).sub(o).normalize(), ay = p.world('top', sx*(sh.W/2 + 5.5), 15, 0).sub(o).normalize();
    let az = new THREE.Vector3().crossVectors(ax, ay); if (az.z < 0){ az.negate(); ax.negate(); }
    const disp = new THREE.Matrix4().makeBasis(ax, ay, az).setPosition(o.add(az.clone().multiplyScalar(0.3)));
    const lag = (k, u) => k ? seg(u, 0.3, 1) : seg(u, 0, 0.7);
    const m = S.shoes <= 1 ? blendM(packed, table, lag(k2, S.shoes), 260 + k2*40) : blendM(table, disp, lag(1 - k2, S.shoes - 1), 240 + k2*40);
    s.matrixAutoUpdate = false; s.matrix.copy(m); s.matrixWorldNeedsUpdate = true; s.visible = S.shoesVis > 0.5 && S.showShoes !== false;
  }
}
function blendM(a, b, u, arc){ const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), sa = new THREE.Vector3(), pb = new THREE.Vector3(), qb = new THREE.Quaternion(), sb = new THREE.Vector3();
  a.decompose(pa, qa, sa); b.decompose(pb, qb, sb); const e = ez(u);
  const p = pa.clone().lerp(pb, e); p.z += arc*Math.sin(Math.PI*u); return new THREE.Matrix4().compose(p, qa.clone().slerp(qb, e), new THREE.Vector3(1, 1, 1)); }

/* ---------------- player ---------------- */
const TH = 12, OPEN = -15, TABSIGN = window.OD_TABSIGN || -1;
const USE = [
  {t: 'Arrives as a shoebox', b: 'A normal looking shoebox with a lid. Inside, a printed platform lies flat on two ledges above the trainers.', k: [[0, {}]]},
  {t: 'Lid off, trainers out', b: 'The platform is hinged at the front. Swing it up, lift the trainers out, then let it fall back onto the ledges.', k: [[0, {}], [0.22, {lid: 1}], [0.42, {plat: OPEN}], [0.78, {shoes: 1}], [1, {plat: 90}]]},
  {t: 'Lift the rear edge', b: 'Flip up the pull tab on the back of the platform and lift. Its front stays on the hinge; the rear edge comes up.', k: [[0, {}], [0.3, {tab: 1}], [1, {plat: 45}]]},
  {t: 'Fold down the supports', b: 'Two supports fold down from under the platform and their feet open out. Lower it: the feet land on the side ledges and their tabs drop into the dark slots, locking the platform at 12°.', k: [[0, {shoesVis: 0}], [0.2, {plat: 30}], [0.48, {sup: 1}], [0.62, {flange: 1, ftab: 1}], [0.7, {ghost: 1}], [0.88, {plat: 90 - TH}], [1, {ghost: 0}]]},
  {t: 'Put your pair on show', b: 'Stand the box on its own lid as a plinth and set the trainers side by side, toes on the printed line.', k: [[0, {shoesVis: 1}], [0.2, {lift: 'LIFT'}], [0.5, {lid: 2}], [1, {shoes: 2}]]}];
const MAKE = [
  {t: 'Three flat parts arrive', b: 'The base and lid come flat. The platform comes pre-glued to the base, folded flat with its supports tucked under.', k: [[0, {}]]},
  {t: 'Raise the end walls', b: 'Swing the platform out of the way, fold up the two end walls and turn their corner flaps in.', k: [[0, {}], [0.35, {plat: 0}], [0.75, {walls: 90}], [1, {ears: 90}]]},
  {t: 'Fold the long walls and ledges', b: 'Each long wall folds up over the glued corner flaps, then over at the rim and down inside to make the ledge the platform rests on. The inner wall locks into the floor with two tabs.', k: [[0, {}], [0.4, {sides: 90}], [1, {roll: 1}]]},
  {t: 'Lower the platform', b: 'Fold the pull tab down flat and swing the platform onto the two ledges. Its folded edges sit on the ledges, just below the rim.', k: [[0, {}], [0.3, {tab: 2}], [1, {plat: 90}]]},
  {t: 'Fold the lid', b: 'A standard telescoping shoebox lid: walls up, corner flaps glued inside the side walls.', k: [[0, {}], [1, {lidFold: 1}]]},
  {t: 'Pack and close', b: 'Lift the platform, pack the pair under it, lower it and put the lid on. It closes like any shoebox.', k: [[0, {}], [0.25, {plat: OPEN}], [0.5, {shoesVis: 1}], [0.7, {plat: 90}], [1, {lid: 0}]]},
  {t: 'Add your branding', b: 'Every outside face is printable. Shown here in adidas black; the same box takes any brand\'s artwork.', k: [[0, {}], [0.5, {brand: 1}], [1, {}]]}];
const MODES = {use: {steps: USE, s0: {}}, make: {steps: MAKE, s0: FLAT}};
function views(mode){
  if (mode === 'use') return [{az: -58, el: 26, m: 0.95}, {az: -66, el: 36, m: 0.95}, {az: 128, el: 30, m: 0.9}, {focus: 'base', az: 42, el: 24, m: 1.5}, {az: -56, el: 18, m: 1.02}];
  return [{az: -90, el: 62, m: 0.92}, {az: -62, el: 30, m: 0.95}, {az: -112, el: 34, m: 0.95}, {az: -60, el: 34, m: 0.95}, {az: -70, el: 30, m: 0.95}, {az: -58, el: 28, m: 0.95}, {az: -30, el: 22, m: 0.9}];
}
window.mountOD = function(el, opts){
  opts = Object.assign({mode: 'use', size: 'M', theme: 'adidas', orbit: true}, opts || {});
  const DATA = window.OD_DATA;
  el.innerHTML = `<div class="player dz">
    <div class="stage"><canvas aria-label="Interactive 3D model of the On Display shoebox"></canvas><span class="count"></span><span class="load">Loading…</span>
      <button class="navbtn prev" data-a="prev" aria-label="Previous step">←</button><button class="navbtn next" data-a="next" aria-label="Next step">→</button>
      ${opts.mode === 'use' ? `<div class="brandbar"><div class="seg" data-g="theme"><button data-v="plain">Any brand</button><button data-v="adidas">adidas</button><button data-v="nike">Nike</button></div><a class="yours" href="enquiry.html">Your brand →</a></div>` : ''}
    <div class="talk">
      <div class="steps"></div>
      <p class="desc"></p>
      <div class="ctrl"><button data-a="prev">← Back</button><button class="primary" data-a="next">Next step →</button><span class="stepof"></span><button data-a="replay">Replay</button>
        <label class="rot"><span>Rotate</span><input type="range" min="-80" max="80" value="0" step="1" aria-label="Rotate view"></label>
        ${opts.mode === 'use' ? '<label class="rot chk"><input type="checkbox" class="shoesbox" checked><span>Show trainers</span></label>' : ''}</div>
    </div></div></div>`;
  const cv = el.querySelector('canvas'), count = el.querySelector('.count'), load = el.querySelector('.load'), stepsEl = el.querySelector('.steps'), descEl = el.querySelector('.desc');
  const renderer = new THREE.WebGLRenderer({canvas: cv, antialias: true, preserveDrawingBuffer: !!opts.capture});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.setClearColor(0xeae5df, 1);
  const scene = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(26, 1, 5, 20000); cam.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f70, 0.75));
  const key = new THREE.DirectionalLight(0xfff4e6, 1.0); key.position.set(-700, -1000, 1500); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, {left: -900, right: 900, top: 900, bottom: -900, near: 100, far: 5000}); key.shadow.bias = -0.0004; key.shadow.radius = 5; scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(900, -200, 600); scene.add(fill);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.ShadowMaterial({opacity: 0.16})); ground.position.z = -0.2; ground.receiveShadow = true; scene.add(ground);
  const ctrl = (THREE.OrbitControls && opts.orbit) ? new THREE.OrbitControls(cam, cv) : null;
  if (ctrl){ ctrl.enableDamping = true; ctrl.enablePan = false; ctrl.enableZoom = false; ctrl.minDistance = 300; ctrl.maxDistance = 4000; }
  let world = null, R = null, D = null, steps = [], CV = [], cur = 0, anim = null, camAnim = null, state = null, camV = null, azOff = 0, showShoes = true;
  const loadImg = src => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = src; });
  const IM = {};
  const mode = MODES[opts.mode];
  const fix = (D, p) => { const o = Object.assign({}, p); if (o.lift === 'LIFT') o.lift = D.lid.H + D.T; return o; };
  function endState(i){ let s = Object.assign({}, S0, mode.s0); for (let k = 0; k <= i; k++) for (const [, p] of steps[k].k) Object.assign(s, fix(D, p)); return s; }
  function sample(i, u){ const base = i ? endState(i - 1) : Object.assign({}, S0, mode.s0); const out = Object.assign({}, base);
    for (const name of Object.keys(base)){ let t0 = 0, v0 = base[name];
      for (const [t, p0] of steps[i].k){ const p = fix(D, p0); if (!(name in p)) continue; if (u >= t){ t0 = t; v0 = p[name]; continue; } out[name] = lerp(v0, p[name], ez((u - t0)/(t - t0))); v0 = null; break; }
      if (v0 !== null) out[name] = v0; }
    return out; }
  function place(){ const v = camV; const t = new THREE.Vector3(v.x, v.y, v.z), az = (v.az + azOff)*Math.PI/180, e = v.el*Math.PI/180;
    cam.position.set(t.x + v.r*Math.cos(e)*Math.cos(az), t.y + v.r*Math.cos(e)*Math.sin(az), t.z + v.r*Math.sin(e)); cam.lookAt(t);
    key.position.set(t.x - 700, t.y - 1000, t.z + 1500); key.target.position.copy(t);
    if (ctrl){ ctrl.target.copy(t); ctrl.update(); } }
  const mixV = (a, b, e) => { const o = {}; for (const k of ['r', 'el', 'x', 'y', 'z']) o[k] = lerp(a[k], b[k], e); o.az = a.az + ((b.az - a.az + 540) % 360 - 180)*e; return o; };
  function fitView(v, st){ apply(R, Object.assign({}, st, {showShoes})); world.updateMatrixWorld(true);
    const b = new THREE.Box3(), tmp = new THREE.Box3(); const obj = v.focus === 'base' ? R.base.root : world;
    obj.traverseVisible(o => { if (o.isMesh){ if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); b.union(tmp); } });
    const c = b.getCenter(new THREE.Vector3()), rad = b.getBoundingSphere(new THREE.Sphere()).radius;
    const asp = Math.max(0.6, (cv.clientWidth || 600)/(cv.clientHeight || 560)), f = d2r(26), hf = 2*Math.atan(Math.tan(f/2)*asp);
    const r = v.r || rad/Math.sin(Math.min(f, hf)/2)*(v.m || 0.65);
    return {r, az: v.az, el: v.el, x: c.x, y: c.y, z: c.z}; }
  function setUI(){ stepsEl.querySelectorAll('.step').forEach((b, j) => b.setAttribute('aria-current', j === cur)); count.textContent = `Step ${cur + 1} of ${steps.length}`; descEl.textContent = steps[cur].b;
    el.querySelector('.ctrl [data-a="next"]').textContent = cur === steps.length - 1 ? 'Back to start ↺' : 'Next step →';
    el.querySelector('.stepof').textContent = `${cur + 1} / ${steps.length}`; el.querySelector('.navbtn.prev').disabled = cur === 0;
    el.querySelector('.navbtn.next').textContent = cur === steps.length - 1 ? '↺' : '→'; el.classList.remove('nudge');
    el.querySelectorAll('.seg button').forEach(b => { const g = b.parentNode.dataset.g; b.setAttribute('aria-pressed', b.dataset.v === opts[g]); }); }
  function rebuild(){ if (world){ scene.remove(world); world.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    world = new THREE.Group(); scene.add(world); D = DATA[opts.size] || DATA[Object.keys(DATA)[0]]; R = build(world, D, opts.theme, IM);
    steps = mode.steps;
    CV = views(opts.mode).map((v, i) => fitView(v, endState(i)));
    stepsEl.innerHTML = steps.map((s, i) => `<button class="step" data-i="${i}"><span class="n">${String(i + 1).padStart(2, '0')}</span><h3>${s.t}</h3></button>`).join('');
    stepsEl.querySelectorAll('.step').forEach(b => b.onclick = () => { const i = +b.dataset.i; if (i === cur + 1 || i === cur) go(i); else jump(i); });
    cur = Math.min(cur, steps.length - 1); state = endState(cur); apply(R, Object.assign({}, state, {showShoes})); camV = CV[cur]; anim = null; camAnim = null; place(); setUI(); }
  function go(i){ cur = Math.max(0, Math.min(steps.length - 1, i)); setUI(); const from = Object.assign({}, camV);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches){ state = endState(cur); camV = CV[cur]; place(); return; }
    anim = {kind: 'step', i: cur, t0: performance.now(), ms: opts.mode === 'make' ? 3400 : 3000}; camAnim = {from, to: CV[cur], t0: performance.now(), ms: 1500}; }
  function jump(i){ cur = i; setUI(); anim = {kind: 'blend', from: Object.assign({}, state), to: endState(i), t0: performance.now(), ms: 1200}; camAnim = {from: Object.assign({}, camV), to: CV[i], t0: performance.now(), ms: 1200}; }
  const prevF = () => jump(Math.max(0, cur - 1)), nextF = () => cur === steps.length - 1 ? jump(0) : go(cur + 1);
  el.querySelectorAll('[data-a="prev"]').forEach(b => b.onclick = prevF); el.querySelectorAll('[data-a="next"]').forEach(b => b.onclick = nextF);
  // arrow keys step the walkthrough that is on screen
  document.addEventListener('keydown', e => { if (/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) return; const r = el.getBoundingClientRect();
    if (r.top > innerHeight*0.5 || r.bottom < innerHeight*0.5) return; if (e.key === 'ArrowRight'){ e.preventDefault(); nextF(); } else if (e.key === 'ArrowLeft'){ e.preventDefault(); prevF(); } });
  el.querySelector('[data-a="replay"]').onclick = () => { state = cur ? endState(cur - 1) : endState(0); go(cur); };
  el.querySelector('.rot input[type=range]').addEventListener('input', e => { azOff = +e.target.value; place(); });
  const sb = el.querySelector('.shoesbox'); if (sb) sb.addEventListener('change', e => { showShoes = e.target.checked; });
  el.querySelectorAll('.seg button').forEach(b => b.onclick = () => { opts[b.parentNode.dataset.g] = b.dataset.v; rebuild(); });
  function resize(){ const w = cv.clientWidth, h = cv.clientHeight; if (!w) return; if (cv.width !== Math.round(w*renderer.getPixelRatio())){ renderer.setSize(w, h, false); cam.aspect = w/h; cam.updateProjectionMatrix(); } }
  function tick(t){ if (!el.isConnected){ renderer.dispose(); return; }
    resize();
    if (anim){ const u = cl((t - anim.t0)/anim.ms);
      if (anim.kind === 'step') state = sample(anim.i, u); else { const e = ez(u); state = {}; for (const k in anim.to) state[k] = lerp(anim.from[k], anim.to[k], e); }
      if (u >= 1){ anim = null; el.classList.add('nudge'); } }
    if (camAnim){ const u = cl((t - camAnim.t0)/camAnim.ms); camV = mixV(camAnim.from, camAnim.to, ez(u)); place(); if (u >= 1) camAnim = null; }
    if (R) apply(R, Object.assign({}, state, {showShoes}));
    if (ctrl) ctrl.update(); renderer.render(scene, cam); requestAnimationFrame(tick); }
  const start = () => { load.textContent = ''; rebuild(); if (opts.autoplay !== false && opts.mode === 'use'){ setTimeout(() => { if (cur === 0) go(1); }, 900); } requestAnimationFrame(tick); };
  Promise.race([Promise.all([loadImg('adidas_logo.png'), loadImg('img/tex_nike_front.jpg'), loadImg('img/tex_nike_side.jpg')]).then(([a, b, c]) => { IM.logo = a; IM.nf = b; IM.ns = c; }), new Promise(r => setTimeout(r, 4000))])
    .then(() => (document.fonts && document.fonts.ready) || null).then(start);
  el.__od = {sampleAt: (i, u) => { anim = null; camAnim = null; cur = i; state = sample(i, u); camV = CV[i]; place(); setUI(); }, CV: () => CV, setState: s => { anim = null; state = Object.assign({}, S0, mode.s0, s); }, setView: v => { camAnim = null; camV = v; place(); }, renderer, scene, cam, get R(){ return R; }, endState: i => endState(i), opts};
};
window.OD_MODEL = {build, apply, S0, FLAT, netBounds, buildTree, USE, MAKE};
})();
