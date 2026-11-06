/* Gizli değerler (API anahtarları): Zotero'nun (Firefox'un) parola yöneticisinde durur, ayar
 * dosyasında (prefs.js) açık metin olarak değil. Ana parola tanımlıysa Firefox onu bir kez sorar.
 * Okuma eşzamanlıdır ve bellekte önbelleğe alınır; parola yöneticisi kullanılamazsa (ör. bozuk
 * profil) değer ayarlarda kalmaya devam eder ve hiçbir şey kaybolmaz. */

Hafif.modules.secrets = {
	ORIGIN: "chrome://hafif",
	REALM: "Hafif API",
	_cache: null,

	_logins() {
		try {
			return Services.logins.findLogins(this.ORIGIN, null, this.REALM) || [];
		}
		catch (e) {
			Zotero.logError(e);
			return null;
		}
	},

	_load() {
		if (this._cache) return this._cache;
		this._cache = new Map();
		for (let l of this._logins() || []) this._cache.set(l.username, l.password);
		return this._cache;
	},

	available() {
		return this._logins() !== null;
	},

	get(name) {
		return this._load().get(name) || "";
	},

	all() {
		return Object.fromEntries(this._load());
	},

	/** Değeri yazar; boş değer siler. Başarılıysa true. */
	async set(name, value) {
		let cache = this._load();
		let logins = this._logins();
		if (logins === null) return false;
		let old = logins.find(l => l.username === name);
		try {
			if (!value) {
				if (old) Services.logins.removeLogin(old);
				cache.delete(name);
				return true;
			}
			let LoginInfo = Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Ci.nsILoginInfo, "init");
			let info = new LoginInfo(this.ORIGIN, null, this.REALM, name, value, "", "");
			if (old) Services.logins.modifyLogin(old, info);
			else if (Services.logins.addLoginAsync) await Services.logins.addLoginAsync(info);
			else Services.logins.addLogin(info);
			cache.set(name, value);
			return true;
		}
		catch (e) {
			Zotero.logError(e);
			return false;
		}
	},

	/** Ayarlarda açık duran eski anahtarları parola yöneticisine taşır (bir kez, sessizce). */
	async migrate() {
		let raw = Hafif.pref("aiKeys");
		let legacy = Hafif.pref("aiKey");
		let custom = Hafif.pref("aiCustom");
		let hasCustomKeys = custom && /"key":\s*"[^"]/.test(custom);
		if ((!raw || raw === "{}") && !legacy && !hasCustomKeys) return;
		if (!this.available()) return;
		let moved = 0;
		let keys = {};
		try {
			keys = JSON.parse(raw || "{}") || {};
		}
		catch (e) {}
		if (legacy && !keys.anthropic) keys.anthropic = legacy;
		let left = {};
		for (let [id, v] of Object.entries(keys)) {
			if (!v) continue;
			if (await this.set("provider:" + id, v)) moved++;
			else left[id] = v;
		}
		Hafif.pref("aiKeys", Object.keys(left).length ? JSON.stringify(left) : "");
		if (!left.anthropic) Hafif.pref("aiKey", "");
		if (hasCustomKeys) {
			try {
				let list = JSON.parse(custom);
				for (let c of list) {
					if (c.key && await this.set("custom:" + c.id, c.key)) {
						c.key = "";
						c.hasKey = true;
						moved++;
					}
				}
				Hafif.pref("aiCustom", JSON.stringify(list));
			}
			catch (e) {
				Zotero.logError(e);
			}
		}
		if (moved) Hafif.log(`${moved} API anahtarı parola yöneticisine taşındı`);
	},

	shutdown() {
		this._cache = null;
	},
};
