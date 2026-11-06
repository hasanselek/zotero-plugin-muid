// Zotero'nun otomatik güncelleme dosyasını (updates.json) üretir.
// Kullanım: node scripts/update-manifest.mjs <xpi-adresi> > updates.json
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const manifest = JSON.parse(readFileSync(new URL("../zotero-hafif/manifest.json", import.meta.url)));
const { id, strict_min_version, strict_max_version } = manifest.applications.zotero;
const [link, xpiPath] = process.argv.slice(2);
if (!link) {
	console.error("Kullanım: node scripts/update-manifest.mjs <xpi-adresi> [yerel-xpi]");
	process.exit(1);
}
const update = {
	version: manifest.version,
	update_link: link,
	applications: { zotero: { strict_min_version, strict_max_version } },
};
if (xpiPath) update.update_hash = "sha256:" + createHash("sha256").update(readFileSync(xpiPath)).digest("hex");
process.stdout.write(JSON.stringify({ addons: { [id]: { updates: [update] } } }, null, 2) + "\n");
