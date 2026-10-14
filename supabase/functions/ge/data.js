'use strict';
// ===== Galaxy Empire Remake – Spieldaten (Werte gem. GE_SPEC.md) =====
var GE = (typeof module!=='undefined') ? (module.exports={}) : (window.GE={});
GE.RES = {m:'Metall',k:'Kristall',g:'Gas',e:'Energie',dm:'Dunkle Materie'};

// Gebäude: c=[M,K,G], f=Faktor, req, img = Panoramabild, pano = Hotspot
GE.BUILD = {
 metal_mine:{n:'Metallmine',c:[60,15,0],f:1.5,img:'Bergbau',d:'Fördert Metall aus der Planetenkruste. Grundlage jeder Wirtschaft.',prod:'m'},
 crystal_mine:{n:'Kristallmine',c:[48,24,0],f:1.6,img:'Schmiede',d:'Baut Kristall ab – in Galaxy Empire der Engpass-Rohstoff.',prod:'k'},
 gas_mine:{n:'Gasförderung',c:[225,75,0],f:1.5,img:'Raffinerie',d:'Gewinnt Gas aus der Atmosphäre. Kalte Planeten fördern mehr.',prod:'g'},
 power:{n:'Kraftwerk',c:[75,30,0],f:1.5,img:'Kraftwerk',d:'Erzeugt Energie für Minen und Anlagen. Energietechnik steigert die Leistung.',prod:'e'},
 robotics:{n:'Roboterfabrik',c:[400,120,200],f:2,img:'Roboter_Labor',d:'Roboter beschleunigen den Bau aller Gebäude.'},
 nanite:{n:'Nanitenfabrik',c:[400000,200000,60000],f:2,img:'KI_Center',req:{robotics:8,computer:8},d:'Halbiert pro Stufe die Bauzeit von Gebäuden, Schiffen und Verteidigung.'},
 shipyard:{n:'Raumschiffwerft',c:[400,200,100],f:2,img:'Werft',req:{robotics:2},d:'Baut Schiffe und Verteidigungsanlagen. Jede Stufe verkürzt die Bauzeit.'},
 lab:{n:'Forschungslabor',c:[200,400,200],f:2,img:'Forschung',d:'Ermöglicht Forschung. Höhere Stufen erforschen schneller und schalten Technologien frei.'},
 store:{n:'Lager',c:[1000,500,250],f:2,img:'Lager',grp:'store',d:'Ein Lager für alle Rohstoffe: erhöht die Kapazität für Metall, Kristall und Gas.'},
 radar:{n:'Radaranlage',c:[20000,20000,1000],f:2,req:{shipyard:1},d:'Erkennt anrückende feindliche Flotten. Höhere Stufen zeigen Ankunft und Schiffstypen.'},
 alliance:{n:'Allianzdepot',c:[2000,4000,0],f:2,img:'Allianzzentrum',d:'Zentrale für Allianzen. Ermöglicht Beitritt und Gründung einer Allianz.'},
 galacto:{n:'Galactonit-Forschungszentrum',c:[10000,20000,5000],f:2,img:'Waffen',req:{lab:3},d:'Verarbeitet Galactonit. Jede Stufe schaltet einen Sockel für Edelsteine frei.'},
 terraformer:{n:'Terraformer',c:[0,50000,100000],f:2,req:{robotics:8,energy:8},d:'Formt die Planetenkruste um: +5 Bauplätze (Felder) je Stufe. Belegt selbst kein Feld – auch auf vollen Planeten baubar.'},
 stargate:{n:'Sternentor',c:[2000000,4000000,2000000],f:2,req:{hyper:7,shipyard:10},d:'Verlegt Flotten ohne Flugzeit zwischen eigenen Planeten mit Sternentor.'},
 // Mond
 moon_base:{n:'Mondbasis',c:[20000,40000,20000],f:2,moon:1,d:'Jede Stufe schafft 3 zusätzliche Felder auf dem Mond.'},
 pioneer:{n:'Pionierlabor',c:[50000,100000,50000],f:2,moon:1,req:{moon_base:1},d:'Pionierforschung auf dem Mond: +2 % Kampfstärke aller Schiffe je Stufe.'},
 eux:{n:'EU-X Radarphalanx',c:[20000,40000,20000],f:2,moon:1,req:{moon_base:1},d:'Scannt Flottenbewegungen im Umkreis von (Stufe² − 1) Systemen.'},
 wormhole:{n:'Wurmlochgenerator',c:[2000000,4000000,2000000],f:2,moon:1,req:{moon_base:1,hyper:7},d:'Sprungtor: verlegt Schiffe sofort zwischen Monden.'}
};
// ===== v41 Freischalt-/Stufen-Tabelle (Fortschrittsbremse) =====
// Gilt für den NÄCHSTEN Ausbau auf Stufe L (bestehende Stufen bleiben erhalten). Wird von Client UND Server (Spielstand-Prüfung) benutzt.
//  Gebäude           | Freischaltung (Basis-req)            | Stufen-Regel für Stufe L
//  ------------------+--------------------------------------+-------------------------------------------------------------
//  alle (außer Robo) | –                                    | L ≤ 3 + 2·Roboterfabrik  (Roboterfabrik = Hauptgebäude)
//  Roboterfabrik     | –                                    | Kraftwerk ≥ L, Metallmine ≥ L; ab L6 Computertechnik ≥ L−4
//  Metallmine        | –                                    | Kraftwerk ≥ L−2; ab L10 Energietechnik ≥ ⌊L/4⌋
//  Kristallmine      | –                                    | Kraftwerk ≥ L−1; ab L10 Energietechnik ≥ ⌊L/4⌋
//  Gasförderung      | –                                    | Kraftwerk ≥ L;   ab L10 Energietechnik ≥ ⌊L/4⌋
//  Kraftwerk         | –                                    | max(Metall-, Kristallmine) ≥ L−3; ab L8 Energietechnik ≥ ⌊(L−6)/2⌋
//  Lager             | –                                    | max(Mine) ≥ 2·L−1
//  Forschungslabor   | Kapitel 2                            | L ≤ Roboterfabrik + 2; ab L6 Energietechnik ≥ L−3
//  Raumschiffwerft   | Roboterfabrik 2, Kapitel 3           | L ≤ Roboterfabrik + 2; ab L5 Verbrennungstriebwerk ≥ L−4
//  Radaranlage       | Werft 1, Kapitel 4                   | –
//  Galactonit-Zentrum| Labor 3, Kapitel 5                   | –
//  Sternentor        | Hyperraumtechnik 7, Werft 10, Kap. 6 | –
//  Allianzdepot      | Kapitel 7                            | –
//  Nanitenfabrik     | Roboterfabrik 8, Computertechnik 8   | L ≤ Roboterfabrik − 7
//  Terraformer       | Roboterfabrik 8, Energietechnik 8    | –
// Zusätzlich für JEDEN Ausbau: kein einzelner Kostenanteil darf die Lagerkapazität übersteigen („Lager zu klein“).
// Forschung: Stufe L verlangt Forschungslabor ≥ ⌈L/2⌉ (plus die Basis-Voraussetzungen in GE.TECH[id].req).
GE.LVRULE={
 _all:(L,b)=>[['robotics',Math.ceil((L-3)/2)]],
 robotics:(L)=>[['power',L],['metal_mine',L]].concat(L>=6?[['computer',L-4]]:[]),
 metal_mine:(L)=>[['power',L-2]].concat(L>=10?[['energy',Math.floor(L/4)]]:[]),
 crystal_mine:(L)=>[['power',L-1]].concat(L>=10?[['energy',Math.floor(L/4)]]:[]),
 gas_mine:(L)=>[['power',L]].concat(L>=10?[['energy',Math.floor(L/4)]]:[]),
 power:(L)=>[['@mine2',L-3]].concat(L>=8?[['energy',Math.floor((L-6)/2)]]:[]),
 store:(L)=>[['@mine',2*L-1]],
 lab:(L)=>[['robotics',L-2]].concat(L>=6?[['energy',L-3]]:[]),
 shipyard:(L)=>[['robotics',L-2]].concat(L>=5?[['combustion',L-4]]:[]),
 nanite:(L)=>[['robotics',L+7]]
};
GE.PLANET_B=['metal_mine','crystal_mine','gas_mine','power','store','robotics','nanite','shipyard','lab','radar','alliance','galacto','terraformer','stargate'];
GE.MOON_B=['moon_base','robotics','shipyard','pioneer','eux','wormhole'];
// Panorama-Hotspots (Bilder aus webapp/assets/b)
GE.PANO={Bergbau:'metal_mine',Schmiede:'crystal_mine',Raffinerie:'gas_mine',Kraftwerk:'power',Roboter_Labor:'robotics',KI_Center:'nanite',Werft:'shipyard',Forschung:'lab',Lager:'store',Allianzzentrum:'alliance',Waffen:'galacto',Verteidigung:'@defense'};

// Forschung: cat basic/adv/combat
GE.TECH = {
 energy:{n:'Energietechnik',cat:'Basis',c:[0,800,400],req:{lab:1},d:'Steigert die Leistung des Kraftwerks. Voraussetzung vieler Technologien.'},
 laser:{n:'Lasertechnik',cat:'Basis',c:[200,100,0],req:{lab:1,energy:2},d:'Gebündeltes Licht – Grundlage der Laserwaffen.'},
 ion:{n:'Ionentechnik',cat:'Basis',c:[1000,300,100],req:{lab:4,laser:5,energy:4},d:'Beschleunigte Ionen für Waffen und Kreuzer.'},
 hyper:{n:'Hyperraumtechnik',cat:'Basis',c:[0,4000,2000],req:{lab:7,energy:5,shielding:5},d:'Erschließt die vierte und fünfte Dimension.'},
 plasma:{n:'Plasmatechnik',cat:'Basis',c:[2000,4000,1000],req:{lab:4,energy:8,laser:10,ion:5},d:'Plasma als Waffe. +1 % Metall-, +0,66 % Kristall-, +0,33 % Gasproduktion je Stufe.'},
 espionage:{n:'Spionagetechnik',cat:'Fortgeschritten',c:[200,1000,200],req:{lab:3},d:'Bessere Spionageberichte. Ab Stufe 6 höhere Rohstoff-Fundchance im Nebel.'},
 computer:{n:'Computertechnik',cat:'Fortgeschritten',c:[0,400,600],req:{lab:1},d:'+1 Flottenslot je 2 Stufen (Nebelflüge zählen nicht).'},
 astro:{n:'Astrophysik',cat:'Fortgeschritten',c:[4000,8000,4000],f:1.75,req:{lab:3,espionage:4,impulse:3},d:'Je 2 Stufen +1 Kolonie (max. 8). Nebelflotten pro Planet: 2 ab St. 4, 3 ab St. 9, 4 ab St. 12.'},
 ultra:{n:'Ultratemperatur',cat:'Fortgeschritten',c:[5000,10000,5000],req:{lab:6,energy:6},d:'Hitzebeständige Kollektoren: +2 % Energieproduktion je Stufe.'},
 antigrav:{n:'Antigravitation',cat:'Fortgeschritten',c:[10000,20000,10000],req:{lab:8,hyper:5},d:'Hebt die Schwerkraft auf. Voraussetzung für Interceptor, Dreadnought und Iron Behemoth.'},
 alloy:{n:'Legierungsortung',cat:'Fortgeschritten',c:[3000,6000,2000],req:{lab:5,espionage:5},d:'Spürt Erzadern auf: +2 % Rohstoffausbeute im Nebel je Stufe.'},
 dynpower:{n:'Dynamische Energie',cat:'Fortgeschritten',c:[4000,4000,4000],req:{lab:5,energy:5},d:'Effizientere Triebwerke: −2 % Treibstoffverbrauch je Stufe (max. −40 %).'},
 combustion:{n:'Verbrennungstriebwerk',cat:'Kampf',c:[400,0,600],req:{lab:1,energy:1},d:'+10 % Geschwindigkeit für Transporter, Jäger, Recycler und Sonden.'},
 impulse:{n:'Impulstriebwerk',cat:'Kampf',c:[2000,4000,600],req:{lab:2,energy:1},d:'+20 % Geschwindigkeit für Schwere Jäger, Kreuzer, Bomber und Kolonieschiffe.'},
 hyperdrive:{n:'Hyperraumantrieb',cat:'Kampf',c:[10000,20000,6000],req:{lab:7,hyper:3},d:'+30 % Geschwindigkeit für Schlachtschiffe und Großkampfschiffe.'},
 weapons:{n:'Waffentechnik',cat:'Kampf',c:[800,200,0],req:{lab:4},d:'+10 % Angriffskraft aller Einheiten je Stufe.'},
 shielding:{n:'Schildtechnik',cat:'Kampf',c:[200,600,0],req:{lab:6,energy:3},d:'+10 % Schildstärke aller Einheiten je Stufe.'},
 armour:{n:'Strength (Panzerung)',cat:'Kampf',c:[1000,0,0],req:{lab:2},d:'+10 % Hüllenstruktur aller Einheiten je Stufe.'},
 discoverer:{n:'Discoverer',cat:'Galactonit',c:[0,15000,15000],req:{galacto:1},d:'Erhöht die Chance, bei NPC-Angriffen Galactonit-Splitter zu finden (+5 % je Stufe).'}
};

// Schiffe: c, hull(Struktur), sh, at, sp, cargo, fuel, drive
GE.SHIP = {
 sc:{n:'Kleiner Transporter',c:[2000,2000,0],sh:10,at:5,sp:5000,cargo:5000,fuel:10,drv:'combustion',req:{shipyard:2,combustion:2},d:'Wendiger Frachter für kleine Mengen. Ideal für die ersten Nebelflüge.'},
 lc:{n:'Großer Transporter',c:[6000,6000,0],sh:25,at:5,sp:7500,cargo:25000,fuel:50,drv:'combustion',req:{shipyard:4,combustion:6},d:'Großer Laderaum für Rohstofftransporte und Plünderungen.'},
 lf:{n:'Leichter Jäger',c:[3000,1000,0],sh:10,at:50,sp:12500,cargo:50,fuel:20,drv:'combustion',req:{shipyard:1,combustion:1},d:'Günstiger, schneller Jäger. Gutes Kanonenfutter.'},
 hf:{n:'Schwerer Jäger',c:[6000,4000,0],sh:25,at:150,sp:10000,cargo:100,fuel:75,drv:'impulse',req:{shipyard:3,armour:2,impulse:2},d:'Besser gepanzerter Jäger mit Schnellfeuer gegen Kleine Transporter.'},
 cr:{n:'Kreuzer',c:[20000,7000,2000],sh:50,at:400,sp:15000,cargo:800,fuel:300,drv:'impulse',req:{shipyard:5,impulse:4,ion:2},d:'Schneller Jägerjäger: Schnellfeuer 6 gegen Leichte Jäger, 10 gegen Raketenwerfer.'},
 bs:{n:'Schlachtschiff',c:[45000,15000,0],sh:200,at:1000,sp:10000,cargo:1500,fuel:500,drv:'hyperdrive',req:{shipyard:7,hyperdrive:4},d:'Rückgrat jeder Kampfflotte.'},
 ic:{n:'Interceptor',c:[30000,40000,15000],sh:400,at:700,sp:10000,cargo:750,fuel:250,drv:'hyperdrive',req:{shipyard:8,hyper:5,hyperdrive:5,laser:12,antigrav:1},d:'Seit 2013 berüchtigt: Schnellfeuer gegen fast alle mittleren Schiffe.'},
 bo:{n:'Bomber',c:[50000,25000,15000],sh:500,at:1000,sp:4000,cargo:500,fuel:1000,drv:'impulse',req:{shipyard:8,impulse:6,plasma:5},d:'Spezialist gegen Verteidigungsanlagen.'},
 de:{n:'Zerstörer',c:[60000,50000,15000],sh:500,at:2000,sp:5000,cargo:2000,fuel:1000,drv:'hyperdrive',req:{shipyard:9,hyperdrive:6,hyper:5},d:'Schweres Kriegsschiff mit enormer Feuerkraft.'},
 dn:{n:'Dreadnought',c:[5000000,4000000,1000000],sh:50000,at:200000,sp:100,cargo:1000000,fuel:1,drv:'hyperdrive',req:{shipyard:12,hyperdrive:7,hyper:6,antigrav:3},d:'Schwimmende Festung mit Schnellfeuer gegen nahezu alles.'},
 ib:{n:'Iron Behemoth',c:[10000000,8000000,3000000],sh:80000,at:300000,sp:80,cargo:2000000,fuel:1,drv:'hyperdrive',req:{shipyard:15,hyperdrive:9,antigrav:6},d:'Das Endgame-Schiff von Galaxy Empire. Stärker als jedes Dreadnought.'},
 rc:{n:'Recycler',c:[10000,6000,2000],sh:10,at:1,sp:2000,cargo:20000,fuel:300,drv:'combustion',req:{shipyard:4,combustion:6,shielding:2},d:'Sammelt Trümmerfelder ein – und ist das Arbeitspferd für Nebelflüge.'},
 pr:{n:'Spionagesonde',c:[0,1000,0],sh:0,at:0,sp:100000000,cargo:5,fuel:1,drv:'combustion',req:{shipyard:3,combustion:3,espionage:2},d:'Spioniert fremde Planeten aus. Viele Sonden bringen im Nebel mehr Schiffe.'},
 co:{n:'Kolonieschiff',c:[10000,20000,10000],sh:100,at:50,sp:2500,cargo:7500,fuel:1000,drv:'impulse',req:{shipyard:4,impulse:3},d:'Gründet eine neue Kolonie auf einer freien Position.'},
 ss:{n:'Solarsatellit',c:[0,2000,500],sh:1,at:1,sp:0,cargo:0,fuel:0,drv:null,req:{shipyard:1},d:'Liefert Energie abhängig von der Planetentemperatur. Kann nicht fliegen.'}
};
GE.DEF = {
 rl:{n:'Raketenwerfer',c:[2000,0,0],sh:20,at:80,req:{shipyard:1},d:'Einfache, günstige Verteidigung.'},
 ll:{n:'Leichtes Lasergeschütz',c:[1500,500,0],sh:25,at:100,req:{shipyard:2,energy:1,laser:3},d:'Solide Grundverteidigung.'},
 hl:{n:'Schweres Lasergeschütz',c:[6000,2000,0],sh:100,at:250,req:{shipyard:4,energy:3,laser:6},d:'Starker Laser gegen Jäger.'},
 gauss:{n:'MK2-Kanone',c:[20000,15000,2000],sh:200,at:1100,req:{shipyard:6,energy:6,weapons:3,shielding:1},d:'Schwere Projektilkanone.'},
 ionc:{n:'Ionengeschütz',c:[2000,6000,0],sh:500,at:150,req:{shipyard:4,ion:4},d:'Hoher Schild, schützt andere Anlagen.'},
 plasmat:{n:'Plasmawerfer',c:[50000,50000,30000],sh:300,at:3000,req:{shipyard:8,plasma:7},d:'Die stärkste Verteidigungsanlage.'},
 sdome:{n:'Kleine Schildkuppel',c:[10000,10000,0],sh:2000,at:1,max:1,req:{shipyard:1,shielding:2},d:'Schützt den ganzen Planeten. Nur einmal baubar.'},
 ldome:{n:'Große Schildkuppel',c:[50000,50000,0],sh:10000,at:1,max:1,req:{shipyard:6,shielding:6},d:'Massiver Planetenschild. Nur einmal baubar.'}
};
(function(){for(const t of [GE.SHIP,GE.DEF])for(const k in t)t[k].hull=t[k].c[0]+t[k].c[1];})();
// Schnellfeuer [OG]
GE.RF = {
 sc:{pr:5,ss:5}, lc:{pr:5,ss:5}, lf:{pr:5,ss:5}, hf:{sc:3,pr:5,ss:5}, cr:{lf:6,rl:10,pr:5,ss:5}, bs:{pr:5,ss:5},
 ic:{sc:3,lc:3,hf:4,cr:4,bs:7,pr:5,ss:5}, bo:{rl:20,ll:20,hl:10,ionc:10,pr:5,ss:5}, de:{ll:2,ic:2,pr:5,ss:5},
 dn:{lf:200,hf:100,cr:33,bs:30,ic:15,bo:25,de:5,sc:250,lc:250,rc:250,co:250,pr:1250,ss:1250,rl:200,ll:200,hl:100,gauss:50,ionc:100},
 ib:{lf:250,hf:120,cr:40,bs:35,ic:20,bo:30,de:8,dn:2,sc:300,lc:300,rc:300,co:300,pr:1500,ss:1500,rl:250,ll:250,hl:120,gauss:60,ionc:120,plasmat:5},
 rc:{pr:5,ss:5}, co:{pr:5,ss:5}
};
GE.COMMANDERS = {
 commander:{n:'Commander',d:'−10 % Bauzeit, +1 Bauschleifenplatz',p7:25,p30:100},
 technocrat:{n:'Technokrat',d:'−25 % Forschungszeit, +2 Spionagestufen',p7:20,p30:80},
 admiral:{n:'Admiral',d:'+2 Flottenslots, −10 % Bauzeit für Verteidigung',p7:20,p30:80},
 geologist:{n:'Geologe',d:'+10 % Rohstoffproduktion',p7:25,p30:100},
 engineer:{n:'Ingenieur',d:'Verteidigung verliert im Kampf nur 50 %',p7:25,p30:100},
 guider:{n:'Guider',d:'Rettet 35 % einer im Nebel zerstörten Flotte',p7:20,p30:80}
};
GE.ITEMS = {
 armor1:{n:'Schiffspanzerplatte Lv1',d:'+10 % Hülle aller Schiffe für 24 h',buff:'hull',v:0.10},
 armor2:{n:'Schiffspanzerplatte Lv2',d:'+20 % Hülle aller Schiffe für 24 h',buff:'hull',v:0.20},
 energy1:{n:'Energiegerät Lv1',d:'+10 % Energieproduktion für 24 h',buff:'energy',v:0.10},
 energy2:{n:'Energiegerät Lv2',d:'+20 % Energieproduktion für 24 h',buff:'energy',v:0.20},
 power1:{n:'Leistungsadapter Lv1',d:'+10 % Rohstoffproduktion für 24 h',buff:'prod',v:0.10},
 power2:{n:'Leistungsadapter Lv2',d:'+20 % Rohstoffproduktion für 24 h',buff:'prod',v:0.20},
 engine1:{n:'Triebwerkssystem Lv1',d:'+10 % Flottengeschwindigkeit für 24 h',buff:'speed',v:0.10},
 engine2:{n:'Triebwerkssystem Lv2',d:'+20 % Flottengeschwindigkeit für 24 h',buff:'speed',v:0.20}
};
GE.GEMS = {
 flame:{n:'Flammender Kristall',d:'Angriff',col:'#ff6a3d',stat:'at'},
 conc:{n:'Konzentrierter Kristall',d:'Panzerung',col:'#c9a36b',stat:'hull'},
 shield:{n:'Schildkristall',d:'Schild',col:'#4fc3ff',stat:'sh'},
 metal:{n:'Metallkristall',d:'Metallproduktion',col:'#c8d3e0',stat:'m'},
 crystal:{n:'Kristallkern',d:'Kristallproduktion',col:'#7af0ff',stat:'k'},
 gas:{n:'Gaskristall',d:'Gasproduktion',col:'#7dffb0',stat:'g'}
};
GE.NPC = [
 {lv:1,n:'Deportees',de:'Verbannte'},{lv:2,n:'The Purged Planet',de:'Der gesäuberte Planet'},
 {lv:3,n:'Pirate Haven',de:'Piratenhafen'},{lv:4,n:'Rebel Bastion',de:'Rebellenbastion'},{lv:5,n:'Imperial Ruins',de:'Imperiale Ruinen'}
];
GE.PTYPES=[
 {id:'heisser_planet',n:'Wüstenplanet'},{id:'kristallplanet',n:'Kristallwelt'},{id:'bewohnbarer_planet',n:'Dschungelplanet'},
 {id:'heimatwelt',n:'Terrawelt'},{id:'gasriese',n:'Gasplanet'},{id:'eisplanet',n:'Eisplanet'}];

// Aries-Tutorial (29 Aufgaben, Belohnungen gem. Wiki)
GE.TASKS = [
 {t:'Das erste Geschenk',d:'Hole dir dein Willkommensgeschenk ab.',r:{m:100,k:65,g:35,dm:23,cmd:['commander',3]}},
 {t:'Erste Minen',d:'Baue eine Metallmine und eine Kristallmine.',r:{m:400,k:200}},
 {t:'Mehr Metall',d:'Baue die Metallmine auf Stufe 2 aus.',r:{m:200,k:100}},
 {t:'Energie!',d:'Baue das Kraftwerk auf Stufe 2 aus.',r:{m:300,k:150}},
 {t:'Gas fördern',d:'Baue eine Gasförderung.',r:{m:250,k:100,g:200}},
 {t:'Produktion steuern',d:'Stelle die Produktion der Gasförderung auf 60 % (Gebäude antippen → Regler).',r:{m:3000,k:2000,g:1000,gal:10}},
 {t:'Roboter',d:'Baue die Roboterfabrik auf Stufe 2.',r:{m:4000,k:1000,g:800}},
 {t:'Werft & Abwehr',d:'Baue eine Raumschiffwerft und einen Raketenwerfer.',r:{m:4000,k:3000,g:2600,ships:{rl:1}}},
 {t:'Beschleunigen',d:'Beschleunige einen Bau oder eine Forschung mit Dunkler Materie.',r:{dm:5}},
 {t:'Space Store',d:'Öffne den Space Store.',r:{m:4000,k:4000,g:4000}},
 {t:'Lagerhaltung',d:'Baue das Lager für alle Rohstoffe.',r:{m:2000,k:2000,g:2000}},
 {t:'Dein Name',d:'Benenne deinen Planeten um (Planetenname oben antippen).',r:{m:1000,k:1500}},
 {t:'Gemeinsam stark',d:'Baue ein Allianzdepot und gründe eine Allianz.',r:{m:1000,dm:3}},
 {t:'Wissenschaft',d:'Forschungslabor auf Stufe 2 und Energietechnik erforschen.',r:{m:8000,k:8000,g:4000}},
 {t:'Erster Frachter',d:'Werft Stufe 2, Verbrennungstriebwerk Stufe 2 und ein Kleiner Transporter.',r:{m:15000,k:10000,g:5000,dm:5,ships:{lf:20}}},
 {t:'Spionage',d:'Baue eine Spionagesonde und spioniere den NPC „Deportees“ aus.',r:{m:16500,k:40000,g:10000,ships:{pr:2,lf:3}}},
 {t:'Erster Angriff',d:'Greife den NPC „The Purged Planet“ an.',r:{m:20000,k:10000,g:10000}},
 {t:'Der Nebel',d:'Erforsche Astrophysik und schicke eine Erkundungsflotte in den Nebel (Position 16).',r:{m:30000,k:30000,g:20000}},
 {t:'Kommandant',d:'Lege deinen Kommandantennamen fest (Einstellungen).',r:{dm:5}},
 {t:'Sicherung',d:'Exportiere deinen Spielstand (Einstellungen).',r:{dm:5}},
 {t:'Neue Welten',d:'Kolonieschiff bauen, Astrophysik Stufe 2 und eine Kolonie gründen.',r:{m:50000,k:50000,g:50000,ships:{co:1,sc:5}}},
 {t:'Versorgung',d:'Schicke einen Transport zu deiner Kolonie.',r:{m:20000,k:20000,g:10000}},
 {t:'Stationieren',d:'Stationiere eine Flotte auf deiner Kolonie.',r:{m:3000,k:3000,g:3000,ships:{lf:5}}},
 {t:'Raubzug',d:'Greife einen inaktiven Spielerplaneten an.',r:{m:30000,k:25000,g:30000,ships:{hf:2}}},
 {t:'Recycling',d:'Recycle ein Trümmerfeld.',r:{g:10000}},
 {t:'Frühwarnung',d:'Baue eine Radaranlage.',r:{m:50000,k:50000,g:50000,ships:{rl:15}}},
 {t:'Galactonit',d:'Galactonit-Forschungszentrum bauen und Discoverer Stufe 1 erforschen.',r:{k:15000,g:15000,gal:10}},
 {t:'Fusion',d:'Verschmelze Galactonit-Splitter zu einem Edelstein.',r:{gal:1}},
 {t:'Ausrüsten',d:'Setze einen Galactonit-Edelstein in einen Sockel ein.',r:{gal:40,gen:40,dm:5}}
];
GE.FAKE_NAMES=['Nyx','Vortex','Kraken','Orion77','StarLord','Helix','Nova','Zephyr','Titan','Aurora','Raven','Cobalt','Draco','Lyra','Phoenix','Spectre','Atlas','Valkyr','Quasar','Nebulon','Ragnar','Sol','Kestrel','Ion','Vega','Rigel','Hydra','Ember','Talon','Xeno','Odin','Jinx','Morpheus','Echo','Blitz','Mira','Corsair','Saber','Onyx','Pulsar'];
GE.ALLY_TAGS=['DARK','GEF','NOVA','ORB','PAX','RED','SOL','VOID','WOLF','XEN'];

GE.PLANET_POOL=['heisser_planet','kristallplanet','bewohnbarer_planet','heimatwelt','gasriese','eisplanet','p2_wueste','p2_toxisch','p2_ozean','p2_lava','p2_ringgas','p2_mondgrau','p2_tuerkis','p2_eisenrot'];
