/* Okuma takibi: hangi eseri ne kadar süre okuduğunuz, kaç sayfasını gördüğünüz, en son ne zaman.
 * 15 saniyede bir yalnızca şu bakılır: Zotero önde mi, önde bir okuyucu var mı, kullanıcı son
 * iki dakikada klavye/fare kullanmış mı. Öyleyse o eserin süresi artar ve görülen sayfa işaretlenir.
 * Veri Zotero veri klasöründe hafif/reading.json'da durur; hiçbir yere gönderilmez.
 * İsteğe bağlı: ilerleme %10'u geçince "okunuyor", %95'i geçince "okundu" etiketi. */

Hafif.modules.reading = {
	TICK: 15000,
	IDLE: 120000,
	_timer: null,
	_data: null,
	_dirty: false,
	_saveTimer: null,
	_last: 0,

	_path() {
		return PathUtils.join(Zotero.DataDirectory.dir, "hafif", "reading.json");
	},

	async _load() {
		if (this._data) return this._data;
		try {
			this._data = JSON.parse(await IOUtils.readUTF8(this._path())) || {};
		}
		catch (e) {
			this._data = {};
		}
		return this._data;
	},

	_scheduleSave() {
		this._dirty = true;
		if (this._saveTimer) return;
		this._saveTimer = Zotero.Promise.delay(30000).then(() => this.save()).catch(e => Zotero.logError(e));
	},

	async save() {
		this._saveTimer = null;
		if (!this._dirty || !this._data) return;
		this._dirty = false;
		await IOUtils.makeDirectory(PathUtils.parent(this._path()), { createAncestors: true, ignoreExisting: true });
		await IOUtils.writeUTF8(this._path(), JSON.stringify(this._data), { tmpPath: this._path() + ".tmp" });
	},

	start() {
		if (this._timer) return;
		this._load().catch(e => Zotero.logError(e));
		this._last = Date.now();
		// Pencereden bağımsız zamanlayıcı (eklenti ana pencereden önce başlar)
		this._timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
		this._timer.initWithCallback({ notify: () => this.tick().catch(e => Zotero.logError(e)) }, this.TICK, Ci.nsITimer.TYPE_REPEATING_SLACK);
	},

	stop() {
		this._timer?.cancel();
		this._timer = null;
	},

	_idleMs() {
		try {
			return Cc["@mozilla.org/widget/useridleservice;1"].getService(Ci.nsIUserIdleService).idleTime;
		}
		catch (e) {
			return 0;
		}
	},

	/** Önde okunan okuyucu (ana penceredeki sekme ya da ayrı okuyucu penceresi). */
	_activeReader() {
		let active = Services.focus.activeWindow;
		if (!active) return null;
		let C = Hafif.load("compat");
		if (active.Zotero_Tabs) {
			if (active.Zotero_Tabs.selectedType === "library") return null;
			return Zotero.Reader.getByTabID(active.Zotero_Tabs.selectedID) || null;
		}
		return C.readers().find(r => C.readerWindow(r) === active) || null;
	},

	key(att) {
		return `${att.libraryID}/${att.key}`;
	},

	async tick() {
		let now = Date.now();
		let dt = Math.min(now - this._last, this.TICK * 2);
		this._last = now;
		if (this._idleMs() > this.IDLE) return;
		let reader = this._activeReader();
		if (!reader) return;
		let att = Zotero.Items.get(reader.itemID);
		if (!att) return;
		let data = await this._load();
		let k = this.key(att);
		let r = data[k] || (data[k] = { ms: 0, seen: [], count: 0, first: now, last: 0, days: {} });
		// Yeni oturum: son okumadan 30 dk sonra
		if (now - r.last > 30 * 60000) r.sessions = (r.sessions || 0) + 1;
		r.ms += dt;
		r.last = now;
		let day = new Date(now).toISOString().slice(0, 10);
		r.days[day] = (r.days[day] || 0) + dt;
		// Eski gün kayıtları budanır (son 120 gün)
		let days = Object.keys(r.days);
		if (days.length > 120) for (let d of days.sort().slice(0, days.length - 120)) delete r.days[d];
		let pg = Hafif.load("compat").readerPage(reader);
		if (pg?.index != null) {
			if (!r.seen.includes(pg.index)) r.seen.push(pg.index);
			if (pg.count) r.count = pg.count;
			r.page = pg.index;
		}
		this._scheduleSave();
		await this._autoState(att, r);
	},

	progress(r) {
		if (!r?.count) return 0;
		return Math.min(1, r.seen.length / r.count);
	},

	async _autoState(att, r) {
		if (Hafif.pref("readingAutoState") === false) return;
		let top = att.parentItem;
		if (!top?.isRegularItem()) return;
		let A = Hafif.load("actions");
		let names = A.tagNames();
		let p = this.progress(r);
		let state = p >= 0.95 && Hafif.pref("readingAutoRead") === true ? "read" : p >= 0.1 ? "reading" : null;
		if (!state || !names[state] || top.hasTag(names[state]) || top.hasTag(names.read)) return;
		await A.readState([top], state);
	},

	/** Kayıt (üst kayıt ya da ek) için birleşik istatistik. */
	async statsFor(item) {
		let data = await this._load();
		let atts = item.isRegularItem() ? Zotero.Items.get(item.getAttachments()).filter(a => a.isFileAttachment()) : [item];
		let out = { ms: 0, seen: 0, count: 0, last: 0, first: 0, sessions: 0, attachments: [] };
		for (let a of atts) {
			let r = data[this.key(a)];
			if (!r) continue;
			out.ms += r.ms;
			out.seen += r.seen.length;
			out.count += r.count || 0;
			out.sessions += r.sessions || 0;
			out.last = Math.max(out.last, r.last);
			out.first = out.first ? Math.min(out.first, r.first) : r.first;
			out.attachments.push({ att: a, ...r, progress: this.progress(r) });
		}
		out.progress = out.count ? Math.min(1, out.seen / out.count) : 0;
		return out;
	},

	/** Bütün okumalar: en son okunan önce. → [{ att, top, ms, progress, last, … }] */
	async all() {
		let data = await this._load();
		let out = [];
		for (let [k, r] of Object.entries(data)) {
			let [lib, key] = k.split("/");
			let att = Zotero.Items.getByLibraryAndKey(+lib, key);
			if (!att || att.deleted) continue;
			out.push({ att, top: att.parentItem || att, ...r, progress: this.progress(r) });
		}
		return out.sort((a, b) => b.last - a.last);
	},

	/** Son n günün günlük toplamı (ms). */
	async daily(n = 14) {
		let data = await this._load();
		let days = [];
		for (let i = n - 1; i >= 0; i--) days.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
		let sums = Object.fromEntries(days.map(d => [d, 0]));
		for (let r of Object.values(data)) for (let [d, ms] of Object.entries(r.days || {})) if (d in sums) sums[d] += ms;
		return days.map(d => ({ day: d, ms: sums[d] }));
	},

	fmt(ms) {
		let m = Math.round(ms / 60000);
		if (m < 1) return "1 dk'dan az";
		if (m < 60) return `${m} dk`;
		return `${Math.floor(m / 60)} sa ${m % 60} dk`;
	},

	ago(t) {
		if (!t) return "—";
		let d = Math.floor((Date.now() - t) / 86400000);
		if (d <= 0) return "bugün";
		if (d === 1) return "dün";
		if (d < 30) return `${d} gün önce`;
		return new Date(t).toLocaleDateString("tr-TR");
	},

	// ---- Sağ panel bölümü ----

	async render({ body, item }) {
		let doc = body.ownerDocument;
		let h = (tag, cls, text) => {
			let el = doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
			if (cls) el.className = cls;
			if (text != null) el.textContent = text;
			return el;
		};
		body.replaceChildren();
		let s = await this.statsFor(item);
		let box = h("div", "hafif-reading");
		box.style.cssText = "display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; font-size: 12px; padding: 2px 0;";
		let row = (k, v) => box.append(h("span", null, k), h("span", null, v));
		if (!s.ms) {
			body.append(h("div", null, "Henüz okunmadı."));
			return;
		}
		row("Süre", `${this.fmt(s.ms)} · ${s.sessions || 1} oturum`);
		row("İlerleme", s.count ? `%${Math.round(s.progress * 100)} (${s.seen}/${s.count} sayfa)` : `${s.seen} sayfa`);
		row("Son okuma", this.ago(s.last));
		let ann = 0;
		for (let a of s.attachments) ann += a.att.getAnnotations?.().length || 0;
		row("Vurgu", String(ann));
		body.append(box);
		if (s.count) {
			let bar = h("div");
			bar.style.cssText = "height: 4px; border-radius: 2px; background: color-mix(in srgb, currentColor 12%, transparent); margin-top: 6px; overflow: hidden;";
			let fill = h("div");
			fill.style.cssText = `height: 100%; width: ${Math.round(s.progress * 100)}%; background: var(--accent-blue, #2e7dd7);`;
			bar.append(fill);
			body.append(bar);
		}
	},

	shutdown() {
		this.stop();
		this.save().catch(e => Zotero.logError(e));
	},
};
