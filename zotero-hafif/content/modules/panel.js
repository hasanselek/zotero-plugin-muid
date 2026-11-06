/* Sade bilgi paneli: sağ paneldeki seçilen bölümleri (ve yan çubuktaki düğmelerini) gizler. */

Hafif.modules.panel = {
	SECTIONS: [
		["abstract", "Özet"],
		["attachments", "Ekler"],
		["notes", "Notlar"],
		["libraries-collections", "Kütüphaneler ve koleksiyonlar"],
		["tags", "Etiketler"],
		["related", "İlgili"],
		["attachment-annotations", "Ek açıklamaları"],
	],

	hidden() {
		try {
			let list = JSON.parse(Hafif.pref("hiddenSections") || "[]");
			return Array.isArray(list) ? list : [];
		}
		catch (e) {
			return [];
		}
	},

	isHidden(id) {
		return this.hidden().includes(id);
	},

	toggle(id) {
		let list = this.hidden();
		list = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
		Hafif.pref("hiddenSections", JSON.stringify(list));
		for (let win of Zotero.getMainWindows()) this.apply(win);
	},

	css() {
		return this.hidden()
			.filter(id => /^[a-z-]+$/.test(id))
			.map(id => `#zotero-item-pane [data-pane="${id}"], #zotero-context-pane [data-pane="${id}"] { display: none !important; }`)
			.join("\n");
	},

	apply(win) {
		let doc = win.document;
		let el = doc.getElementById("hafif-panel-style");
		if (!el) {
			el = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
			el.id = "hafif-panel-style";
			doc.documentElement.append(el);
		}
		el.textContent = this.css();
	},

	remove(win) {
		win.document.getElementById("hafif-panel-style")?.remove();
	},
};
