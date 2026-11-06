/* Yapay zekâ kullanımı ve maliyet: her model çağrısının giriş/çıkış belirteçleri aylık olarak
 * sağlayıcı:model başına toplanır (Zotero veri klasörü › hafif/usage.json). Fiyatlar sık değiştiği
 * için eklentide sabit fiyat yoktur: Ayarlar › Yapay zekâ › Kullanım tablosuna kendi fiyatlarınızı
 * (1 milyon belirteç başına, giriş/çıkış) girerseniz tahmini tutar da gösterilir. */

Hafif.modules.usage = {
	_data: null,
	_timer: null,

	_path() {
		return PathUtils.join(Zotero.DataDirectory.dir, "hafif", "usage.json");
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

	month(d = new Date()) {
		return d.toISOString().slice(0, 7);
	},

	/** Bir çağrının kullanımını ekler (beklemeden; yazma birkaç saniye sonra toplu yapılır). */
	record(provider, model, u) {
		if (!u || (!u.input && !u.output)) return;
		this._load().then((data) => {
			let m = this.month();
			let k = `${provider}:${model}`;
			let row = ((data[m] ||= {})[k] ||= { input: 0, output: 0, cacheRead: 0, calls: 0 });
			row.input += u.input || 0;
			row.output += u.output || 0;
			row.cacheRead += u.cacheRead || 0;
			row.calls++;
			if (!this._timer) {
				this._timer = Zotero.Promise.delay(5000).then(() => this.save());
			}
		}).catch(e => Zotero.logError(e));
	},

	async save() {
		this._timer = null;
		if (!this._data) return;
		await IOUtils.makeDirectory(PathUtils.parent(this._path()), { createAncestors: true, ignoreExisting: true });
		await IOUtils.writeUTF8(this._path(), JSON.stringify(this._data), { tmpPath: this._path() + ".tmp" });
	},

	prices() {
		try {
			return JSON.parse(Hafif.pref("aiPrices") || "{}") || {};
		}
		catch (e) {
			return {};
		}
	},

	setPrice(key, input, output) {
		let p = this.prices();
		if (input == null && output == null) delete p[key];
		else p[key] = [+input || 0, +output || 0];
		Hafif.pref("aiPrices", JSON.stringify(p));
	},

	/** Saf: satır + fiyat → tutar (fiyat yoksa null). */
	cost(row, price) {
		if (!price) return null;
		return ((row.input || 0) * price[0] + (row.output || 0) * price[1]) / 1e6;
	},

	/** → [{ key, input, output, calls, cost }] (en çok kullanılan önce) */
	async report(month = this.month()) {
		let data = await this._load();
		let prices = this.prices();
		return Object.entries(data[month] || {})
			.map(([key, r]) => ({ key, ...r, cost: this.cost(r, prices[key]) }))
			.sort((a, b) => (b.input + b.output) - (a.input + a.output));
	},

	async months() {
		return Object.keys(await this._load()).sort().reverse();
	},

	fmtTokens(n) {
		if (n >= 1e6) return (n / 1e6).toFixed(2) + " M";
		if (n >= 1e3) return (n / 1e3).toFixed(1) + " B";
		return String(n || 0);
	},

	shutdown() {
		this.save().catch(e => Zotero.logError(e));
	},
};
