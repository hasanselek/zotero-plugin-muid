/* Etiket gezgini: bütün etiketler sayılarıyla, harekeden bağımsız süzme.
 * ↵ kütüphaneyi o etikete göre süzer · ⌘↵ seçili kayıtlara ekler · ⌥↵ seçili kayıtlardan çıkarır. */

Hafif.modules.tags = {
	_tags: [],

	async load() {
		let libraryID = Zotero.getActiveZoteroPane()?.getSelectedLibraryID?.() || Zotero.Libraries.userLibraryID;
		let rows = await Zotero.DB.queryAsync(
			"SELECT T.name AS name, COUNT(DISTINCT IT.itemID) AS n FROM tags T "
			+ "JOIN itemTags IT USING (tagID) JOIN items I USING (itemID) "
			+ "WHERE I.libraryID=? AND I.itemID NOT IN (SELECT itemID FROM deletedItems) "
			+ "GROUP BY T.name ORDER BY n DESC, T.name", [libraryID]);
		let colors = Zotero.Tags.getColors(libraryID);
		let norm = Hafif.load("search").normalize.bind(Hafif.modules.search);
		this.libraryID = libraryID;
		this._tags = rows.map(r => ({ name: r.name, count: r.n, color: colors.get(r.name)?.color || null, n: norm(r.name) }));
	},

	list(q) {
		let norm = Hafif.modules.search.normalize(q);
		let out = this._tags
			.filter(t => !norm || t.n.includes(norm))
			.sort((a, b) => (b.color ? 1 : 0) - (a.color ? 1 : 0) || (norm && a.n.startsWith(norm) ? -1 : 0) - (norm && b.n.startsWith(norm) ? -1 : 0) || b.count - a.count)
			.slice(0, 200)
			.map(t => ({ title: t.name, badge: t.count, color: t.color, data: t }));
		let typed = q.trim();
		if (typed && !this._tags.some(t => t.name === typed)) {
			out.push({ title: `“${typed}” (yeni etiket)`, meta: "⌘↵ ile seçili kayıtlara ekle", data: { name: typed, isNew: true } });
		}
		return out;
	},

	toggle(win) {
		return Hafif.load("palette").toggle(win, {
			id: "tags",
			placeholder: "Etiket ara…",
			hint: "↵ kütüphaneyi süz · ⌘↵ seçili kayıtlara ekle · ⌥↵ seçili kayıtlardan çıkar · esc kapat",
			empty: "Etiket yok",
			prepare: () => this.load(),
			items: (q) => this.list(q),
			onEnter: (entry, mods) => this.act(win, entry?.data, mods),
		});
	},

	async act(win, tag, mods) {
		if (!tag) return;
		let pane = win.ZoteroPane;
		if (mods.accel || mods.alt) {
			let items = pane.getSelectedItems().filter(i => i.isRegularItem() || i.isNote() || i.isAttachment());
			if (!items.length) {
				Hafif.toast("Önce kütüphanede kayıt seçin.");
				return false;
			}
			await Zotero.DB.executeTransaction(async () => {
				for (let item of items) {
					if (mods.alt) item.removeTag(tag.name);
					else item.addTag(tag.name);
					await item.save();
				}
			});
			Hafif.toast(`${items.length} kayıt: “${tag.name}” ${mods.alt ? "çıkarıldı" : "eklendi"}.`);
			return;
		}
		if (tag.isNew) return false;
		win.Zotero_Tabs.select("zotero-pane");
		let ts = pane.tagSelector;
		ts.clearTagSelection();
		ts.handleTagSelected(tag.name);
	},
};
