// Hızlı denetimler (CI'da ve yerelde): sözdizimi, manifest, yerelleştirme anahtarları, modül adları.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

const root = new URL("../zotero-hafif/", import.meta.url).pathname;
let errors = 0;
const fail = (msg) => { console.error("✗ " + msg); errors++; };
const ok = (msg) => console.log("✓ " + msg);

function walk(dir, out = []) {
	for (const f of readdirSync(dir)) {
		const p = join(dir, f);
		if (statSync(p).isDirectory()) {
			if (f !== "lib" && f !== "dist") walk(p, out);
		}
		else out.push(p);
	}
	return out;
}
const files = walk(root);

// 1. Sözdizimi
const js = files.filter(f => /\.(js|mjs)$/.test(f));
for (const f of js) {
	try {
		execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
	}
	catch (e) {
		fail(`sözdizimi: ${relative(root, f)}\n${e.stderr}`);
	}
}
ok(`${js.length} JS dosyası sözdizimi denetimi`);

// 2. Manifest
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) fail("manifest: sürüm x.y.z değil");
if (!manifest.applications?.zotero?.id) fail("manifest: eklenti kimliği yok");
if (/localhost/.test(manifest.applications?.zotero?.update_url || "")) fail("manifest: update_url localhost gösteriyor");
ok(`manifest ${manifest.version}`);

// 3. Yerelleştirme: her dilde aynı anahtarlar; koddaki l10nID'lerin hepsi tanımlı
const ftlKeys = (p) => new Set([...readFileSync(p, "utf8").matchAll(/^([a-z][\w-]*)\s*=/gm)].map(m => m[1]));
const locales = readdirSync(join(root, "locale"));
const sets = Object.fromEntries(locales.map(l => [l, ftlKeys(join(root, "locale", l, "hafif.ftl"))]));
const base = sets["tr-TR"] || Object.values(sets)[0];
for (const [l, s] of Object.entries(sets)) {
	for (const k of base) if (!s.has(k)) fail(`${l}: eksik çeviri ${k}`);
	for (const k of s) if (!base.has(k)) fail(`${l}: fazladan anahtar ${k}`);
}
const used = new Set();
for (const f of js) {
	const src = readFileSync(f, "utf8");
	for (const m of src.matchAll(/l10nID:\s*"([\w-]+)"/g)) used.add(m[1]);
	for (const m of src.matchAll(/\.t\("([\w-]+)"/g)) used.add(m[1]);
}
for (const k of used) if (!base.has(k)) fail(`çevirisi olmayan anahtar: ${k}`);
ok(`yerelleştirme: ${locales.join(", ")} · ${base.size} anahtar · kodda ${used.size} kullanım`);

// 4. Hafif.load("x") ile çağrılan her modülün dosyası var ve kendini doğru adla kaydediyor
const modDir = join(root, "content", "modules");
const mods = new Set(readdirSync(modDir).map(f => f.replace(/\.js$/, "")));
for (const f of js) {
	const src = readFileSync(f, "utf8");
	for (const m of src.matchAll(/(?:Hafif|this)\.load\("([\w]+)"\)/g)) {
		if (!mods.has(m[1])) fail(`${relative(root, f)}: bilinmeyen modül "${m[1]}"`);
	}
}
for (const m of mods) {
	const src = readFileSync(join(modDir, m + ".js"), "utf8");
	if (!src.includes(`Hafif.modules.${m} = {`)) fail(`modül ${m}.js kendini Hafif.modules.${m} olarak kaydetmiyor`);
}
ok(`${mods.size} modül`);

// 5. Varsayılan ayarlar: koddaki pref("x") anahtarları prefs.js'te tanımlı mı (yalnızca uyarı)
const defaults = new Set([...readFileSync(join(root, "prefs.js"), "utf8").matchAll(/extensions\.hafif\.(\w+)/g)].map(m => m[1]));
const prefUsed = new Set();
for (const f of js) for (const m of readFileSync(f, "utf8").matchAll(/\bpref\("(\w+)"/g)) prefUsed.add(m[1]);
const undef = [...prefUsed].filter(k => !defaults.has(k));
if (undef.length) console.log(`ℹ varsayılanı tanımsız ayarlar (kodda yedek değer kullanılıyor): ${undef.join(", ")}`);

if (errors) {
	console.error(`\n${errors} hata`);
	process.exit(1);
}
console.log("\nBütün denetimler geçti.");
