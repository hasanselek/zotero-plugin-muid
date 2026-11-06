// Modülleri Zotero olmadan sınamak için küçük bir ortam: dosya bir vm bağlamına yüklenir,
// Hafif ve Zotero'nun yalnızca saf işlevlerin kullandığı parçaları taklit edilir.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../zotero-hafif/content/modules/", import.meta.url);

export function load(...names) {
	const prefs = {};
	const ctx = {
		console,
		Zotero: { isMac: false, isWin: false, version: "7.0.0", debug() {}, logError() {} },
		Services: {},
		Hafif: {
			modules: {},
			log() {},
			pref: (k, v) => (v === undefined ? prefs[k] : (prefs[k] = v)),
			load(n) {
				if (!this.modules[n]) vm.runInContext(readFileSync(new URL(n + ".js", root), "utf8"), ctx, { filename: n + ".js" });
				return this.modules[n];
			},
			t: (id, args, fb) => fb ?? id,
		},
	};
	vm.createContext(ctx);
	for (const n of names) ctx.Hafif.load(n);
	return { Hafif: ctx.Hafif, prefs, ctx };
}
