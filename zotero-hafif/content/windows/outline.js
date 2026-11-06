/* PDF içindekiler düzenleyicisi. */

var HafifOutline = {
	att: null,
	entries: [],
	pageCount: 0,
	dirty: false,

	async init() {
		this.Hafif = Zotero.Hafif;
		this.mod = this.Hafif.load("outline");
		let $ = (id) => document.getElementById(id);
		this.$ = $;
		let args = window.arguments?.[0] || {};
		this.att = Zotero.Items.get(args.attachmentID);
		if (!this.att) throw new Error("PDF eki bulunamadı");

		let parent = this.att.parentItem;
		$("title").textContent = parent ? parent.getDisplayTitle() : this.att.getDisplayTitle();
		$("status").textContent = "PDF okunuyor…";

		let { entries, pageCount, hadOutline } = await this.mod.load(this.att);
		this.entries = entries;
		this.pageCount = pageCount;
		let drafts = entries.filter(e => e.source === "draft").length;
		$("meta").textContent = `${pageCount} sayfa · ${hadOutline ? "PDF'te mevcut içindekiler var" : "PDF'te içindekiler yok"}`
			+ (drafts ? ` · ${drafts} yeni başlık bekliyor` : "");
		this.dirty = drafts > 0;
		$("status").textContent = "";

		this.fillColors();
		$("add-colored").addEventListener("click", () => this.addColored());
		$("add-blank").addEventListener("click", () => {
			this.entries.push({ title: "Yeni başlık", level: 1, pageIndex: 0, top: null, source: "draft" });
			this.touch();
			this.render();
			this.$("list").lastElementChild?.querySelector("input.t")?.select();
		});
		$("cancel").addEventListener("click", () => window.close());
		$("save").addEventListener("click", () => this.save());
		this.render();
	},

	fillColors() {
		let counts = new Map();
		for (let a of this.att.getAnnotations()) {
			if (!["highlight", "underline"].includes(a.annotationType)) continue;
			counts.set(a.annotationColor, (counts.get(a.annotationColor) || 0) + 1);
		}
		let names = { "#ffd400": "Sarı", "#ff6666": "Kırmızı", "#5fb236": "Yeşil", "#2ea8e5": "Mavi",
			"#a28ae5": "Mor", "#e56eee": "Eflatun", "#f19837": "Turuncu", "#aaaaaa": "Gri" };
		let sel = this.$("color");
		sel.replaceChildren();
		for (let [color, n] of counts) {
			let o = document.createElement("option");
			o.value = color;
			o.textContent = `${names[color] || color} vurgular (${n})`;
			sel.append(o);
		}
		let none = !counts.size;
		sel.disabled = this.$("add-colored").disabled = this.$("color-level").disabled = none;
		if (none) {
			let o = document.createElement("option");
			o.textContent = "Bu PDF'te vurgu yok";
			sel.append(o);
		}
	},

	addColored() {
		let color = this.$("color").value;
		let level = +this.$("color-level").value;
		let add = [];
		for (let a of this.att.getAnnotations()) {
			if (a.annotationColor !== color || !["highlight", "underline"].includes(a.annotationType)) continue;
			let pos = JSON.parse(a.annotationPosition || "{}");
			let rects = pos.rects || [];
			let title = String(a.annotationText || "").replace(/\s+/g, " ").trim().slice(0, 200);
			if (!title || this.entries.some(e => e.title === title && e.pageIndex === pos.pageIndex)) continue;
			add.push({ title, level, pageIndex: pos.pageIndex | 0, top: rects.length ? Math.max(...rects.map(r => r[3])) + 4 : null, source: "draft" });
		}
		if (!add.length) return this.status("Eklenecek yeni vurgu yok.");
		this.entries = this.mod._merge(this.entries, add);
		this.touch();
		this.render();
		this.status(`${add.length} başlık eklendi.`);
	},

	render() {
		let list = this.$("list");
		list.replaceChildren();
		this.$("empty").classList.toggle("hidden", this.entries.length > 0);
		this.entries.forEach((e, i) => {
			let li = document.createElement("li");
			li.className = "l" + e.level;
			let ind = document.createElement("span");
			ind.className = "ind";
			ind.style.width = (e.level - 1) * 22 + 10 + "px";
			let mk = (label, title, fn) => {
				let b = document.createElement("button");
				b.className = "b";
				b.textContent = label;
				b.title = title;
				b.addEventListener("click", () => { fn(); this.touch(); this.render(); });
				return b;
			};
			let t = document.createElement("input");
			t.className = "t";
			t.dir = "auto";
			t.value = e.title;
			t.addEventListener("input", () => { e.title = t.value; this.touch(); });
			let p = document.createElement("input");
			p.className = "p";
			p.type = "number";
			p.min = 1;
			p.max = this.pageCount;
			p.value = e.pageIndex + 1;
			p.title = "Sayfa";
			p.addEventListener("change", () => {
				e.pageIndex = Math.max(0, Math.min(this.pageCount - 1, (+p.value || 1) - 1));
				e.top = null;
				this.touch();
			});
			li.append(ind,
				mk("‹", "Üst düzeye al", () => { e.level = Math.max(1, e.level - 1); }),
				mk("›", "Alt düzeye al", () => { e.level = Math.min(3, e.level + 1); }),
				t);
			if (e.source === "draft") {
				let tag = document.createElement("span");
				tag.className = "tag";
				tag.textContent = "yeni";
				li.append(tag);
			}
			li.append(p,
				mk("↑", "Yukarı taşı", () => { if (i > 0) [this.entries[i - 1], this.entries[i]] = [this.entries[i], this.entries[i - 1]]; }),
				mk("↓", "Aşağı taşı", () => { if (i < this.entries.length - 1) [this.entries[i + 1], this.entries[i]] = [this.entries[i], this.entries[i + 1]]; }),
				mk("✕", "Sil", () => { this.entries.splice(i, 1); }));
			list.append(li);
		});
	},

	touch() {
		this.dirty = true;
		this.$("save").disabled = false;
	},

	status(msg) {
		this.$("status").textContent = msg;
	},

	async save() {
		let btn = this.$("save");
		btn.disabled = true;
		this.status("PDF'e yazılıyor…");
		try {
			let clean = this.entries.filter(e => e.title.trim());
			let size = await this.mod.save(this.att, clean);
			this.entries = clean.map(e => ({ ...e, source: "pdf" }));
			this.dirty = false;
			this.render();
			this.status(`Kaydedildi: ${clean.length} başlık (${(size / 1e6).toFixed(1)} MB). Aslı hafif/yedek klasöründe.`);
			this.Hafif.toast(`PDF içindekiler kaydedildi (${clean.length} başlık).`);
		}
		catch (e) {
			Zotero.logError(e);
			this.status("Kaydedilemedi: " + e.message);
			btn.disabled = false;
		}
	},
};

window.addEventListener("load", () => {
	HafifOutline.init().catch((e) => {
		Zotero.logError(e);
		document.body.textContent = "PDF içindekiler açılamadı: " + e.message;
	});
});
window.addEventListener("beforeunload", (e) => {
	if (HafifOutline.dirty && !Services.prompt.confirm(window, "PDF İçindekiler", "Kaydedilmemiş değişiklikler var. Yine de kapatılsın mı? (Okuyucudan eklenen taslak başlıklar saklanır.)")) {
		e.preventDefault();
	}
});
