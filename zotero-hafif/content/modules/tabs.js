/* Sekme yöneticisi: açık sekmeler listesi, süzme, geçiş ve toplu kapatma.
 * ↵ sekmeye geç · ⌘⌫ sekmeyi kapat · listenin başındaki komutlar toplu işlem yapar. */

Hafif.modules.tabs = {
	_tabs(win) {
		return win.Zotero_Tabs._tabs.filter(t => t.id !== "zotero-pane");
	},

	_collectionOf(tab) {
		let item = tab.data?.itemID && Zotero.Items.get(tab.data.itemID);
		let top = item?.parentItem || item;
		let col = top?.getCollections?.()[0];
		return col ? Zotero.Collections.get(col)?.name || "" : "";
	},

	list(win, q) {
		let norm = Hafif.modules.search.normalize(q);
		let tabs = this._tabs(win);
		let selected = win.Zotero_Tabs.selectedID;
		let out = [];
		if (!norm) {
			out.push(
				{ title: "↧ Koleksiyona göre grupla", meta: "Okuyucu sekmelerini koleksiyon sırasına dizer", data: { cmd: "group" } },
				{ title: "✕ Diğer sekmeleri kapat", meta: "Seçili sekme ve kütüphane kalır", data: { cmd: "others" } },
				{ title: "✕ Bütün okuyucu sekmelerini kapat", meta: `${tabs.length} sekme`, data: { cmd: "all" } },
			);
		}
		for (let t of tabs) {
			let col = this._collectionOf(t);
			if (norm && !Hafif.modules.search.normalize(t.title + " " + col).includes(norm)) continue;
			out.push({
				title: (t.id === selected ? "● " : "") + t.title,
				meta: [col, t.type.replace("reader-unloaded", "okuyucu (uykuda)").replace("reader", "okuyucu")].filter(Boolean).join(" · "),
				data: { id: t.id },
			});
		}
		return out;
	},

	toggle(win) {
		return Hafif.load("palette").toggle(win, {
			id: "tabs",
			placeholder: "Sekme ara…",
			hint: "↵ sekmeye geç · ⌘⌫ sekmeyi kapat · esc kapat",
			empty: "Açık okuyucu sekmesi yok",
			items: (q) => this.list(win, q),
			onEnter: (entry) => this.act(win, entry?.data),
			onKey: (e, entry, mods) => {
				if (mods.accel && e.key === "Backspace" && entry?.data?.id) {
					win.Zotero_Tabs.close(entry.data.id);
					return true;
				}
				return false;
			},
		});
	},

	act(win, data) {
		if (!data) return;
		let T = win.Zotero_Tabs;
		let tabs = this._tabs(win);
		if (data.id) return T.select(data.id);
		if (data.cmd === "all") T.close(tabs.map(t => t.id));
		else if (data.cmd === "others") T.close(tabs.filter(t => t.id !== T.selectedID).map(t => t.id));
		else if (data.cmd === "group") {
			let sorted = [...tabs].sort((a, b) =>
				this._collectionOf(a).localeCompare(this._collectionOf(b), "tr") || a.title.localeCompare(b.title, "tr"));
			sorted.forEach((t, i) => T.move(t.id, i + 1));
			Hafif.toast("Sekmeler koleksiyona göre dizildi.");
		}
	},
};
