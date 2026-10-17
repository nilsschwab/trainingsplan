/* ===================================================================
   BKS Trainingsplan — gemeinsamer Kern
   Fassung 16.10.2026

   Genutzt von:
   - trainingsplan.html   PC: A4-Vorlage zum Drucken und Speichern
   - tablet.html          Android-Tablet: Plan waehrend der Einweisung
   - app/index.html       Handy des Mitglieds

   Was hier steckt:
   - packen / auspacken: Plan -> JSON -> deflate -> base64url ("1..."),
     so passt er in einen Link, einen QR-Code oder eine Akten-Datei.
     Plan: { t:'plan', v:1, n:Name, p:Planname (z. B. "Oberkoerper", leer = ohne), d:Datum, b:"Erstellt von",
             x:{ c|g|k|f: [[Name, Serien, Wdh, Pause, Gewicht, Hinweis, Skizze], ...] } }
   - Skizzen: Striche auf einem Raster von 256 x 121 Punkten (das
     Seitenverhaeltnis des Skizzenfelds im Ausdruck, 58 x 27,5 mm),
     kompakt als Text: je Strich vier Zeichen Startpunkt, dann zwei
     Zeichen je Schritt, Striche durch Punkte getrennt.
   - Zeichenfeld: mit Stift, Finger oder Maus. Hat das Tablet einmal
     einen Stift gesehen, zaehlen Finger nicht mehr (Handballen).
   - aktenDatei: kleine HTML-Datei fuer die Mitgliederakte, oeffnet per
     Doppelklick die Vorlage mit dem Plan (siehe trainingsplan.html).
   =================================================================== */
var Kern = (function () {
  'use strict';

  // Ordner trainingsplan\ - lokal, auf dem Vorschau-Server oder online
  var ORDNER = new URL('./', document.currentScript.src).href;
  // Oeffentliche Adresse dieses Ordners: GitHub Pages, Repository nilsschwab/trainingsplan
  // (Entscheidung Nils 16.10.2026). Veroeffentlicht wird mit veroeffentlichen.ps1.
  // Achtung: Die Plaene auf dem Tablet haengen an dieser Adresse, Akten-Dateien merken sie sich.
  var OEFFENTLICH = 'https://nilsschwab.github.io/trainingsplan/';
  var ONLINE = true;    // seit 16.10.2026 veroeffentlicht (sonst zeigt der QR-Dialog einen Hinweis)
  // Links fuer andere (Handy des Mitglieds) muessen ins Netz zeigen, nie auf eine Datei
  var BASIS = location.protocol === 'file:' ? OEFFENTLICH : ORDNER;
  var QR_MAX = 2900;    // mehr Zeichen passen nicht in einen QR-Code

  /* ---------- Packen ---------- */
  async function packen(obj) {
    var roh = new Blob([new TextEncoder().encode(JSON.stringify(obj))]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    var bytes = new Uint8Array(await new Response(roh).arrayBuffer());
    var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return '1' + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function auspacken(text) {
    if (text[0] !== '1') throw new Error('Unbekannte Fassung');
    var b = text.slice(1).replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
    var bytes = Uint8Array.from(atob(b), function (c) { return c.charCodeAt(0); });
    var roh = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(roh).text());
  }
  // Findet den gepackten Plan in einem Link (#p=...) oder in einer Akten-Datei (PLAN = "...")
  function codeAus(text) {
    var m = String(text || '').match(/(?:[#&]p=|PLAN = ")([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  /* ---------- Skizzen ---------- */
  var SW = 256, SH = 121;
  var Z = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  // Douglas-Peucker: Punkte weglassen, die weniger als eps von der Linie abweichen
  function vereinfachen(p, eps) {
    if (p.length < 3) return p.slice();
    var a = p[0], b = p[p.length - 1], max = 0, idx = 0;
    var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    for (var i = 1; i < p.length - 1; i++) {
      // Geschlossener Strich (z. B. ein Kopf): Abstand zum Startpunkt statt zur Linie
      var d = len ? Math.abs(dy * p[i][0] - dx * p[i][1] + b[0] * a[1] - b[1] * a[0]) / len
                  : Math.hypot(p[i][0] - a[0], p[i][1] - a[1]);
      if (d > max) { max = d; idx = i; }
    }
    if (max <= eps) return [a, b];
    return vereinfachen(p.slice(0, idx + 1), eps).slice(0, -1).concat(vereinfachen(p.slice(idx), eps));
  }
  function skizzePacken(striche) {
    return striche.filter(function (s) { return s.length; }).map(function (s) {
      s = vereinfachen(s, 0.9);
      var cx = s[0][0], cy = s[0][1];
      var t = Z[cx >> 6] + Z[cx & 63] + Z[cy >> 6] + Z[cy & 63];
      for (var i = 1; i < s.length; i++) {
        var sx = cx, sy = cy, dx = s[i][0] - sx, dy = s[i][1] - sy;
        if (!dx && !dy) continue;
        // Schritte von hoechstens 30 Punkten, damit jeder in ein Zeichen passt
        var n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 30);
        for (var j = 1; j <= n; j++) {
          var nx = Math.round(sx + dx * j / n), ny = Math.round(sy + dy * j / n);
          t += Z[nx - cx + 32] + Z[ny - cy + 32]; cx = nx; cy = ny;
        }
      }
      return t;
    }).join('.');
  }
  function skizzeAuspacken(text) {
    if (!text) return [];
    return String(text).split('.').filter(function (t) { return t.length >= 4; }).map(function (t) {
      var x = Z.indexOf(t[0]) * 64 + Z.indexOf(t[1]), y = Z.indexOf(t[2]) * 64 + Z.indexOf(t[3]), s = [[x, y]];
      for (var i = 4; i + 1 < t.length; i += 2) { x += Z.indexOf(t[i]) - 32; y += Z.indexOf(t[i + 1]) - 32; s.push([x, y]); }
      return s;
    });
  }
  function striche2svg(striche) {
    return striche.map(function (s) {
      return s.length === 1 ? '<circle cx="' + s[0][0] + '" cy="' + s[0][1] + '" r="1.2" fill="#1d2333" stroke="none"/>'
                            : '<polyline points="' + s.map(function (q) { return q[0] + ',' + q[1]; }).join(' ') + '"/>';
    }).join('');
  }
  var STIFT = 'fill="none" stroke="#1d2333" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  // Fertige Skizze als SVG (Ausdruck, Handy)
  function skizzeSvg(text, klasse) {
    var st = skizzeAuspacken(text);
    if (!st.length) return '';
    return '<svg class="' + (klasse || 'skizze-bild') + '" viewBox="0 0 ' + SW + ' ' + SH + '" preserveAspectRatio="xMidYMid meet">' +
      '<g ' + STIFT + '>' + striche2svg(st) + '</g></svg>';
  }

  /* ---------- Zeichenfeld ---------- */
  var stiftGesehen = false;
  function Zeichenfeld(el, beiAenderung) {
    var striche = [], aktiv = null, linie = null;
    el.classList.add('zeichenfeld');
    el.innerHTML = '<svg viewBox="0 0 ' + SW + ' ' + SH + '" preserveAspectRatio="none" style="display:block;width:100%;height:100%;touch-action:none">' +
      '<g ' + STIFT + '></g></svg>';
    var svg = el.firstChild, g = svg.firstChild;
    function zeichnen() { g.innerHTML = striche2svg(striche); linie = null; }
    function punkt(e) {
      var r = svg.getBoundingClientRect();
      return [Math.max(0, Math.min(SW - 1, Math.round((e.clientX - r.left) / r.width * (SW - 1)))),
              Math.max(0, Math.min(SH - 1, Math.round((e.clientY - r.top) / r.height * (SH - 1))))];
    }
    svg.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'pen') stiftGesehen = true;
      if ((e.pointerType === 'touch' && stiftGesehen) || e.button > 0 || aktiv) return;
      e.preventDefault();
      try { svg.setPointerCapture(e.pointerId); } catch (x) {}
      aktiv = { id: e.pointerId, p: [punkt(e)] };
      striche.push(aktiv.p);
      linie = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      g.appendChild(linie);
      linie.setAttribute('points', aktiv.p[0].join(',') + ' ' + aktiv.p[0].join(','));
    });
    svg.addEventListener('pointermove', function (e) {
      if (!aktiv || e.pointerId !== aktiv.id) return;
      var p = punkt(e), l = aktiv.p[aktiv.p.length - 1];
      if (p[0] === l[0] && p[1] === l[1]) return;
      aktiv.p.push(p);
      if (linie) linie.setAttribute('points', aktiv.p.map(function (q) { return q.join(','); }).join(' '));
    });
    function fertig(e) {
      if (!aktiv || e.pointerId !== aktiv.id) return;
      striche[striche.length - 1] = vereinfachen(aktiv.p, 0.9);
      aktiv = null; zeichnen();
      if (beiAenderung) beiAenderung();
    }
    svg.addEventListener('pointerup', fertig);
    svg.addEventListener('pointercancel', fertig);
    return {
      get wert() { return skizzePacken(striche); },
      set wert(t) { striche = skizzeAuspacken(t); zeichnen(); },
      get leer() { return !striche.length; },
      rueckgaengig: function () { striche.pop(); zeichnen(); if (beiAenderung) beiAenderung(); },
      leeren: function () { striche = []; zeichnen(); if (beiAenderung) beiAenderung(); }
    };
  }

  /* ---------- Plan ohne Skizzen (fuer einen QR-Code, wenn es sonst zu lang wird) ---------- */
  function ohneSkizzen(plan) {
    var x = {};
    Object.keys(plan.x || {}).forEach(function (s) { x[s] = plan.x[s].map(function (z) { return z.slice(0, 6); }); });
    return Object.assign({}, plan, { x: x });
  }
  function hatSkizzen(plan) {
    return Object.keys(plan.x || {}).some(function (s) { return plan.x[s].some(function (z) { return z[6]; }); });
  }
  // Handy-Link; wird er fuer einen QR-Code zu lang, ohne Skizzen
  async function handyLink(plan) {
    var link = BASIS + 'app/#p=' + await packen(plan);
    if (link.length <= QR_MAX || !hatSkizzen(plan)) return { link: link, ohneSkizzen: false };
    var kurz = BASIS + 'app/#p=' + await packen(ohneSkizzen(plan));
    return { link: kurz, lang: link, ohneSkizzen: true };
  }

  /* ---------- Akten-Datei ----------
     Enthaelt nur den gepackten Plan. Doppelklick am PC: sucht im eigenen Pfad den
     OneDrive-Ordner und oeffnet von dort die Vorlage - klappt auf jedem PC, egal unter
     welchem Windows-Benutzer. Anderswo (Tablet, OneDrive im Browser): die Tablet-Seite online. */
  var ONEDRIVE = 'OneDrive - Bewegungszentrum für Körperwohl und Squash/';
  var VORLAGE = 'Claude Code/trainingsplan/trainingsplan.html';
  function aktenDatei(code, titel) {
    return '<!DOCTYPE html>\n<html lang="de"><head><meta charset="utf-8"><title>' + titel + '</title></head>\n' +
      '<body style="font-family:Segoe UI,system-ui,sans-serif;padding:40px;color:#12141c;line-height:1.5">\n' +
      '<p>Der Trainingsplan wird geöffnet …</p>\n' +
      '<script>\n// BKS-Trainingsplan. Der Plan steht nur in dieser Datei.\n' +
      'var PLAN = "' + code + '";\n' +
      'var ORDNER = "' + ONEDRIVE + '";\n' +
      'var hier = decodeURI(location.href), i = hier.indexOf(ORDNER);\n' +
      'location.replace((i >= 0 ? encodeURI(hier.slice(0, i + ORDNER.length) + "' + VORLAGE + '") : "' + OEFFENTLICH + 'tablet.html")' +
      ' + (PLAN ? "#p=" + PLAN : ""));\n' +
      '<\/script>\n</body></html>\n';
  }

  /* ---------- Neue Fassung laden ----------
     Die App auf dem Home-Bildschirm laeuft oft tagelang weiter und holt sich keine neue Fassung
     (Fall Nils, 17.10.2026: eine alte Fassung ohne Splits hat einen Plan ersetzt). Deshalb: beim
     Oeffnen und beim Zurueckkehren app/version.json fragen. Weicht der Stand ab, mit ?v=<stand>
     neu laden - die neue Adresse umgeht den Zwischenspeicher. veroeffentlichen.ps1 traegt den Stand
     ein; lokal steht dort noch der Platzhalter, dann passiert nichts. */
  // darf: optional; liefert false, solange nicht neu geladen werden soll (z. B. ungespeicherte Aenderungen am Tablet)
  function aufNeuePruefen(stand, darf) {
    if (!stand || stand.charAt(0) === '@' || location.protocol === 'file:') return;
    var pruefen = function () {
      if (darf && !darf()) return;
      fetch(ORDNER + 'app/version.json?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.stand || j.stand === stand) return;
          // Hoechstens alle zwei Minuten ein Versuch, damit nichts im Kreis laedt
          var merk = 'bks-neu-geladen', zuletzt = 0;
          try { zuletzt = +sessionStorage.getItem(merk) || 0; sessionStorage.setItem(merk, String(Date.now())); } catch (e) {}
          if (Date.now() - zuletzt < 120000) return;
          location.replace(location.pathname + '?v=' + encodeURIComponent(j.stand) + location.hash);
        })
        .catch(function () {});
    };
    pruefen();
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') pruefen(); });
  }

  function heute() { return new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  // z. B. "Trainingsplan Martina M. Oberkoerper (16.10.2026)"
  function dateiname(name, datum, plan) {
    return ('Trainingsplan ' + (name || 'ohne Name') + (plan ? ' ' + plan : '') + ' (' + (datum || heute()) + ')')
      .replace(/[^\wäöüÄÖÜß ().-]/g, '').replace(/\s+/g, ' ').trim();
  }

  return {
    ORDNER: ORDNER, OEFFENTLICH: OEFFENTLICH, ONLINE: ONLINE, BASIS: BASIS, QR_MAX: QR_MAX,
    packen: packen, auspacken: auspacken, codeAus: codeAus,
    skizzePacken: skizzePacken, skizzeAuspacken: skizzeAuspacken, skizzeSvg: skizzeSvg, Zeichenfeld: Zeichenfeld,
    handyLink: handyLink, ohneSkizzen: ohneSkizzen, aktenDatei: aktenDatei, heute: heute, dateiname: dateiname,
    aufNeuePruefen: aufNeuePruefen
  };
})();
